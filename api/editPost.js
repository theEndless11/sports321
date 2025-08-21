// postHandler.js

const { promisePool } = require('../utils/db');
const { v4: uuidv4 } = require('uuid');

// --- Utility ---
const setCorsHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
};

const normalizeComment = (c) => ({
  commentId: c.comment_id,
  parentCommentId: c.parent_comment_id || null,
  username: c.username,
  profilePicture: c.profile_picture || null,
  commentText: c.comment_text,
  createdAt: c.created_at,
  updatedAt: c.updated_at,
  hearts: c.hearts_count || 0,
  replies: [],
});

const buildCommentTree = (comments) => {
  const map = new Map();
  comments.forEach(c => {
    c.replies = [];
    map.set(c.commentId, c);
  });

  const tree = [];
  comments.forEach(c => {
    if (c.parentCommentId) {
      const parent = map.get(c.parentCommentId);
      if (parent) parent.replies.push(c);
      else tree.push(c);
    } else {
      tree.push(c);
    }
  });
  return tree;
};

const getPostWithComments = async (postId) => {
  const [[post]] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);
  if (!post) return null;

  const [commentsRaw] = await promisePool.execute(
    'SELECT * FROM comments WHERE post_id = ? ORDER BY created_at ASC', [postId]
  );

  const normalized = commentsRaw.map(normalizeComment);
  post.likedBy = JSON.parse(post.likedBy || '[]');
  post.comments = buildCommentTree(normalized);

  return post;
};

// --- Post Actions ---
const handlePostInteraction = async (req, res) => {
  const { postId, username, action, comment, reply, commentId, replyId } = req.body;

  if (!postId || !action || !username)
    return res.status(400).json({ message: 'Post ID, action, and username are required' });

  try {
    const [[post]] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    post.likedBy = JSON.parse(post.likedBy || '[]');
    let shouldUpdatePost = false;

    if (action === 'like') {
      if (post.likedBy.includes(username)) {
        post.likes -= 1;
        post.likedBy = post.likedBy.filter(u => u !== username);
      } else {
        post.likes += 1;
        post.likedBy.push(username);
      }
      shouldUpdatePost = true;
    }

    else if (action === 'comment') {
      if (!comment?.trim()) return res.status(400).json({ message: 'Comment cannot be empty' });

      const newCommentId = commentId || uuidv4();
      await promisePool.execute(
        'INSERT INTO comments (comment_id, post_id, username, comment_text) VALUES (?, ?, ?, ?)',
        [newCommentId, postId, username, comment]
      );
    }

    else if (action === 'reply') {
      if (!reply?.trim()) return res.status(400).json({ message: 'Reply cannot be empty' });

      const [[parent]] = await promisePool.execute(
        'SELECT comment_id FROM comments WHERE comment_id = ? AND post_id = ?',
        [commentId, postId]
      );
      if (!parent) return res.status(404).json({ message: 'Parent comment not found' });

      const newReplyId = replyId || uuidv4();
      await promisePool.execute(
        'INSERT INTO comments (comment_id, post_id, parent_comment_id, username, comment_text) VALUES (?, ?, ?, ?, ?)',
        [newReplyId, postId, commentId, username, reply]
      );
    }

    else if (action === 'heart comment') {
      const [[commentExists]] = await promisePool.execute(
        'SELECT comment_id FROM comments WHERE comment_id = ? AND post_id = ?',
        [commentId, postId]
      );
      if (!commentExists) return res.status(404).json({ message: 'Comment not found' });

      const [existingHeart] = await promisePool.execute(
        'SELECT id FROM comment_hearts WHERE comment_id = ? AND username = ?',
        [commentId, username]
      );

      if (existingHeart.length) {
        await promisePool.execute(
          'DELETE FROM comment_hearts WHERE comment_id = ? AND username = ?',
          [commentId, username]
        );
      } else {
        await promisePool.execute(
          'INSERT INTO comment_hearts (comment_id, username) VALUES (?, ?)',
          [commentId, username]
        );
      }
    }

    else if (action === 'heart reply') {
      const [[replyExists]] = await promisePool.execute(
        'SELECT comment_id FROM comments WHERE comment_id = ? AND parent_comment_id = ?',
        [replyId, commentId]
      );
      if (!replyExists) return res.status(404).json({ message: 'Reply not found' });

      const [existingHeart] = await promisePool.execute(
        'SELECT id FROM comment_hearts WHERE comment_id = ? AND username = ?',
        [replyId, username]
      );

      if (existingHeart.length) {
        await promisePool.execute(
          'DELETE FROM comment_hearts WHERE comment_id = ? AND username = ?',
          [replyId, username]
        );
      } else {
        await promisePool.execute(
          'INSERT INTO comment_hearts (comment_id, username) VALUES (?, ?)',
          [replyId, username]
        );
      }
    }

    else {
      return res.status(400).json({ message: 'Invalid action' });
    }

    if (shouldUpdatePost) {
      await promisePool.execute(
        'UPDATE posts SET likes = ?, likedBy = ? WHERE _id = ?',
        [post.likes, JSON.stringify(post.likedBy), postId]
      );
    }

    const updatedPost = await getPostWithComments(postId);
    return res.status(200).json(updatedPost);

  } catch (error) {
    console.error('Post interaction error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// --- Handler ---
module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    return res.status(200).end();
  }

  setCorsHeaders(res);

  if (req.method === 'POST') {
    return await handlePostInteraction(req, res);
  }

  return res.status(405).json({ message: 'Method Not Allowed' });
};











