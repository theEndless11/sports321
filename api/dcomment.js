import { promisePool } from '../utils/db'; // MySQL connection pool
import fs from 'fs'; // File system module for local file deletion
// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://latestnewsandaffairs.site'); // Replace with your frontend URL
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

// Server-side delete comment handler
module.exports = async function handler(req, res) {
    const { postId, commentId, username, sessionId } = req.body;
  
    if (!postId || !commentId || !username) {
      return res.status(400).json({ message: 'Post ID, Comment ID, and Username are required' });
    }
  
    try {
      // Fetch the post and check if the comment exists
      const [posts] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);
  
      if (posts.length === 0) {
        return res.status(404).json({ message: 'Post not found' });
      }
  
      const post = posts[0];
      const commentIndex = post.comments.findIndex(c => String(c.commentId) === String(commentId));
  
      if (commentIndex === -1) {
        return res.status(404).json({ message: 'Comment not found' });
      }
  
      const comment = post.comments[commentIndex];
  
      // Check if the logged-in user matches the comment’s username or sessionId
      if (comment.username !== username && sessionId !== comment.sessionId) {
        return res.status(403).json({ message: 'Unauthorized to delete this comment' });
      }
  
      // Delete the comment from the post’s comments array
      post.comments.splice(commentIndex, 1);
  
      // Update the post in the database
      await promisePool.execute(
        'UPDATE posts SET comments = ? WHERE _id = ?',
        [JSON.stringify(post.comments), postId]
      );
  
      return res.status(200).json({ message: 'Comment deleted successfully', comments: post.comments });
    } catch (error) {
      console.error("Error deleting comment:", error);
      res.status(500).json({ message: 'Error deleting comment', error });
    }
  };
  
