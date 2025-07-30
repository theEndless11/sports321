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
      end_timestamp,
      page = 1,
      limit = 5,
      sort
    } = req.query;

    // Handle user profile fetch
    if (username && !username_like && !start_timestamp && !end_timestamp) {
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
        profilePicture: user.profile_picture,
        Music: user.Music || 'Music not available',
        description: user.description || 'No description available',
        created_at: user.created_at || 'created_at not available'
      });
    }

    // Handle posts fetching
    let sql = 'SELECT * FROM posts';
    const params = [];
    const offset = (parseInt(page) - 1) * parseInt(limit);

    if (username_like) {
      sql += ' WHERE username LIKE ?';
      params.push(`%${username_like}%`);
    }

    if (start_timestamp && end_timestamp) {
      sql += params.length ? ' AND' : ' WHERE';
      sql += ' timestamp BETWEEN ? AND ?';
      params.push(start_timestamp, end_timestamp);
    }

    const sortOptions = {
      'most-liked': 'likes DESC',
      'most-comments': 'CHAR_LENGTH(comments) DESC',
      'newest': 'timestamp DESC'
    };

    sql += ` ORDER BY ${sortOptions[sort] || 'timestamp DESC'} LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const [posts] = await promisePool.execute(sql, params);

    const usernames = new Set(posts.map(p => p.username));
    const replyToUsernames = posts.flatMap(p => {
      try {
        const reply = p.replyTo ? JSON.parse(p.replyTo) : null;
        return reply?.username ? [reply.username] : [];
      } catch {
        return [];
      }
    });

    const allUsernames = [...new Set([...usernames, ...replyToUsernames])];

    const usersMap = {};
    if (allUsernames.length) {
      const userSql = `SELECT username, profile_picture FROM users WHERE username IN (${allUsernames.map(() => '?').join(',')})`;
      const [users] = await promisePool.execute(userSql, allUsernames);

      users.forEach(u => {
        usersMap[u.username.toLowerCase()] = u.profile_picture?.startsWith('data:image')
          ? u.profile_picture
          : `data:image/jpeg;base64,${u.profile_picture}` || defaultPfp;
      });
    }

    const enrichedPosts = posts.map(p => {
      const comments = p.comments ? JSON.parse(p.comments) : [];
      const enrichedComments = comments.map(c => ({
        ...c,
        profilePicture: usersMap[c.username?.toLowerCase()] || defaultPfp,
        replies: (c.replies || []).map(r => ({
          ...r,
          profilePicture: usersMap[r.username?.toLowerCase()] || defaultPfp
        }))
      }));

      const replyToData = p.replyTo ? JSON.parse(p.replyTo) : null;
      if (replyToData) {
        replyToData.profilePicture = usersMap[replyToData.username?.toLowerCase()] || defaultPfp;
      }

      return {
        _id: p._id,
        message: p.message,
        timestamp: p.timestamp,
        username: p.username,
        sessionId: p.sessionId,
        likes: p.likes,
        dislikes: p.dislikes,
        likedBy: p.likedBy ? JSON.parse(p.likedBy) : [],
        dislikedBy: p.dislikedBy ? JSON.parse(p.dislikedBy) : [],
        hearts: p.hearts,
        comments: enrichedComments,
        photo: p.photo?.startsWith('http') || p.photo?.startsWith('data:image')
          ? p.photo
          : p.photo ? `data:image/jpeg;base64,${p.photo.toString('base64')}` : null,
        profilePicture: usersMap[p.username.toLowerCase()] || defaultPfp,
        tags: p.tags ? JSON.parse(p.tags) : [],
        replyTo: replyToData
      };
    });

    const countQuery = `SELECT COUNT(*) AS count FROM posts${username_like || start_timestamp ? ' WHERE' : ''} ${username_like ? 'username LIKE ?' : ''}${username_like && start_timestamp ? ' AND ' : ''}${start_timestamp ? 'timestamp BETWEEN ? AND ?' : ''}`;
    const countParams = params.slice(0, params.length - 2);
    const [countResult] = await promisePool.execute(countQuery, countParams);

    return res.status(200).json({
      posts: enrichedPosts,
      hasMorePosts: (page * limit) < countResult[0].count
    });
  }

  if (req.method === 'POST') {
    const { username, hobby, description, profilePicture } = req.body;
    if (!username) {
      return res.status(400).json({ message: 'Username is required' });
    }

    if (Music) {
      await promisePool.execute('UPDATE users SET Music = ? WHERE username = ?', [Music, username]);
    }

    const updates = [];
    const values = [];

    if (description) {
      updates.push('description = ?');
      values.push(description);
    }

    if (profilePicture) {
      updates.push('profile_picture = ?');
      values.push(profilePicture);
    }

    if (updates.length) {
      values.push(username);
      await promisePool.execute(`UPDATE users SET ${updates.join(', ')} WHERE username = ?`, values);
    }

    return res.status(200).json({ message: 'Profile updated successfully' });
  }

  return res.status(405).json({ message: 'Method Not Allowed' });
};

