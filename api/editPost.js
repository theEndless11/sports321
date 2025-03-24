const { promisePool } = require('../utils/db'); // MySQL connection pool

// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');  
};

// Serverless API handler for liking, disliking, or commenting on a post
module.exports = async function handler(req, res) {
    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        setCorsHeaders(res);
        return res.status(200).end(); // Respond with 200 OK for OPTIONS pre-flight
    }

    setCorsHeaders(res);

    const { postId, username, action, comment, reply } = req.body;

    if (!postId || !action || !username) {
        return res.status(400).json({ message: 'Post ID, action, and username are required' });
    }

try {
    const [posts] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);

    if (posts.length === 0) {
        return res.status(404).json({ message: 'Post not found' });
    }

    const post = posts[0];

    // Convert JSON fields to arrays or objects
    post.comments = JSON.parse(post.comments || '[]');
    post.likes = post.likes || 0;
    post.dislikes = post.dislikes || 0;
    post.hearts = post.hearts || 0;
    post.heartedBy = JSON.parse(post.heartedBy || '[]');  // Track users who hearted the post

    // Handle the "like" action
    if (action === 'like') {
        if (post.likedBy && post.likedBy.includes(username)) {
            post.likes -= 1;
            post.likedBy = post.likedBy.filter(user => user !== username);
        } else {
            post.likes += 1;
            post.likedBy.push(username);  // Ensure this array is properly managed
        }
    }
    // Handle the "dislike" action
    else if (action === 'dislike') {
        if (post.dislikedBy && post.dislikedBy.includes(username)) {
            post.dislikes -= 1;
            post.dislikedBy = post.dislikedBy.filter(user => user !== username);
        } else {
            post.dislikes += 1;
            post.dislikedBy.push(username); // Ensure this array is properly managed
        }
    }
    // Handle the "heart" action
    else if (action === 'heart') {
        if (post.heartedBy.includes(username)) {
            post.hearts -= 1;
            post.heartedBy = post.heartedBy.filter(user => user !== username);  // Ensure proper removal logic
        } else {
            post.hearts += 1;
            post.heartedBy.push(username);  // Ensure proper addition logic
        }
    }
    // Handle the "comment" action
    else if (action === 'comment') {
        if (!comment || !comment.trim()) {
            return res.status(400).json({ message: 'Comment cannot be empty' });
        }
        post.comments.push({ username, comment, timestamp: new Date(), replies: [] });
    }
    // Handle the "reply" action
    else if (action === 'reply') {
        if (!reply || !reply.trim()) {
            return res.status(400).json({ message: 'Reply cannot be empty' });
        }

        // Find the comment to which we are replying
        const commentIndex = post.comments.findIndex(c => c.username === username);
        if (commentIndex !== -1) {
            post.comments[commentIndex].replies.push({ username, reply, timestamp: new Date() });
        } else {
            return res.status(400).json({ message: 'Comment not found' });
        }
    } else {
        return res.status(400).json({ message: 'Invalid action type' });
    }

    // Update the post in the database
    await promisePool.execute(
        `UPDATE posts SET likes = ?, dislikes = ?, comments = ?, hearts = ?, heartedBy = ? WHERE _id = ?`,
        [
            post.likes,
            post.dislikes,
            JSON.stringify(post.comments), // Store the comments as a JSON string
            post.hearts,  // We store the heart count as an integer
            JSON.stringify(post.heartedBy), // Store the heartedBy as a JSON string
            postId
        ]
    );

    res.status(200).json(post);  // Respond with the updated post

} catch (error) {
    console.error("Error updating post:", error);
    res.status(500).json({ message: 'Error updating post', error });
}
};
