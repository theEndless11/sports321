const { promisePool } = require('../utils/db');

const setCorsHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const defaultPfp = 'https://latestnewsandaffairs.site/public/pfp.jpg';

  if (req.method === 'GET') {
    const {
      username,
      username_like,
      start_timestamp,
      end_timestamp
    } = req.query;

    // Handle user profile fetch
    if (username && !username_like && !start_timestamp && !end_timestamp) {
      try {
        const [rows] = await promisePool.execute(
          'SELECT username, profile_picture, Music, description, created_at FROM users WHERE username = ?',
          [username]
        );
        
        if (rows.length === 0) {
          return res.status(404).json({ message: 'User not found' });
        }
        
        const user = rows[0];
        return res.status(200).json({
          username: user.username,
          profilePicture: user.profile_picture || defaultPfp,
          Music: user.Music || 'Music not available',
          description: user.description || 'No description available',
          created_at: user.created_at || 'created_at not available'
        });
      } catch (error) {
        console.error('Error fetching user profile:', error);
        return res.status(500).json({ message: 'Internal server error' });
      }
    }

    // Handle posts fetching
    try {
      let sql = 'SELECT * FROM posts';
      const params = [];

      // Build WHERE clauses
      const whereConditions = [];
      
      if (username_like) {
        whereConditions.push('username LIKE ?');
        params.push(`%${username_like}%`);
      }

      if (start_timestamp && end_timestamp) {
        whereConditions.push('timestamp BETWEEN ? AND ?');
        params.push(start_timestamp, end_timestamp);
      }

      if (whereConditions.length > 0) {
        sql += ' WHERE ' + whereConditions.join(' AND ');
      }

      // Default ordering by newest first
      sql += ' ORDER BY timestamp DESC';

      const [posts] = await promisePool.execute(sql, params);

      // Get unique usernames from posts
      const usernames = new Set(posts.map(p => p.username));
      
      // Get replyTo usernames
      const replyToUsernames = posts.flatMap(p => {
        try {
          const reply = p.replyTo ? JSON.parse(p.replyTo) : null;
          return reply?.username ? [reply.username] : [];
        } catch {
          return [];
        }
      });

      const allUsernames = [...new Set([...usernames, ...replyToUsernames])];

      // Get user profile pictures
      const usersMap = {};
      if (allUsernames.length > 0) {
        const userSql = `SELECT username, profile_picture FROM users WHERE username IN (${allUsernames.map(() => '?').join(',')})`;
        const [users] = await promisePool.execute(userSql, allUsernames);

        users.forEach(u => {
          usersMap[u.username.toLowerCase()] = u.profile_picture?.startsWith('data:image') || u.profile_picture?.startsWith('http')
            ? u.profile_picture
            : u.profile_picture ? `data:image/jpeg;base64,${u.profile_picture}` : defaultPfp;
        });
      }

      // Get comments for all posts
      const postIds = posts.map(p => p._id);
      let commentsMap = {};
      
      if (postIds.length > 0) {
        // Get all comments (both top-level and replies)
        const commentSql = `
          SELECT 
            c.comment_id,
            c.post_id,
            c.parent_comment_id,
            c.username,
            c.comment_text,
            c.created_at,
            c.hearts_count,
            c.is_deleted,
            u.profile_picture
          FROM comments c
          LEFT JOIN users u ON c.username = u.username
          WHERE c.post_id IN (${postIds.map(() => '?').join(',')})
          ORDER BY c.created_at ASC
        `;
        
        const [allComments] = await promisePool.execute(commentSql, postIds);
        
        // Organize comments by post_id
        postIds.forEach(postId => {
          commentsMap[postId] = [];
        });
        
        // First pass: add all top-level comments
        allComments.forEach(comment => {
          if (!comment.parent_comment_id) {
            commentsMap[comment.post_id].push({
              commentId: comment.comment_id,
              username: comment.username,
              comment: comment.comment_text,
              timestamp: comment.created_at,
              hearts: comment.hearts_count || 0,
              profilePicture: comment.profile_picture?.startsWith('data:image') || comment.profile_picture?.startsWith('http')
                ? comment.profile_picture
                : comment.profile_picture ? `data:image/jpeg;base64,${comment.profile_picture}` : defaultPfp,
              replies: []
            });
          }
        });
        
        // Second pass: add replies to their parent comments
        allComments.forEach(comment => {
          if (comment.parent_comment_id) {
            // Find the parent comment in the appropriate post
            const postComments = commentsMap[comment.post_id];
            const parentComment = postComments.find(c => c.commentId === comment.parent_comment_id);
            
            if (parentComment) {
              parentComment.replies.push({
                commentId: comment.comment_id,
                username: comment.username,
                comment: comment.comment_text,
                timestamp: comment.created_at,
                hearts: comment.hearts_count || 0,
                profilePicture: comment.profile_picture?.startsWith('data:image') || comment.profile_picture?.startsWith('http')
                  ? comment.profile_picture
                  : comment.profile_picture ? `data:image/jpeg;base64,${comment.profile_picture}` : defaultPfp
              });
            }
          }
        });
      }

      // Build enriched posts
      const enrichedPosts = posts.map(p => {
        const comments = commentsMap[p._id] || [];

        const replyToData = p.replyTo ? (() => {
          try {
            const parsed = JSON.parse(p.replyTo);
            if (parsed) {
              parsed.profilePicture = usersMap[parsed.username?.toLowerCase()] || defaultPfp;
            }
            return parsed;
          } catch {
            return null;
          }
        })() : null;

        return {
          _id: p._id,
          message: p.message,
          timestamp: p.timestamp,
          username: p.username,
          sessionId: p.sessionId,
          likes: p.likes || 0,
          likedBy: p.likedBy ? (() => {
            try {
              return JSON.parse(p.likedBy);
            } catch {
              return [];
            }
          })() : [],
          hearts: p.hearts || 0,
          comments: comments,
          commentsCount: p.comments_count || 0,
          photo: p.photo?.startsWith('http') || p.photo?.startsWith('data:image')
            ? p.photo
            : p.photo ? `data:image/jpeg;base64,${p.photo.toString('base64')}` : null,
          profilePicture: usersMap[p.username.toLowerCase()] || defaultPfp,
          tags: p.tags ? (() => {
            try {
              return JSON.parse(p.tags);
            } catch {
              return [];
            }
          })() : [],
          replyTo: replyToData
        };
      });

      // Get total count for pagination
      let countQuery = 'SELECT COUNT(*) AS count FROM posts';
      const countParams = [];
      
      if (whereConditions.length > 0) {
        countQuery += ' WHERE ' + whereConditions.join(' AND ');
        // Add the same parameters used for WHERE conditions (excluding LIMIT and OFFSET)
        if (username_like) countParams.push(`%${username_like}%`);
        if (start_timestamp && end_timestamp) countParams.push(start_timestamp, end_timestamp);
      }

      const [countResult] = await promisePool.execute(countQuery, countParams);

      return res.status(200).json({
        posts: enrichedPosts,
        hasMorePosts: (parseInt(page) * parseInt(limit)) < countResult[0].count
      });

    } catch (error) {
      console.error('Error fetching posts:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }

  // Handle other HTTP methods
  return res.status(405).json({ message: 'Method not allowed' });
};
