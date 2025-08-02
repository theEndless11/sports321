import { promisePool } from '../utils/db';
import fs from 'fs';

const allowedOrigins = ['http://localhost:5173']; // Add more if needed

const setCorsHeaders = (req, res) => {
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

const handlePostDeletion = async (postId, username) => {
  const [posts] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);
  if (!posts.length) return { status: 404, message: 'Post not found' };

  const post = posts[0];
  if (post.username !== username) return { status: 403, message: 'You can only delete your own posts' };

  if (post.photo) {
    const filePath = `./uploads/${postId}.jpg`;
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  await promisePool.execute('DELETE FROM posts WHERE _id = ?', [postId]);
  return { status: 200, message: 'Post deleted successfully' };
};

const handlePostUpdate = async (id, message, timestamp, username) => {
  const [posts] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [id]);
  if (!posts.length) return { status: 404, message: 'Post not found' };

  const post = posts[0];
  if (post.username !== username) return { status: 403, message: 'You can only edit your own posts' };

  await promisePool.execute(
    'UPDATE posts SET message = ?, timestamp = ? WHERE _id = ?',
    [message, timestamp, id]
  );

  return { status: 200, message: 'Post updated successfully', post };
};

export default async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { postId, username, sessionId, id, message, timestamp } = req.body;

  if (req.method === 'DELETE') {
    if (!postId || !username || !sessionId) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    const result = await handlePostDeletion(postId, username);
    return res.status(result.status).json({ message: result.message });
  }

  if (req.method === 'PUT') {
    if (!id || !message || !username || !timestamp) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    const result = await handlePostUpdate(id, message, timestamp, username);
    return res.status(result.status).json(result.message ? { message: result.message, post: result.post } : { message: result.message });
  }

  return res.status(405).json({ message: 'Method Not Allowed' });
}
