const cors = require('cors');
const { promisePool } = require('../utils/db'); // MySQL connection pool

// Configure CORS options
const corsOptions = {
    origin: 'https://latestnewsandaffairs.site', // Set your frontend URL
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
};

// Helper function to handle CORS manually (since it's serverless)
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', corsOptions.origin);
    res.setHeader('Access-Control-Allow-Methods', corsOptions.methods.join(', '));
    res.setHeader('Access-Control-Allow-Headers', corsOptions.allowedHeaders.join(', '));
};

// Delete comment or reply
const deleteCommentOrReply = async (postId, commentId, replyId, username, sessionId) => {
    try {
        if (replyId) {
            // Delete reply
            const [replies] = await promisePool.execute(
                'SELECT username, created_at FROM comments WHERE comment_id = ? AND parent_comment_id = ? AND post_id = ?',
                [replyId, commentId, postId]
            );

            if (!replies.length) {
                return { success: false, message: 'Reply not found', statusCode: 404 };
            }

            const reply = replies[0];
            
            // Check authorization (user can delete their own reply)
            if (reply.username !== username) {
                return { success: false, message: 'Unauthorized to delete this reply', statusCode: 403 };
            }

            // Delete the reply and its hearts
            await promisePool.execute('DELETE FROM comment_hearts WHERE comment_id = ?', [replyId]);
            await promisePool.execute('DELETE FROM comments WHERE comment_id = ?', [replyId]);

            return { success: true, message: 'Reply deleted successfully' };
        } else {
            // Delete comment and all its replies
            const [comments] = await promisePool.execute(
                'SELECT username, created_at FROM comments WHERE comment_id = ? AND post_id = ? AND parent_comment_id IS NULL',
                [commentId, postId]
            );

            if (!comments.length) {
                return { success: false, message: 'Comment not found', statusCode: 404 };
            }

            const comment = comments[0];
            
            // Check authorization (user can delete their own comment)
            if (comment.username !== username) {
                return { success: false, message: 'Unauthorized to delete this comment', statusCode: 403 };
            }

            // Get all reply IDs for this comment
            const [replies] = await promisePool.execute(
                'SELECT comment_id FROM comments WHERE parent_comment_id = ? AND post_id = ?',
                [commentId, postId]
            );

            const replyIds = replies.map(r => r.comment_id);

            // Delete hearts for comment and all its replies
            const allCommentIds = [commentId, ...replyIds];
            if (allCommentIds.length > 0) {
                const placeholders = allCommentIds.map(() => '?').join(',');
                await promisePool.execute(
                    `DELETE FROM comment_hearts WHERE comment_id IN (${placeholders})`,
                    allCommentIds
                );
            }

            // Delete all replies first
            await promisePool.execute(
                'DELETE FROM comments WHERE parent_comment_id = ? AND post_id = ?',
                [commentId, postId]
            );

            // Delete the main comment
            await promisePool.execute('DELETE FROM comments WHERE comment_id = ?', [commentId]);

            return { success: true, message: 'Comment and all replies deleted successfully' };
        }
    } catch (error) {
        console.error('Error deleting comment/reply:', error);
        throw error;
    }
};

// Serverless delete comment handler
module.exports = async function handler(req, res) {
    setCorsHeaders(res);
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'DELETE') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { postId, commentId, replyId, username, sessionId } = req.body;

    if (!postId || !commentId || !username) {
        return res.status(400).json({ message: 'Post ID, Comment ID, and Username are required' });
    }

    try {
        // Check if post exists
        const [posts] = await promisePool.execute('SELECT _id FROM posts WHERE _id = ?', [postId]);
        if (posts.length === 0) {
            return res.status(404).json({ message: 'Post not found' });
        }

        // Delete comment or reply
        const result = await deleteCommentOrReply(postId, commentId, replyId, username, sessionId);
        
        if (!result.success) {
            return res.status(result.statusCode).json({ message: result.message });
        }

        // Return success message
        return res.status(200).json({ message: result.message });

    } catch (error) {
        console.error("Error deleting comment/reply:", error);
        return res.status(500).json({ message: 'Error deleting comment/reply', error: error.message });
    }
};
