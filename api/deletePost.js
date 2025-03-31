import { promisePool } from '../utils/db'; // MySQL connection pool
import fs from 'fs'; // File system module for local file deletion

const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
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
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath); // Delete local file if exists
    }

    await promisePool.execute('DELETE FROM posts WHERE _id = ?', [postId]);
    return { status: 200, message: 'Post deleted successfully' };
};

const handlePostUpdate = async (id, message, timestamp, username) => {
    const [posts] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [id]);
    if (!posts.length) return { status: 404, message: 'Post not found' };

    const post = posts[0];
    if (post.username !== username) return { status: 403, message: 'You can only edit your own posts' };

    await promisePool.execute('UPDATE posts SET message = ?, timestamp = ? WHERE _id = ?', [message, timestamp, id]);
    return { status: 200, message: 'Post updated successfully', post };
};

// Function to handle comment deletion
const handleCommentDeletion = async (postId, commentId, username, sessionId) => {
    const [posts] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);

    if (!posts.length) return { status: 404, message: 'Post not found' };

    const post = posts[0];
    const commentIndex = post.comments.findIndex(c => String(c.commentId) === String(commentId));

    if (commentIndex === -1) return { status: 404, message: 'Comment not found' };

    const comment = post.comments[commentIndex];

    // Check if the logged-in user matches the comment's username or sessionId
    if (comment.username !== username && sessionId !== comment.sessionId) {
        return { status: 403, message: 'Unauthorized to delete this comment' };
    }

    // Remove the comment from the post's comments array
    post.comments.splice(commentIndex, 1);

    // Update the post in the database
    await promisePool.execute('UPDATE posts SET comments = ? WHERE _id = ?', [JSON.stringify(post.comments), postId]);

    return { status: 200, message: 'Comment deleted successfully', comments: post.comments };
};

export default async function handler(req, res) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { postId, commentId, username, sessionId, id, message, timestamp } = req.body;

    if (req.method === 'DELETE') {
        // Handle post deletion if no commentId is provided
        if (postId && !commentId) {
            if (!postId || !username || !sessionId) return res.status(400).json({ message: 'Missing required fields' });
            const result = await handlePostDeletion(postId, username);
            return res.status(result.status).json({ message: result.message });
        }

        // Handle comment deletion if commentId is provided
        if (postId && commentId) {
            if (!postId || !commentId || !username || !sessionId) {
                return res.status(400).json({ message: 'Missing required fields for comment deletion' });
            }
            const result = await handleCommentDeletion(postId, commentId, username, sessionId);
            return res.status(result.status).json({ message: result.message, comments: result.comments });
        }
    }

    if (req.method === 'PUT') {
        if (!id || !message || !username || !timestamp) return res.status(400).json({ message: 'Missing required fields' });
        const result = await handlePostUpdate(id, message, timestamp, username);
        return res.status(result.status).json(result.message ? { message: result.message, post: result.post } : { message: result.message });
    }

    return res.status(405).json({ message: 'Method Not Allowed' });
}

