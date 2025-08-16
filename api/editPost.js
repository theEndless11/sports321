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

// Handle profile updates
const handleProfileUpdate = async (req, res) => {
  const { username, hobby, description, profilePicture, Music } = req.body;
  
  if (!username) {
    return res.status(400).json({ message: 'Username is required' });
  }

  try {
    // Handle Music field specifically (if provided)
    if (Music !== undefined) {
      await promisePool.execute('UPDATE users SET Music = ? WHERE username = ?', [Music, username]);
    }

    // Handle other profile fields
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

    // Execute profile updates if there are any
    if (updates.length) {
      values.push(username);
      await promisePool.execute(`UPDATE users SET ${updates.join(', ')} WHERE username = ?`, values);
    }

    return res.status(200).json({ message: 'Profile updated successfully' });
  } catch (error) {
    return res.status(500).json({ message: 'Error updating profile', error: error.message });
  }
};

// Handle post interactions
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

    let shouldUpdateDB = false;

   if (action === 'like') {
      shouldUpdatePost = handleLike(post, username);
    } 
    
    else if (action === 'heart comment') {
      // Check if comment exists
      const [comments] = await promisePool.execute(
        'SELECT comment_id FROM comments WHERE comment_id = ? AND post_id = ? AND is_deleted = FALSE',
        [commentId, postId]
      );
      
      if (comments.length === 0) {
        return res.status(404).json({ message: 'Comment not found' });
      }

      // Check if user already hearted this comment
      const [existingHeart] = await promisePool.execute(
        'SELECT id FROM comment_hearts WHERE comment_id = ? AND username = ?',
        [commentId, username]
      );

      if (existingHeart.length > 0) {
        // Remove heart
        await promisePool.execute(
          'DELETE FROM comment_hearts WHERE comment_id = ? AND username = ?',
          [commentId, username]
        );
      } else {
        // Add heart
        await promisePool.execute(
          'INSERT INTO comment_hearts (comment_id, username) VALUES (?, ?)',
          [commentId, username]
        );
      }
    } 
    
    else if (action === 'reply') {
      if (!reply || !reply.trim()) {
        return res.status(400).json({ message: 'Reply cannot be empty' });
      }
      
      // Check if parent comment exists
      const [parentComments] = await promisePool.execute(
        'SELECT comment_id FROM comments WHERE comment_id = ? AND post_id = ? AND is_deleted = FALSE',
        [commentId, postId]
      );
      
      if (parentComments.length === 0) {
        return res.status(404).json({ message: 'Parent comment not found' });
      }

      // Insert reply as a comment with parent_comment_id
      const newReplyId = replyId || uuidv4();
      await promisePool.execute(
        'INSERT INTO comments (comment_id, post_id, parent_comment_id, username, comment_text) VALUES (?, ?, ?, ?, ?)',
        [newReplyId, postId, commentId, username, reply]
      );
    } 
    
    else if (action === 'heart reply') {
      // Check if reply exists (reply is a comment with parent_comment_id)
      const [replies] = await promisePool.execute(
        'SELECT comment_id FROM comments WHERE comment_id = ? AND parent_comment_id = ? AND is_deleted = FALSE',
        [replyId, commentId]
      );
      
      if (replies.length === 0) {
        return res.status(404).json({ message: 'Reply not found' });
      }

      // Check if user already hearted this reply
      const [existingHeart] = await promisePool.execute(
        'SELECT id FROM comment_hearts WHERE comment_id = ? AND username = ?',
        [replyId, username]
      );

      if (existingHeart.length > 0) {
        // Remove heart
        await promisePool.execute(
          'DELETE FROM comment_hearts WHERE comment_id = ? AND username = ?',
          [replyId, username]
        );
      } else {
        // Add heart
        await promisePool.execute(
          'INSERT INTO comment_hearts (comment_id, username) VALUES (?, ?)',
          [replyId, username]
        );
      }
    } 
    
    else if (action === 'comment') {
      if (!comment || !comment.trim()) {
        return res.status(400).json({ message: 'Comment cannot be empty' });
      }
      
      const newCommentId = commentId || uuidv4();
      await promisePool.execute(
        'INSERT INTO comments (comment_id, post_id, username, comment_text) VALUES (?, ?, ?, ?)',
        [newCommentId, postId, username, comment]
      );
    } 
    
    else {
      return res.status(400).json({ message: 'Invalid action' });
    }

    // Update post if likes changed
    if (shouldUpdatePost) {
      await promisePool.execute(
        'UPDATE posts SET likes = ?, likedBy = ? WHERE _id = ?',
        [post.likes, JSON.stringify(post.likedBy), postId]
      );
    }

    // Return the updated post with comments
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

    // Determine request type based on body content or explicit requestType field
    if (requestType === 'profile' || (req.body.description !== undefined || req.body.profilePicture !== undefined || req.body.Music !== undefined || req.body.hobby !== undefined)) {
      return await handleProfileUpdate(req, res);
    } else if (requestType === 'post' || req.body.postId) {
      return await handlePostInteraction(req, res);
    } else {
      return res.status(400).json({ message: 'Invalid request: unable to determine request type' });
    }
  }

  return res.status(405).json({ message: 'Method Not Allowed' });
};







