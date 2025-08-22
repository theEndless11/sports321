const { promisePool } = require('../utils/db');

// CORS setup
const allowedOrigins = ['https://latestnewsandaffairs.site', 'http://localhost:5173'];
const setCorsHeaders = (req, res) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
};

// Delete reply
const deleteReply = async (postId, commentId, replyId, username) => {
  const [[reply]] = await promisePool.execute(
    `SELECT username FROM comments WHERE comment_id = ? AND parent_comment_id = ? AND post_id = ?`,
    [replyId, commentId, postId]
  );
  if (!reply) return { success: false, statusCode: 404, message: 'Reply not found' };
  if (reply.username !== username) return { success: false, statusCode: 403, message: 'Unauthorized' };

  await promisePool.execute('START TRANSACTION');
  try {
    await promisePool.execute('DELETE FROM comment_hearts WHERE comment_id = ?', [replyId]);
    await promisePool.execute('DELETE FROM comments WHERE comment_id = ?', [replyId]);
    await promisePool.execute('COMMIT');
    return { success: true, type: 'reply', deletedId: replyId };
  } catch (err) {
    await promisePool.execute('ROLLBACK');
    throw err;
  }
};

// Delete comment and its replies
const deleteComment = async (postId, commentId, username) => {
  const [[comment]] = await promisePool.execute(
    `SELECT username FROM comments WHERE comment_id = ? AND post_id = ? AND parent_comment_id IS NULL`,
    [commentId, postId]
  );
  if (!comment) return { success: false, statusCode: 404, message: 'Comment not found' };
  if (comment.username !== username) return { success: false, statusCode: 403, message: 'Unauthorized' };

  const [replies] = await promisePool.execute(
    `SELECT comment_id FROM comments WHERE parent_comment_id = ? AND post_id = ?`,
    [commentId, postId]
  );
  const replyIds = replies.map(r => r.comment_id);
  const allIds = [commentId, ...replyIds];

  await promisePool.execute('START TRANSACTION');
  try {
    if (allIds.length) {
      const placeholders = allIds.map(() => '?').join(',');
      await promisePool.execute(`DELETE FROM comment_hearts WHERE comment_id IN (${placeholders})`, allIds);
      await promisePool.execute(`DELETE FROM comments WHERE comment_id IN (${placeholders})`, allIds);
    }
    await promisePool.execute('COMMIT');
    return {
      success: true,
      type: 'comment',
      deletedId: commentId,
      deletedReplies: replyIds.length
    };
  } catch (err) {
    await promisePool.execute('ROLLBACK');
    throw err;
  }
};

// Route handler
module.exports = async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'DELETE') return res.status(405).json({ message: 'Method Not Allowed' });

  const { postId, commentId, replyId, username } = req.body;
  if (!postId || !commentId || !username)
    return res.status(400).json({ message: 'postId, commentId, and username are required' });

  try {
    const [[post]] = await promisePool.execute('SELECT _id FROM posts WHERE _id = ?', [postId]);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const result = replyId
      ? await deleteReply(postId, commentId, replyId, username)
      : await deleteComment(postId, commentId, username);

    if (!result.success)
      return res.status(result.statusCode || 500).json({ message: result.message });

    return res.status(200).json({
      message: `${result.type === 'reply' ? 'Reply' : 'Comment'} deleted`,
      deletedId: result.deletedId,
      deletedType: result.type,
      deletedRepliesCount: result.deletedReplies || 0
    });
  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

