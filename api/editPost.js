// Use require instead of import
const { promisePool } = require('../utils/db'); // MySQL connection pool

// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');  // Allow all origins or specify your domain
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');  // Allowed methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');  // Allowed headers
};

// Serverless API handler for liking, disliking, or commenting on a post
module.exports = async function handler(req, res) {
    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        setCorsHeaders(res);
        return res.status(200).end(); // Respond with 200 OK for OPTIONS pre-flight
    }

    // Set CORS headers for all other requests
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
    post.likedBy = JSON.parse(post.likedBy || '[]');
    post.dislikedBy = JSON.parse(post.dislikedBy || '[]');
    post.comments = JSON.parse(post.comments || '[]');
    post.heartedBy = JSON.parse(post.heartedBy || '[]'); // New column for hearts

    // Handle the "like" action
    if (action === 'like') {
        if (post.dislikedBy.includes(username)) {
            post.dislikes -= 1;
            post.dislikedBy = post.dislikedBy.filter(user => user !== username);
        }

        if (post.likedBy.includes(username)) {
            post.likes -= 1;
            post.likedBy = post.likedBy.filter(user => user !== username);
        } else {
            post.likes += 1;
            post.likedBy.push(username);
        }
    } else if (action === 'dislike') {
        if (post.likedBy.includes(username)) {
            post.likes -= 1;
            post.likedBy = post.likedBy.filter(user => user !== username);
        }

        if (post.dislikedBy.includes(username)) {
            post.dislikes -= 1;
            post.dislikedBy = post.dislikedBy.filter(user => user !== username);
        } else {
            post.dislikes += 1;
            post.dislikedBy.push(username);
        }
    } else if (action === 'heart') {
        if (post.heartedBy.includes(username)) {
            post.heartedBy = post.heartedBy.filter(user => user !== username);
        } else {
            post.heartedBy.push(username);
        }
    } else if (action === 'comment') {
        if (!comment || !comment.trim()) {
            return res.status(400).json({ message: 'Comment cannot be empty' });
        }
        post.comments.push({ username, comment, timestamp: new Date() });
    } else if (action === 'reply') {
        if (!reply || !reply.trim()) {
            return res.status(400).json({ message: 'Reply cannot be empty' });
        }
        // Add the reply to the appropriate comment
        const commentIndex = post.comments.findIndex(c => c.username === username); // Just an example; you may need more complex logic
        post.comments[commentIndex].replies = post.comments[commentIndex].replies || [];
        post.comments[commentIndex].replies.push({ username, reply, timestamp: new Date() });
    } else {
        return res.status(400).json({ message: 'Invalid action type' });
    }

    await promisePool.execute(
        `UPDATE posts SET likes = ?, dislikes = ?, likedBy = ?, dislikedBy = ?, comments = ?, heartedBy = ? WHERE _id = ?`,
        [
            post.likes,
            post.dislikes,
            JSON.stringify(post.likedBy),
            JSON.stringify(post.dislikedBy),
            JSON.stringify(post.comments),
            JSON.stringify(post.heartedBy),
            postId
        ]
    );

    res.status(200).json(post);

} catch (error) {
    console.error("Error updating post:", error);
    res.status(500).json({ message: 'Error updating post', error });
}

