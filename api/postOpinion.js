const { promisePool } = require('../utils/db');

const allowedOrigins = [
  'https://endless.sbs',
  'http://localhost:5173'
];

const setCorsHeaders = (req, res) => {
  const o = req.headers.origin;
  if (allowedOrigins.includes(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
};

const sendNotifications = async (conn, { username, postId, message, photo, tags, replyTo }) => {
  const tasks = [];

  // Followers notification
  tasks.push((async () => {
    try {
      const [followers] = await conn.execute(
        `SELECT follower AS username
         FROM follows
         WHERE following = ? AND relationship_status IN ('none','accepted') AND follower != ?`,
        [username, username]
      );
      
      if (!followers.length) return;
      
      const preview = message
        ? message.slice(0, 50) + (message.length > 50 ? '…' : '')
        : (photo ? 'shared a photo' : 'made a post');
      const notif = `${username} posted: ${preview}`;
      const meta = JSON.stringify({ postId, postType: photo ? 'photo' : 'text', preview });
      
      // Batch insert for better performance
      const values = followers.flatMap(({ username: u }) => [u, username, 'new_post', notif, meta]);
      const placeholders = followers.map(() => '(?,?,?,?,?)').join(',');
      
      await conn.execute(
        `INSERT INTO notifications (recipient, sender, type, message, metadata) VALUES ${placeholders}`,
        values
      );
    } catch (error) {
      console.error('Error sending follower notifications:', error);
    }
  })());

  // Tag mentions notification
  if (tags?.length) {
    tasks.push((async () => {
      try {
        const uniqueTags = [...new Set(tags.filter(t => t !== username))];
        if (!uniqueTags.length) return;
        
        const [validUsers] = await conn.execute(
          `SELECT username FROM users WHERE username IN (${uniqueTags.map(() => '?').join(',')})`,
          uniqueTags
        );
        
        if (!validUsers.length) return;
        
        const preview = message ? message.slice(0, 30) + (message.length > 30 ? '…' : '') : 'a post';
        const notif = `${username} mentioned you in ${preview}`;
        const meta = JSON.stringify({ postId, mentionType: 'tag' });
        
        const values = validUsers.flatMap(({ username: u }) => [u, username, 'tag_mention', notif, meta]);
        const placeholders = validUsers.map(() => '(?,?,?,?,?)').join(',');
        
        await conn.execute(
          `INSERT INTO notifications (recipient, sender, type, message, metadata) VALUES ${placeholders}`,
          values
        );
      } catch (error) {
        console.error('Error sending tag notifications:', error);
      }
    })());
  }

  // Reply notification
  if (replyTo?.username && replyTo.username !== username) {
    tasks.push((async () => {
      try {
        const [userExists] = await conn.execute(
          'SELECT 1 FROM users WHERE username = ? LIMIT 1', 
          [replyTo.username]
        );
        
        if (!userExists.length) return;
        
        const preview = message ? message.slice(0, 40) + (message.length > 40 ? '…' : '') : 'replied to your post';
        const notif = `${username} replied: ${preview}`;
        const meta = JSON.stringify({ postId, replyType: 'post_reply' });
        
        await conn.execute(
          `INSERT INTO notifications (recipient, sender, type, message, metadata) VALUES (?,?,?,?,?)`,
          [replyTo.username, username, 'post_reply', notif, meta]
        );
      } catch (error) {
        console.error('Error sending reply notification:', error);
      }
    })());
  }

  // Execute all notification tasks concurrently
  await Promise.allSettled(tasks);
};

const handler = async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { message, username, sessionId, photo, tags, replyTo } = req.body;
  
  // Input validation
  if (!username || !sessionId || (!message && !photo)) {
    return res.status(400).json({ message: 'Invalid request: username, sessionId, and either message or photo required' });
  }

  let conn;
  try {
    conn = await promisePool.getConnection();
    await conn.beginTransaction();

    // Extract tags from message if not provided
    const extractedTags = tags || [...new Set((message?.match(/@(\w+)/g) || []).map(t => t.slice(1)))];

    // Handle reply data
    let replyToData = null;
    if (replyTo?.postId) {
      const [[replyPost]] = await conn.execute(
        'SELECT _id, username, message, photo, timestamp FROM posts WHERE _id = ?',
        [replyTo.postId]
      );
      
      if (!replyPost) {
        await conn.rollback();
        return res.status(400).json({ message: 'Reply post not found' });
      }
      
      replyToData = {
        postId: replyPost._id,
        username: replyPost.username,
        message: replyPost.message,
        photo: replyPost.photo,
        timestamp: replyPost.timestamp
      };
    }

    // Insert the new post
    const [{ insertId: postId }] = await conn.execute(
      `INSERT INTO posts (message, timestamp, username, sessionId, likes, likedBy, photo, tags, replyTo, categories)
       VALUES (?, NOW(), ?, ?, 0, '[]', ?, ?, ?, NULL)`,
      [
        message || '',
        username,
        sessionId,
        photo || null,
        JSON.stringify(extractedTags),
        replyToData ? JSON.stringify(replyToData) : null
      ]
    );

    // Prepare response object
    const newPost = {
      _id: postId,
      message: message || '',
      timestamp: new Date(),
      username,
      likes: 0,
      likedBy: [],
      photo: photo || null,
      profilePicture: null,
      tags: extractedTags,
      replyTo: replyToData,
      categories: null
    };

    // Commit the transaction first
    await conn.commit();
    
    // Send response immediately
    res.status(201).json(newPost);

    // Send notifications asynchronously (non-blocking)
    setImmediate(() => {
      sendNotifications(conn, {
        username,
        postId,
        message,
        photo,
        tags: extractedTags,
        replyTo: replyToData
      }).catch(error => {
        console.error('Error sending notifications:', error);
      });
    });

  } catch (error) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (rollbackError) {
        console.error('Rollback error:', rollbackError);
      }
    }
    console.error('Post creation error:', error);
    res.status(500).json({ message: 'Error saving post' });
  } finally {
    if (conn) conn.release();
  }
};

module.exports = handler;
