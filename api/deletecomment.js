const cors = require('cors');
const { promisePool } = require('../utils/db'); // MySQL connection pool

// Configure CORS options
const corsOptions = {
    origin: ['https://latestnewsandaffairs.site', 'http://localhost:5173'], // Added localhost for development
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

// Helper function to handle CORS manually (since it's serverless)
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', corsOptions.origin[0]); // Use primary origin
    res.setHeader('Access-Control-Allow-Methods', corsOptions.methods.join(', '));
    res.setHeader('Access-Control-Allow-Headers', corsOptions.allowedHeaders.join(', '));
    res.setHeader('Access-Control-Allow-Credentials', 'true');
};

// Validate input parameters
const validateInput = (postId, commentId, username, replyId = null) => {
    const errors = [];
    
    if (!postId || typeof postId !== 'string') {
        errors.push('Valid Post ID is required');
    }
    
    if (!commentId || typeof commentId !== 'string') {
        errors.push('Valid Comment ID is required');
    }
    
    if (!username || typeof username !== 'string') {
        errors.push('Valid Username is required');
    }
    
    if (replyId && typeof replyId !== 'string') {
        errors.push('Reply ID must be a valid string if provided');
    }
    
    return errors;
};

// Delete reply from comment
const deleteReply = async (postId, commentId, replyId, username) => {
    try {
        // Find the reply and verify it exists and belongs to the user
        const [replies] = await promisePool.execute(
            `SELECT comment_id, username, created_at 
             FROM comments 
             WHERE comment_id = ? AND parent_comment_id = ? AND post_id = ?`,
            [replyId, commentId, postId]
        );

        if (!replies.length) {
            return { 
                success: false, 
                message: 'Reply not found or does not belong to this comment', 
                statusCode: 404 
            };
        }

        const reply = replies[0];
        
        // Check authorization
        if (reply.username !== username) {
            return { 
                success: false, 
                message: 'You can only delete your own replies', 
                statusCode: 403 
            };
        }

        // Start transaction for atomic deletion
        await promisePool.execute('START TRANSACTION');

        try {
            // Delete reply hearts first (foreign key constraint)
            await promisePool.execute(
                'DELETE FROM comment_hearts WHERE comment_id = ?', 
                [replyId]
            );

            // Delete the reply
            const [deleteResult] = await promisePool.execute(
                'DELETE FROM comments WHERE comment_id = ?', 
                [replyId]
            );

            if (deleteResult.affectedRows === 0) {
                throw new Error('Failed to delete reply');
            }

            await promisePool.execute('COMMIT');
            
            return { 
                success: true, 
                message: 'Reply deleted successfully',
                deletedId: replyId,
                type: 'reply'
            };
        } catch (error) {
            await promisePool.execute('ROLLBACK');
            throw error;
        }
    } catch (error) {
        console.error('Error deleting reply:', error);
        throw error;
    }
};

// Delete comment and all its replies
const deleteComment = async (postId, commentId, username) => {
    try {
        // Find the comment and verify it exists and belongs to the user
        const [comments] = await promisePool.execute(
            `SELECT comment_id, username, created_at 
             FROM comments 
             WHERE comment_id = ? AND post_id = ? AND parent_comment_id IS NULL`,
            [commentId, postId]
        );

        if (!comments.length) {
            return { 
                success: false, 
                message: 'Comment not found', 
                statusCode: 404 
            };
        }

        const comment = comments[0];
        
        // Check authorization
        if (comment.username !== username) {
            return { 
                success: false, 
                message: 'You can only delete your own comments', 
                statusCode: 403 
            };
        }

        // Get all reply IDs for this comment
        const [replies] = await promisePool.execute(
            `SELECT comment_id 
             FROM comments 
             WHERE parent_comment_id = ? AND post_id = ?`,
            [commentId, postId]
        );

        const replyIds = replies.map(r => r.comment_id);
        const allCommentIds = [commentId, ...replyIds];

        // Start transaction for atomic deletion
        await promisePool.execute('START TRANSACTION');

        try {
            // Delete hearts for comment and all its replies
            if (allCommentIds.length > 0) {
                const placeholders = allCommentIds.map(() => '?').join(',');
                await promisePool.execute(
                    `DELETE FROM comment_hearts WHERE comment_id IN (${placeholders})`,
                    allCommentIds
                );
            }

            // Delete all replies first (child records)
            if (replyIds.length > 0) {
                const replyPlaceholders = replyIds.map(() => '?').join(',');
                await promisePool.execute(
                    `DELETE FROM comments WHERE comment_id IN (${replyPlaceholders})`,
                    replyIds
                );
            }

            // Delete the main comment (parent record)
            const [deleteResult] = await promisePool.execute(
                'DELETE FROM comments WHERE comment_id = ?', 
                [commentId]
            );

            if (deleteResult.affectedRows === 0) {
                throw new Error('Failed to delete comment');
            }

            await promisePool.execute('COMMIT');

            return { 
                success: true, 
                message: `Comment and ${replyIds.length} ${replyIds.length === 1 ? 'reply' : 'replies'} deleted successfully`,
                deletedId: commentId,
                deletedReplies: replyIds.length,
                type: 'comment'
            };
        } catch (error) {
            await promisePool.execute('ROLLBACK');
            throw error;
        }
    } catch (error) {
        console.error('Error deleting comment:', error);
        throw error;
    }
};

// Main delete function that routes to appropriate handler
const deleteCommentOrReply = async (postId, commentId, replyId, username, sessionId) => {
    try {
        // Validate that post exists first
        const [posts] = await promisePool.execute(
            'SELECT _id FROM posts WHERE _id = ?', 
            [postId]
        );
        
        if (!posts.length) {
            return { 
                success: false, 
                message: 'Post not found', 
                statusCode: 404 
            };
        }

        // Route to appropriate deletion handler
        if (replyId) {
            return await deleteReply(postId, commentId, replyId, username);
        } else {
            return await deleteComment(postId, commentId, username);
        }
    } catch (error) {
        console.error('Error in deleteCommentOrReply:', error);
        return { 
            success: false, 
            message: 'Internal server error occurred while deleting', 
            statusCode: 500 
        };
    }
};

// Serverless delete comment/reply handler
module.exports = async function handler(req, res) {
    setCorsHeaders(res);
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow DELETE method
    if (req.method !== 'DELETE') {
        return res.status(405).json({ 
            message: 'Method Not Allowed. Only DELETE requests are supported.',
            allowedMethods: ['DELETE']
        });
    }

    try {
        const { postId, commentId, replyId, username, sessionId } = req.body;

        // Validate input
        const validationErrors = validateInput(postId, commentId, username, replyId);
        if (validationErrors.length > 0) {
            return res.status(400).json({ 
                message: 'Validation failed',
                errors: validationErrors
            });
        }

        // Log the deletion request (for debugging/audit purposes)
        console.log(`Delete request - Post: ${postId}, Comment: ${commentId}, Reply: ${replyId || 'N/A'}, User: ${username}`);

        // Perform deletion
        const result = await deleteCommentOrReply(postId, commentId, replyId, username, sessionId);
        
        if (!result.success) {
            return res.status(result.statusCode || 500).json({ 
                message: result.message 
            });
        }

        // Return success response with details
        return res.status(200).json({ 
            message: result.message,
            deletedId: result.deletedId,
            deletedType: result.type,
            ...(result.deletedReplies !== undefined && { deletedRepliesCount: result.deletedReplies })
        });

    } catch (error) {
        console.error("Unhandled error in delete handler:", error);
        return res.status(500).json({ 
            message: 'An unexpected error occurred while processing your request',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};
