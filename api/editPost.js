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

    const { postId, username, action, comment } = req.body;

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
        post.comments = JSON.parse(post.comments || '[]');

        // Handle the "like" action
        if (action === 'like') {
            // If the user has already disliked the post, remove dislike and decrement dislike count
            if (post.dislikedBy.includes(username)) {
                post.dislikes -= 1;
                post.dislikedBy = post.dislikedBy.filter(user => user !== username);
            }

            // If the user has already liked the post, remove like and decrement like count
            if (post.likedBy.includes(username)) {
                post.likes -= 1; // Remove like and decrement like count
                post.likedBy = post.likedBy.filter(user => user !== username);
            } else {
                post.likes += 1; // Add like and increment like count
                post.likedBy.push(username);
            }

        // Handle the "dislike" action
        } else if (action === 'dislike') {
            // If the user has already liked the post, remove like and decrement like count
            if (post.likedBy.includes(username)) {
                post.likes -= 1;
                post.likedBy = post.likedBy.filter(user => user !== username);
            }

            // If the user has already disliked the post, remove dislike and decrement dislike count
            if (post.dislikedBy.includes(username)) {
                post.dislikes -= 1; // Remove dislike and decrement dislike count
                post.dislikedBy = post.dislikedBy.filter(user => user !== username);
            } else {
                post.dislikes += 1; // Add dislike and increment dislike count
                post.dislikedBy.push(username);
            }

        // Handle the "comment" action
        } else if (action === 'comment') {
            if (!comment || !comment.trim()) {
                return res.status(400).json({ message: 'Comment cannot be empty' });
            }

            post.comments.push({ username, comment, timestamp: new Date() });

        } else {
            return res.status(400).json({ message: 'Invalid action type' });
        }

        // Update the post in the MySQL database
        await promisePool.execute(
            `UPDATE posts SET likes = ?, dislikes = ?, likedBy = ?, dislikedBy = ?, comments = ? WHERE _id = ?`,
            [
                post.likes,
                post.dislikes,
                JSON.stringify(post.likedBy),
                JSON.stringify(post.dislikedBy),
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