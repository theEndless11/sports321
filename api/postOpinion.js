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

const sendPostNotificationsToFollowers = async (conn, username, postId, message, photo) => {
  try {
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
  } catch (error) {
    console.error('Error sending follower notifications:', error);
  }
};

const sendTagNotifications = async (conn, author, taggedUsers, postId, message) => {
  try {
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
  } catch (error) {
    console.error('Error sending tag notifications:', error);
  }
};

const sendReplyNotification = async (conn, replier, originalAuthor, postId, message) => {
  try {
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
  } catch (error) {
    console.error('Error sending reply notification:', error);
  }
};

const classifyPostContent = async (message, photo) => {
  if (!message || message.trim().length < 10) {
    console.log('Message too short for classification:', message?.length);
    return null;
  }

  try {
    console.log('Starting classification for message:', message.substring(0, 50) + '...');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch('https://api.uclassify.com/v1/uClassify/Topics/classify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Token TQoEnD7yLfCM' // ✅ Correct usage
      },
      body: JSON.stringify({
        texts: [message]
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error('uClassify API error:', response.status, await response.text());
      return null;
    }

    const data = await response.json();
    console.log('Classification completed successfully');
    
    const classification = data[0]?.classification;
    
    if (!classification) {
      console.log('No classification data received');
      return null;
    }

    const categoryMapping = {
      'sports': 'Sports',
      'recreation': 'Sports', 
      'health': 'Sports',
      'politics': 'News',
      'society': 'News',
      'law': 'News',
      'business': 'News',
      'economics': 'News',
      'humor': 'Funny',
      'entertainment': 'Entertainment',
      'arts': 'Entertainment',
      'games': 'Entertainment',
      'music': 'Entertainment',
      'movies': 'Entertainment',
      'television': 'Entertainment',
      'culture': 'Entertainment'
    };

    const mappedCategories = {};
    
    Object.entries(classification).forEach(([category, confidence]) => {
      const mappedCategory = categoryMapping[category.toLowerCase()];
      if (mappedCategory && confidence > 0.1) {
        mappedCategories[mappedCategory] = (mappedCategories[mappedCategory] || 0) + confidence;
      }
    });

    console.log('Mapped categories:', mappedCategories);

    const topCategories = Object.entries(mappedCategories)
      .filter(([_, confidence]) => confidence > 0.15)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 2)
      .map(([category, confidence]) => ({
        category,
        confidence: parseFloat(confidence.toFixed(3))
      }));

    console.log('Final categories:', topCategories);
    return topCategories.length > 0 ? topCategories : null;

  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('Classification timeout after 10 seconds');
    } else {
      console.error('Classification error:', error);
    }
    return null;
  }
};




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
        `INSERT INTO posts (message, timestamp, username, sessionId, likes, dislikes, likedBy, dislikedBy, comments, photo, tags, replyTo, categories)
         VALUES (?, NOW(), ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)`,
        [
          message || '',
          username,
          sessionId,
          '[]',
          '[]',
          '[]',
          photo || null,
          JSON.stringify(extractedTags),
          replyToData ? JSON.stringify(replyToData) : null,
          null
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
        replyTo: replyToData,
        categories: null
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

      const categories = await classifyPostContent(message, photo);
      const finalCategories = categories ? JSON.stringify(categories) : '[]';

      try {
        await conn.execute(
          'UPDATE posts SET categories = ? WHERE _id = ?',
          [finalCategories, postId]
        );
        newPost.categories = JSON.parse(finalCategories);
      } catch (updateError) {
        console.error('Failed to update post with categories:', updateError);
        newPost.categories = [];
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
