const { promisePool } = require('../utils/db');
const { v4: uuidv4 } = require('uuid');

// Set CORS headers
const setCorsHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
   res.setHeader('Access-Control-Allow-Credentials', 'true'); // <-- important
};

// Handle like/unlike
const handleLike = (post, username) => {
  const likedBy = post.likedBy;
  if (likedBy.includes(username)) {
    post.likes -= 1;
    post.likedBy = likedBy.filter(user => user !== username);
  } else {
    post.likes += 1;
    post.likedBy.push(username);
  }
  return true;
};

// Handle hearting comments or replies
const handleHeart = (target, username) => {
  if (target.heartedBy.includes(username)) {
    target.hearts -= 1;
    target.heartedBy = target.heartedBy.filter(user => user !== username);
  } else {
    target.hearts += 1;
    target.heartedBy.push(username);
  }
  return true;
};

// Main handler
module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    return res.status(200).end();
  }

  setCorsHeaders(res);
  const { postId, username, action, comment, reply, commentId, replyId } = req.body;

  if (!postId || !action || !username) {
    return res.status(400).json({ message: 'Post ID, action, and username are required' });
  }

  try {
    const [posts] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);
    if (!posts.length) return res.status(404).json({ message: 'Post not found' });

    const post = posts[0];
    post.likedBy = JSON.parse(post.likedBy || '[]');
    post.comments = JSON.parse(post.comments || '[]');

    let shouldUpdateDB = false;

    if (action === 'like') {
      shouldUpdateDB = handleLike(post, username);

    } else if (action === 'heart comment') {
      const commentObj = post.comments.find(c => String(c.commentId) === String(commentId));
      if (!commentObj) return res.status(404).json({ message: 'Comment not found' });

      commentObj.heartedBy = commentObj.heartedBy || [];
      commentObj.hearts = commentObj.hearts || 0;
      shouldUpdateDB = handleHeart(commentObj, username);

    } else if (action === 'reply') {
      if (!reply || !reply.trim()) return res.status(400).json({ message: 'Reply cannot be empty' });

      const commentObj = post.comments.find(c => String(c.commentId) === String(commentId));
      if (!commentObj) return res.status(404).json({ message: 'Comment not found' });

      commentObj.replies = commentObj.replies || [];
      commentObj.replies.push({
        replyId: uuidv4(),
        username,
        reply,
        timestamp: new Date(),
        hearts: 0,
        heartedBy: []
      });
      shouldUpdateDB = true;

    } else if (action === 'heart reply') {
      const commentObj = post.comments.find(c => String(c.commentId) === String(commentId));
      if (!commentObj) return res.status(404).json({ message: 'Comment not found' });

      commentObj.replies = commentObj.replies || [];
      const replyObj = commentObj.replies.find(r => String(r.replyId) === String(replyId));
      if (!replyObj) return res.status(404).json({ message: 'Reply not found' });

      replyObj.heartedBy = replyObj.heartedBy || [];
      replyObj.hearts = replyObj.hearts || 0;
      shouldUpdateDB = handleHeart(replyObj, username);

    } else if (action === 'comment') {
      if (!comment || !comment.trim()) return res.status(400).json({ message: 'Comment cannot be empty' });

      post.comments.push({
        commentId: commentId || uuidv4(),
        username,
        comment,
        timestamp: new Date(),
        hearts: 0,
        heartedBy: [],
        replies: []
      });
      shouldUpdateDB = true;

    } else {
      return res.status(400).json({ message: 'Invalid action' });
    }

    if (shouldUpdateDB) {
      await promisePool.execute(
        'UPDATE posts SET likes = ?, likedBy = ?, comments = ? WHERE _id = ?',
        [
          post.likes,
          JSON.stringify(post.likedBy),
          JSON.stringify(post.comments),
          postId
        ]
      );
    }

    return res.status(200).json(post);
  } catch (error) {
    return res.status(500).json({ message: 'Error updating post', error: error.message });
  }
};





