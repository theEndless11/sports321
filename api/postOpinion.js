const { promisePool } = require('../utils/db');

const allowedOrigins = [
  'https://latestnewsandaffairs.site',
  'http://localhost:5173'
];

const setCorsHeaders = (req, res) => {
  const o = req.headers.origin;
  if (allowedOrigins.includes(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
};

const classifyPostContent = async (text) => {
  if (!text || text.trim().length < 10) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch('https://hydra-yaqp.onrender.com/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const { label } = await resp.json();
    const map = { story_rant: 'Story/Rant', sports: 'Sports', entertainment: 'Entertainment', news: 'News' };
    return map[label.toLowerCase()] || null;
  } catch (_) {
    return null;
  }
};

const sendNotifications = async (conn, { username, postId, message, photo, tags, replyTo }) => {
  const tasks = [];
  // followers
  tasks.push((async () => {
    const [f] = await conn.execute(
      `SELECT follower AS username
         FROM follows
         WHERE following = ? AND relationship_status IN ('none','accepted') AND follower != ?`,
      [username, username]
    );
    if (!f.length) return;
    const preview = message ? message.slice(0, 50) + (message.length > 50 ? '…' : '') : (photo ? 'shared a photo' : 'made a post');
    const notif = `${username} posted: ${preview}`;
    const meta = JSON.stringify({ postId, postType: photo ? 'photo' : 'text', preview });
    await conn.execute(
      `INSERT INTO notifications (recipient, sender, type, message, metadata)
       VALUES ${f.map(() => '(?,?,?,?,?)').join(',')}`,
      f.flatMap(({ username: u }) => [u, username, 'new_post', notif, meta])
    );
  })());
  // tags
  if (tags?.length) {
    tasks.push((async () => {
      const uniq = [...new Set(tags.filter(t => t !== username))];
      if (!uniq.length) return;
      const [valid] = await conn.execute(
        `SELECT username FROM users WHERE username IN (${uniq.map(() => '?').join(',')})`,
        uniq
      );
      if (!valid.length) return;
      const preview2 = message ? message.slice(0, 30) + (message.length > 30 ? '…' : '') : 'a post';
      const notif2 = `${username} mentioned you in ${preview2}`;
      const meta2 = JSON.stringify({ postId, mentionType: 'tag' });
      await conn.execute(
        `INSERT INTO notifications (recipient, sender, type, message, metadata)
         VALUES ${valid.map(() => '(?,?,?,?,?)').join(',')}`,
        valid.flatMap(({ username: u }) => [u, username, 'tag_mention', notif2, meta2])
      );
    })());
  }
  // reply
  if (replyTo?.username && replyTo.username !== username) {
    tasks.push((async () => {
      const [exists] = await conn.execute('SELECT 1 FROM users WHERE username = ? LIMIT 1', [replyTo.username]);
      if (!exists.length) return;
      const preview3 = message ? message.slice(0, 40) + (message.length > 40 ? '…' : '') : 'replied to your post';
      const notif3 = `${username} replied: ${preview3}`;
      const meta3 = JSON.stringify({ postId, replyType: 'post_reply' });
      await conn.execute(
        `INSERT INTO notifications (recipient, sender, type, message, metadata)
         VALUES (?,?,?,?,?)`,
        [replyTo.username, username, 'post_reply', notif3, meta3]
      );
    })());
  }
  await Promise.allSettled(tasks);
};

const handler = async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'PUT' || req.method === 'PATCH') {
    const { postId, action, username } = req.body;
    if (!postId || !action || !username || !['like', 'unlike'].includes(action)) {
      return res.status(400).json({ message: 'Invalid request' });
    }
    try {
      const [[post]] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);
      if (!post) return res.status(404).json({ message: 'Post not found' });

      let likedBy = JSON.parse(post.likedBy || '[]');
      if (action === 'like' && likedBy.includes(username)) {
        return res.status(400).json({ message: 'Already liked' });
      }
      if (action === 'unlike' && !likedBy.includes(username)) {
        return res.status(400).json({ message: 'Not liked yet' });
      }
      likedBy = action === 'like' ? [...likedBy, username] : likedBy.filter(u => u !== username);
      const likes = action === 'like' ? post.likes + 1 : post.likes - 1;
      await promisePool.execute('UPDATE posts SET likes = ?, likedBy = ? WHERE _id = ?', [likes, JSON.stringify(likedBy), postId]);

      return res.status(200).json({
        _id: postId,
        message: post.message,
        timestamp: post.timestamp,
        username: post.username,
        likes,
        likedBy,
        photo: post.photo,
        profilePicture: post.profilePicture,
        tags: JSON.parse(post.tags || '[]'),
        replyTo: JSON.parse(post.replyTo || 'null'),
        categories: post.categories || null
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: 'Error updating post' });
    }
  }

  if (req.method === 'POST') {
    const { message, username, sessionId, photo, tags, replyTo } = req.body;
    if (!username || !sessionId || (!message && !photo)) {
      return res.status(400).json({ message: 'Invalid request' });
    }

    const conn = await promisePool.getConnection();
    await conn.beginTransaction();
    try {
      let profilePicture = 'https://latestnewsandaffairs.site/public/pfp1.jpg';
      const [[ur]] = await conn.execute('SELECT profile_picture FROM users WHERE username = ? LIMIT 1', [username]);
      if (ur?.profile_picture) profilePicture = ur.profile_picture;

      const extractedTags = tags || [...new Set((message?.match(/@(\w+)/g) || []).map(t => t.slice(1)))];
      let replyToData = null;
      if (replyTo?.postId) {
        const [[rp]] = await conn.execute('SELECT _id,username,message,photo,timestamp FROM posts WHERE _id = ?', [replyTo.postId]);
        if (!rp) {
          await conn.rollback();
          return res.status(400).json({ message: 'Reply post not found' });
        }
        replyToData = { postId: rp._id, username: rp.username, message: rp.message, photo: rp.photo, timestamp: rp.timestamp };
      }

      const [{ insertId: postId }] = await conn.execute(
        `INSERT INTO posts (message, timestamp, username, sessionId, likes, likedBy, photo, tags, replyTo, categories)
         VALUES (?, NOW(), ?, ?, 0, ?, ?, ?, ?, ?)`,
        [message || '', username, sessionId, '[]', photo || null, JSON.stringify(extractedTags), replyToData ? JSON.stringify(replyToData) : null, null]
      );

      const newPost = {
        _id: postId,
        message: message || '',
        timestamp: new Date(),
        username,
        likes: 0,
        likedBy: [],
        photo: photo || null,
        profilePicture,
        tags: extractedTags,
        replyTo: replyToData,
        categories: null
      };

      await sendNotifications(conn, { username, postId, message, photo, tags: extractedTags, replyTo: replyToData });

      const category = await classifyPostContent(message);
      if (category) {
        await conn.execute('UPDATE posts SET categories = ? WHERE _id = ?', [category, postId]);
        newPost.categories = category;
      }

      await conn.commit();
      return res.status(201).json(newPost);
    } catch (err) {
      await conn.rollback();
      console.error(err);
      return res.status(500).json({ message: 'Error saving post' });
    } finally {
      conn.release();
    }
  }

  return res.status(405).json({ message: 'Method Not Allowed' });
};

module.exports = handler;
