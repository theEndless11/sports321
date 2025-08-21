const { promisePool } = require('../utils/db');
const { v4: uuidv4 } = require('uuid');

// CORS headers
const setCorsHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
};

// Like/unlike logic
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

// Get post with comments
const getPostWithComments = async (postId) => {
  const [posts] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);
  const [comments] = await promisePool.execute(
    'SELECT * FROM comments WHERE post_id = ?',
    [postId]
  );

  if (!posts.length) return null;

  const post = posts[0];
  post.likedBy = JSON.parse(post.likedBy || '[]');
  post.comments = comments;

  return post;
};

// Profile update logic
const handleProfileUpdate = async (req, res) => {
  const { username, hobby, description, profilePicture, Music } = req.body;
  if (!username) return res.status(400).json({ message: 'Username is required' });

  try {
    if (Music !== undefined) {
      await promisePool.execute('UPDATE users SET Music = ? WHERE username = ?', [Music, username]);
    }

    const updates = [];
    const values = [];

    if (hobby !== undefined) {
      updates.push('hobby = ?');
      values.push(hobby);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    if (profilePicture !== undefined) {
      updates.push('profile_picture = ?');
      values.push(profilePicture);
    }

    if (updates.length) {
      values.push(username);
      await promisePool.execute(`UPDATE users SET ${updates.join(', ')} WHERE username = ?`, values);
    }

    return res.status(200).json({ message: 'Profile updated successfully' });
  } catch (error) {
    return res.status(500).json({ message: 'Error updating profile', error: error.message });
  }
};
// Post interactions
const handlePostInteraction = async (req, res) => {
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

    let shouldUpdatePost = false;

    if (action === 'like') {
      shouldUpdatePost = handleLike(post, username);
    }
    else if (action === 'heart comment') {
      // Fixed: Handle both NULL and '*NULL*' string values
      const [comments] = await promisePool.execute(
        'SELECT comment_id FROM comments WHERE comment_id = ? AND post_id = ? AND (parent_comment_id IS NULL OR parent_comment_id = ?)',
        [commentId, postId, '*NULL*']
      );
      if (!comments.length) return res.status(404).json({ message: 'Comment not found' });

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
    else if (action === 'reply') {
  console.log('[REPLY] Incoming reply:', {
    postId,
    commentId,
    reply,
    username,
    replyId
  });

  if (!reply || !reply.trim()) {
    console.warn('[REPLY] Empty reply text');
    return res.status(400).json({ message: 'Reply cannot be empty' });
  }

  const [parentComments] = await promisePool.execute(
    'SELECT comment_id FROM comments WHERE comment_id = ? AND post_id = ? AND (parent_comment_id IS NULL OR parent_comment_id = ?)',
    [commentId, postId, '*NULL*']
  );

  if (!parentComments.length) {
    console.warn('[REPLY] Parent comment not found:', commentId);
    return res.status(404).json({ message: 'Parent comment not found' });
  }

  const newReplyId = replyId || uuidv4();
  console.log('[REPLY] Inserting reply with ID:', newReplyId);

  try {
    const [result] = await promisePool.execute(
      'INSERT INTO comments (comment_id, post_id, parent_comment_id, username, comment_text) VALUES (?, ?, ?, ?, ?)',
      [newReplyId, postId, commentId, username, reply]
    );

    console.log('[REPLY] Insert success:', result);
    return res.status(200).json({ message: 'Reply inserted successfully', replyId: newReplyId });
  } catch (err) {
    console.error('[REPLY] Insert failed:', err);
    return res.status(500).json({ message: 'Reply insert failed', error: err.message });
  }
}

    else if (action === 'heart reply') {
      const [replies] = await promisePool.execute(
        'SELECT comment_id FROM comments WHERE comment_id = ? AND parent_comment_id = ?',
        [replyId, commentId]
      );
      if (!replies.length) return res.status(404).json({ message: 'Reply not found' });

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
    else if (action === 'comment') {
      if (!comment || !comment.trim()) return res.status(400).json({ message: 'Comment cannot be empty' });

      const newCommentId = commentId || uuidv4();
      await promisePool.execute(
        'INSERT INTO comments (comment_id, post_id, username, comment_text) VALUES (?, ?, ?, ?)',
        [newCommentId, postId, username, comment]
      );
    }
    else {
      return res.status(400).json({ message: 'Invalid action' });
    }

    // Update likes if needed
    if (shouldUpdatePost) {
      await promisePool.execute(
        'UPDATE posts SET likes = ?, likedBy = ? WHERE _id = ?',
        [post.likes, JSON.stringify(post.likedBy), postId]
      );
    }

    const updatedPost = await getPostWithComments(postId);
    return res.status(200).json(updatedPost);

  } catch (error) {
    console.error('Error updating post:', error);
    return res.status(500).json({ message: 'Error updating post', error: error.message });
  }
};

// Main handler
module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    return res.status(200).end();
  }

  setCorsHeaders(res);

  if (req.method === 'POST') {
    const { requestType } = req.body;

    if (
      requestType === 'profile' ||
      req.body.description !== undefined ||
      req.body.profilePicture !== undefined ||
      req.body.Music !== undefined ||
      req.body.hobby !== undefined
    ) {
      return await handleProfileUpdate(req, res);
    }

    if (requestType === 'post' || req.body.postId) {
      return await handlePostInteraction(req, res);
    }

    return res.status(400).json({ message: 'Invalid request: unable to determine request type' });
  }

  return res.status(405).json({ message: 'Method Not Allowed' });
};











