const { promisePool } = require('../utils/db');

const allowedOrigins = ['http://localhost:5173', '*'];

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function handler(req, res) {
  setCorsHeaders(req, res); // ✅ Apply CORS headers

  if (req.method === 'OPTIONS') {
    return res.status(200).end(); // ✅ Handle preflight
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ message: '_id (post ID) is required' });
  }

  try {
    const query = `
      SELECT 
        _id, message, timestamp, username, sessionId, 
        likes, dislikes, likedBy, dislikedBy, comments, photo 
      FROM posts 
      WHERE _id = ?
    `;

    const [results] = await promisePool.execute(query, [id]);

    if (results.length === 0) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const post = results[0];

    const formattedPost = {
      _id: post._id,
      message: post.message,
      timestamp: post.timestamp,
      username: post.username,
      sessionId: post.sessionId,
      likes: post.likes,
      dislikes: post.dislikes,
      likedBy: post.likedBy ? JSON.parse(post.likedBy || '[]') : [],
      dislikedBy: post.dislikedBy ? JSON.parse(post.dislikedBy || '[]') : [],
      comments: post.comments ? JSON.parse(post.comments || '[]') : [],
      photo: post.photo
        ? (post.photo.startsWith('http') || post.photo.startsWith('data:image/')
          ? post.photo
          : `data:image/jpeg;base64,${post.photo.toString('base64')}`)
        : null,
    };

    return res.status(200).json({ post: formattedPost });
  } catch (error) {
    console.error('❌ Error fetching post by ID:', error);
    return res.status(500).json({ message: 'Error retrieving post', error });
  }
}

module.exports = handler; // ✅ CommonJS export

