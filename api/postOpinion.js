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

// ===================== Notification Functions =====================

const sendPostNotificationsToFollowers = async (conn, username, postId, message, photo) => {
  const [followers] = await conn.execute(`
    SELECT f.follower AS username
    FROM follows f
    WHERE f.following = ? AND f.relationship_status IN ('none', 'accepted') AND f.follower != ?
  `, [username, username]);

  if (!followers.length) return;

  const postPreview = message
    ? (message.length > 50 ? message.slice(0, 50) + '...' : message)
    : (photo ? 'shared a photo' : 'made a post');

  const notificationMessage = `${username} posted: ${postPreview}`;
  const metadata = JSON.stringify({
    postId,
    postType: photo ? 'photo' : 'text',
    preview: postPreview
  });

  const values = followers.map(f => [
    f.username,
    username,
    'new_post',
    notificationMessage,
    metadata
  ]);

  const placeholders = values.map(() => '(?, ?, ?, ?, ?)').join(', ');
  await conn.execute(`
    INSERT INTO notifications (recipient, sender, type, message, metadata)
    VALUES ${placeholders}
  `, values.flat());
};

const sendTagNotifications = async (conn, author, taggedUsers, postId, message) => {
  const uniqueTags = [...new Set(taggedUsers.filter(tag => tag !== author))];
  if (!uniqueTags.length) return;

  const [validUsers] = await conn.execute(
    `SELECT username FROM users WHERE username IN (${uniqueTags.map(() => '?').join(',')})`,
    uniqueTags
  );

  if (!validUsers.length) return;

  const preview = message
    ? (message.length > 30 ? message.slice(0, 30) + '...' : message)
    : 'a post';

  const notificationMessage = `${author} mentioned you in ${preview}`;
  const metadata = JSON.stringify({ postId, mentionType: 'tag' });

  const values = validUsers.map(user => [
    user.username,
    author,
    'tag_mention',
    notificationMessage,
    metadata
  ]);

  const placeholders = values.map(() => '(?, ?, ?, ?, ?)').join(', ');
  await conn.execute(`
    INSERT INTO notifications (recipient, sender, type, message, metadata)
    VALUES ${placeholders}
  `, values.flat());
};

const sendReplyNotification = async (conn, replier, originalAuthor, postId, message) => {
  if (replier === originalAuthor) return;

  const [userExists] = await conn.execute(
    'SELECT 1 FROM users WHERE username = ? LIMIT 1',
    [originalAuthor]
  );
  if (!userExists.length) return;

  const preview = message
    ? (message.length > 40 ? message.slice(0, 40) + '...' : message)
    : 'replied to your post';

  const notificationMessage = `${replier} replied: ${preview}`;
  const metadata = JSON.stringify({ postId, replyType: 'post_reply' });

  await conn.execute(`
    INSERT INTO notifications (recipient, sender, type, message, metadata)
    VALUES (?, ?, ?, ?, ?)
  `, [originalAuthor, replier, 'post_reply', notificationMessage, metadata]);
};

// ===================== Main Handler =====================

const handler = async (req, res) => {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(req, res);
    return res.status(200).end();
  }

  setCorsHeaders(req, res);

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
        `INSERT INTO posts (message, timestamp, username, sessionId, likes, dislikes, likedBy, dislikedBy, comments, photo, tags, replyTo)
         VALUES (?, NOW(), ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)`,
        [
          message || '',
          username,
          sessionId,
          '[]',
          '[]',
          '[]',
          photo || null,
          JSON.stringify(extractedTags),
          replyToData ? JSON.stringify(replyToData) : null
        ]
      );

      const postId = result.insertId;

      const newPost = {
        _id: postId,
        message: message || '',
        timestamp: new Date(),
        username,
        likes: 0,
        dislikes: 0,
        likedBy: [],
        dislikedBy: [],
        comments: [],
        photo: photo || null,
        profilePicture,
        tags: extractedTags,
        replyTo: replyToData
      };

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

      await conn.commit();

      try {
        await publishToAbly('newOpinion', newPost);
      } catch (_) {}

      return res.status(201).json(newPost);

    } catch (error) {
      await conn.rollback();
      return res.status(500).json({ message: 'Error saving post', error: error.message });
    } finally {
      conn.release();
    }
  }

    // PUT/PATCH: Handle likes/dislikes
    if (req.method === 'PUT' || req.method === 'PATCH') {
        const { postId, action, username } = req.body;
      
        if (!postId || !action || !username) {
            return res.status(400).json({ message: 'Post ID, action, and username are required' });
        }

        try {
            // Get the post from MySQL
            const [postRows] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);
            const post = postRows[0];

            if (!post) {
                return res.status(404).json({ message: 'Post not found' });
            }

            let updatedLikes = post.likes;
            let updatedDislikes = post.dislikes;
            let updatedLikedBy = JSON.parse(post.likedBy);
            let updatedDislikedBy = JSON.parse(post.dislikedBy);

            // Handle the 'like' action
            if (action === 'like') {
                if (updatedLikedBy.includes(username)) {
                    return res.status(400).json({ message: 'You have already liked this post' });
                }
                if (updatedDislikedBy.includes(username)) {
                    updatedDislikes -= 1;
                    updatedDislikedBy = updatedDislikedBy.filter(user => user !== username);
                }
                updatedLikes += 1;
                updatedLikedBy.push(username);
            }

            // Handle the 'dislike' action
            if (action === 'dislike') {
                if (updatedDislikedBy.includes(username)) {
                    return res.status(400).json({ message: 'You have already disliked this post' });
                }
                if (updatedLikedBy.includes(username)) {
                    updatedLikes -= 1;
                    updatedLikedBy = updatedLikedBy.filter(user => user !== username);
                }
                updatedDislikes += 1;
                updatedDislikedBy.push(username);
            }

            // Update the post in MySQL
            await promisePool.execute(
                'UPDATE posts SET likes = ?, dislikes = ?, likedBy = ?, dislikedBy = ? WHERE _id = ?',
                [updatedLikes, updatedDislikes, JSON.stringify(updatedLikedBy), JSON.stringify(updatedDislikedBy), postId]
            );

            const updatedPost = {
                _id: postId,
                message: post.message,
                timestamp: post.timestamp,
                username: post.username,
                likes: updatedLikes,
                dislikes: updatedDislikes,
                comments: JSON.parse(post.comments),
                photo: post.photo,
                profilePicture: post.profilePicture,
               tags: JSON.parse(post.tags || '[]'),
                replyTo: JSON.parse(post.replyTo || 'null')
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

    // Handle other methods
    return res.status(405).json({ message: 'Method Not Allowed' });
};
   
module.exports = handler;
