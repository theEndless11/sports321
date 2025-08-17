const { promisePool } = require('../utils/db');

const allowedOrigins = [
  'https://latestnewsandaffairs.site',
  'http://localhost:5173'
];

const setCorsHeaders = (req, res) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
};

const handler = async (req, res) => {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(req, res);
    return res.status(200).end();
  }

  setCorsHeaders(req, res);

  // ✅ Handle LIKE and UNLIKE updates
  if (req.method === 'PUT' || req.method === 'PATCH') {
    const { postId, action, username } = req.body;

    if (!postId || !action || !username) {
      return res.status(400).json({ message: 'Post ID, action, and username are required' });
    }

    if (!['like', 'unlike'].includes(action)) {
      return res.status(400).json({ message: 'Unsupported action' });
    }

    try {
      const [postRows] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);
      const post = postRows[0];

      if (!post) {
        return res.status(404).json({ message: 'Post not found' });
      }

      let updatedLikes = post.likes;
      let updatedLikedBy = JSON.parse(post.likedBy || '[]');

      if (action === 'like') {
        if (updatedLikedBy.includes(username)) {
          return res.status(400).json({ message: 'You have already liked this post' });
        }
        updatedLikes += 1;
        updatedLikedBy.push(username);
      }

      if (action === 'unlike') {
        if (!updatedLikedBy.includes(username)) {
          return res.status(400).json({ message: 'You have not liked this post yet' });
        }
        updatedLikes -= 1;
        updatedLikedBy = updatedLikedBy.filter(user => user !== username);
      }

      await promisePool.execute(
        'UPDATE posts SET likes = ?, likedBy = ? WHERE _id = ?',
        [updatedLikes, JSON.stringify(updatedLikedBy), postId]
      );

      const updatedPost = {
        _id: postId,
        message: post.message,
        timestamp: post.timestamp,
        username: post.username,
        likes: updatedLikes,
        likedBy: updatedLikedBy,
        comments: JSON.parse(post.comments || '[]'),
        photo: post.photo,
        profilePicture: post.profilePicture,
        tags: JSON.parse(post.tags || '[]'),
        replyTo: JSON.parse(post.replyTo || 'null'),
        categories: post.categories || null
      };

      try {
        await publishToAbly('updateOpinion', updatedPost);
      } catch (error) {
        console.error('Error publishing to Ably:', error);
      }

      return res.status(200).json(updatedPost);
    } catch (error) {
      console.error('Error updating post:', error);
      return res.status(500).json({ message: 'Error updating post', error });
    }
  }

  // ✅ Handle NEW post creation
  if (req.method === 'POST') {
    const { message, username, sessionId, photo, profilePic, tags, replyTo } = req.body;

    if (!username || !sessionId) {
      return res.status(400).json({ message: 'Username and sessionId are required' });
    }

    if (!message && !photo) {
      return res.status(400).json({ message: 'Post content cannot be empty' });
    }

    const conn = await promisePool.getConnection();

    try {
      await conn.beginTransaction();

      let profilePicture = 'https://latestnewsandaffairs.site/public/pfp1.jpg';
      const [userResult] = await conn.execute(
        'SELECT profile_picture FROM users WHERE username = ? LIMIT 1',
        [username]
      );

      if (userResult.length && userResult[0].profile_picture) {
        profilePicture = userResult[0].profile_picture;
      }

      const extractedTags = tags || (
        message ? [...new Set(message.match(/@(\w+)/g)?.map(tag => tag.slice(1)) || [])] : []
      );

      let replyToData = null;
      if (replyTo?.postId) {
        const [replyPost] = await conn.execute(
          'SELECT _id, username, message, photo, timestamp FROM posts WHERE _id = ?',
          [replyTo.postId]
        );

        if (!replyPost.length) {
          await conn.rollback();
          return res.status(400).json({ message: 'Replied-to post not found' });
        }

        const rp = replyPost[0];
        replyToData = {
          postId: rp._id,
          username: rp.username,
          message: rp.message,
          photo: rp.photo,
          timestamp: rp.timestamp
        };
      }

      const [result] = await conn.execute(
        `INSERT INTO posts (
          message, timestamp, username, sessionId, likes, likedBy, comments, photo, tags, replyTo, categories
        ) VALUES (?, NOW(), ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
        [
          message || '',
          username,
          sessionId,
          '[]', // likedBy
          '[]', // comments
          photo || null,
          JSON.stringify(extractedTags), // tags
          replyToData ? JSON.stringify(replyToData) : null,
          null // categories
        ]
      );

      const postId = result.insertId;

      const newPost = {
        _id: postId,
        message: message || '',
        timestamp: new Date(),
        username,
        likes: 0,
        likedBy: [],
        comments: [],
        photo: photo || null,
        profilePicture,
        tags: extractedTags,
        replyTo: replyToData,
        categories: null
      };

      // Notifications
      const notifications = [];
      if (username) {
        notifications.push(sendPostNotificationsToFollowers(conn, username, postId, message, photo));
      }
      if (extractedTags.length) {
        notifications.push(sendTagNotifications(conn, username, extractedTags, postId, message));
      }
      if (replyToData?.username && replyToData.username !== username) {
        notifications.push(sendReplyNotification(conn, username, replyToData.username, postId, message));
      }

      await Promise.allSettled(notifications);

      // Classify content
      const category = await classifyPostContent(message, photo);
      const finalCategory = category || null;

      try {
        await conn.execute(
          'UPDATE posts SET categories = ? WHERE _id = ?',
          [finalCategory, postId]
        );
        newPost.categories = finalCategory;
        console.log(`Post ${postId} categorized as:`, newPost.categories);
      } catch (updateError) {
        console.error('Failed to update post with categories:', updateError);
        newPost.categories = null;
      }

      await conn.commit();

      return res.status(201).json(newPost);

    } catch (error) {
      await conn.rollback();
      console.error('Post creation error:', error);
      return res.status(500).json({ message: 'Error saving post', error: error.message });
    } finally {
      conn.release();
    }
  }

  return res.status(405).json({ message: 'Method Not Allowed' });
};

module.exports = handler;
