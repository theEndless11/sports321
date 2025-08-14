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
    console.log('Starting TextRazor classification for message:', message.substring(0, 50) + '...');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // Increased timeout for TextRazor
    
    // Prepare form data for TextRazor API
    const formData = new URLSearchParams();
    formData.append('text', message);
    formData.append('extractors', 'topics');
    formData.append('classifiers', 'textrazor_newscodes'); // News classification
    
    const response = await fetch('https://api.textrazor.com/', {
      method: 'POST',
      headers: {
        'X-TextRazor-Key': 'f2abfeb4c8109ec04dd89415b0e07208f9c8741e469f4208afc9cac7',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error('TextRazor API error:', response.status, await response.text());
      return null;
    }

    const data = await response.json();
    console.log('TextRazor classification completed successfully');
    
    // Extract categories from TextRazor response
    const categories = [];
    
    // Process topics (general categorization)
    if (data.response && data.response.topics) {
      data.response.topics.forEach(topic => {
        if (topic.score > 0.5) { // Only high confidence topics
          const categoryName = mapTextRazorCategory(topic.label);
          if (categoryName) {
            categories.push({
              category: categoryName,
              confidence: parseFloat(topic.score.toFixed(3)),
              source: 'topics'
            });
          }
        }
      });
    }
    
    // Process news categories if available
    if (data.response && data.response.categories) {
      data.response.categories.forEach(category => {
        if (category.score > 0.3) { // Lower threshold for news categories
          const categoryName = mapNewsCategory(category.label);
          if (categoryName) {
            categories.push({
              category: categoryName,
              confidence: parseFloat(category.score.toFixed(3)),
              source: 'news'
            });
          }
        }
      });
    }

    // Remove duplicates and sort by confidence
    const uniqueCategories = categories
      .reduce((acc, curr) => {
        const existing = acc.find(cat => cat.category === curr.category);
        if (!existing || existing.confidence < curr.confidence) {
          return [...acc.filter(cat => cat.category !== curr.category), curr];
        }
        return acc;
      }, [])
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3) // Top 3 categories
      .map(({ category, confidence }) => ({ category, confidence }));

    console.log('Final TextRazor categories:', uniqueCategories);
    return uniqueCategories.length > 0 ? uniqueCategories : null;

  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('TextRazor classification timeout after 15 seconds');
    } else {
      console.error('TextRazor classification error:', error);
    }
    return null;
  }
};

// Map TextRazor topic labels to our categories
const mapTextRazorCategory = (label) => {
  const lowerLabel = label.toLowerCase();
  
  // Sports mapping
  if (lowerLabel.includes('sport') || lowerLabel.includes('football') || 
      lowerLabel.includes('basketball') || lowerLabel.includes('soccer') ||
      lowerLabel.includes('tennis') || lowerLabel.includes('baseball') ||
      lowerLabel.includes('cricket') || lowerLabel.includes('golf') ||
      lowerLabel.includes('fitness') || lowerLabel.includes('exercise')) {
    return 'Sports';
  }
  
  // News/Politics mapping
  if (lowerLabel.includes('politic') || lowerLabel.includes('government') ||
      lowerLabel.includes('election') || lowerLabel.includes('policy') ||
      lowerLabel.includes('news') || lowerLabel.includes('current events') ||
      lowerLabel.includes('international') || lowerLabel.includes('domestic') ||
      lowerLabel.includes('economy') || lowerLabel.includes('business') ||
      lowerLabel.includes('finance') || lowerLabel.includes('market')) {
    return 'News';
  }
  
  // Entertainment mapping
  if (lowerLabel.includes('entertainment') || lowerLabel.includes('movie') ||
      lowerLabel.includes('music') || lowerLabel.includes('television') ||
      lowerLabel.includes('celebrity') || lowerLabel.includes('film') ||
      lowerLabel.includes('gaming') || lowerLabel.includes('art') ||
      lowerLabel.includes('culture') || lowerLabel.includes('media')) {
    return 'Entertainment';
  }
  
  // Funny/Humor mapping
  if (lowerLabel.includes('humor') || lowerLabel.includes('comedy') ||
      lowerLabel.includes('joke') || lowerLabel.includes('meme') ||
      lowerLabel.includes('funny') || lowerLabel.includes('satire')) {
    return 'Funny';
  }
  
  return null; // Unmapped categories
};

// Map news category codes to our categories
const mapNewsCategory = (categoryCode) => {
  const code = categoryCode.toLowerCase();
  
  // Sports codes
  if (code.includes('15') || code.includes('sport')) {
    return 'Sports';
  }
  
  // Politics/News codes (11-14, 02)
  if (code.includes('11') || code.includes('12') || code.includes('13') || 
      code.includes('14') || code.includes('02') || code.includes('politic') ||
      code.includes('government') || code.includes('economic')) {
    return 'News';
  }
  
  // Entertainment codes (01, 08)
  if (code.includes('01') || code.includes('08') || code.includes('entertainment') ||
      code.includes('lifestyle') || code.includes('art')) {
    return 'Entertainment';
  }
  
  return null;
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

      // Send notifications
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

      // Classify post content using TextRazor
      const categories = await classifyPostContent(message, photo);
      const finalCategories = categories ? JSON.stringify(categories) : '[]';

      try {
        await conn.execute(
          'UPDATE posts SET categories = ? WHERE _id = ?',
          [finalCategories, postId]
        );
        newPost.categories = JSON.parse(finalCategories);
        console.log(`Post ${postId} categorized as:`, newPost.categories);
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
