// Use require instead of import
const { promisePool } = require('../utils/db'); // MySQL connection pool
const { v4: uuidv4 } = require('uuid'); // For generating unique comment IDs

// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');  // Allow all origins or specify your domain
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');  // Allowed methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');  // Allowed headers
};

// Function to generate a unique comment ID
function generateCommentId() {
    return uuidv4(); // Generates a unique UUID for each comment
}

// Serverless API handler for liking, disliking, commenting, hearting, and replying on a post
module.exports = async function handler(req, res) {
    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        setCorsHeaders(res);
        return res.status(200).end(); // Respond with 200 OK for OPTIONS pre-flight
    }

    // Set CORS headers for all other requests
    setCorsHeaders(res);

    const { postId, username, action, comment, reply, commentId } = req.body;

    if (!postId || !action || !username) {
        return res.status(400).json({ message: 'Post ID, action, and username are required' });
    }

    try {
        // Fetch the post by postId from the MySQL database
        const [posts] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);

        if (posts.length === 0) {
            return res.status(404).json({ message: 'Post not found' });
        }

        const post = posts[0];

        // Convert JSON fields from string to object/array
        post.likedBy = JSON.parse(post.likedBy || '[]');
        post.dislikedBy = JSON.parse(post.dislikedBy || '[]');
        post.heartedBy = JSON.parse(post.heartedBy || '[]'); // Track users who hearted the post
        post.comments = JSON.parse(post.comments || '[]');

        // Handle the "like" action
        if (action === 'like') {
            // Handle liking logic (not changed)
        }

        // Handle the "dislike" action
        else if (action === 'dislike') {
            // Handle dislike logic (not changed)
        }

        // Handle the "heart" action
        else if (action === 'heart') {
            // Ensure we target the right comment using commentId
            const targetComment = post.comments.find(c => c.commentId === commentId);

            if (!targetComment) {
                return res.status(400).json({ message: 'Comment not found' });
            }

            // If the user has already hearted this comment, remove their heart
            if (targetComment.heartedBy.includes(username)) {
                targetComment.hearts -= 1;
                targetComment.heartedBy = targetComment.heartedBy.filter(user => user !== username);
            } else {
                // If the user has not hearted the comment yet, add their heart
                targetComment.hearts += 1;
                targetComment.heartedBy.push(username);
            }
        }

        // Handle the "comment" action
        else if (action === 'comment') {
            if (!comment || !comment.trim()) {
                return res.status(400).json({ message: 'Comment cannot be empty' });
            }

            // Generate a unique commentId for the new comment
            const newComment = {
                commentId: generateCommentId(), // Generate unique ID
                username,
                comment,
                timestamp: new Date(),
                replies: [],
                hearts: 0, // Initialize hearts count
                heartedBy: [] // Track who has hearted the comment
            };

            post.comments.push(newComment);
        }

        // Handle the "reply" action
        else if (action === 'reply') {
            if (!reply || !reply.trim()) {
                return res.status(400).json({ message: 'Reply cannot be empty' });
            }

            // Find the comment to which we are replying
            const commentIndex = post.comments.findIndex(c => c.commentId === commentId);
            if (commentIndex !== -1) {
                post.comments[commentIndex].replies.push({ username, reply, timestamp: new Date() });
            } else {
                return res.status(400).json({ message: 'Comment not found to reply to' });
            }
        } else {
            return res.status(400).json({ message: 'Invalid action type' });
        }

        // Update the post in the MySQL database
        await promisePool.execute(
            `UPDATE posts SET likes = ?, dislikes = ?, likedBy = ?, dislikedBy = ?, hearts = ?, heartedBy = ?, comments = ? WHERE _id = ?`,
            [
                post.likes,
                post.dislikes,
                JSON.stringify(post.likedBy),
                JSON.stringify(post.dislikedBy),
                post.hearts,
                JSON.stringify(post.heartedBy),
                JSON.stringify(post.comments),
                postId
            ]
        );

        // Return the updated post as a response
        res.status(200).json(post);

    } catch (error) {
        console.error("Error updating post:", error);
        res.status(500).json({ message: 'Error updating post', error });
    }
}


