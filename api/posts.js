const { promisePool } = require('../utils/db'); // Use MySQL connection pool

// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins or set a specific domain
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); // Allowed methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Allowed headers
    res.setHeader('Access-Control-Allow-Credentials', 'true'); // Enable credentials if needed
};

// Serverless API handler for posts and profile pictures
module.exports = async function handler(req, res) {
    setCorsHeaders(res);

    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Handle GET requests to fetch posts & users
    if (req.method === 'GET') {
        const { username_like, start_timestamp, end_timestamp } = req.query;

        try {
            let users = [];
            let posts = [];

            // 🔍 Fetch matching users (if searching by username)
            if (username_like) {
                const [userResults] = await promisePool.execute(
                    'SELECT username, profile_picture FROM posts WHERE username LIKE ? GROUP BY username ORDER BY username ASC',
                    [`%${username_like}%`]
                );

                users = userResults.map(user => ({
                    username: user.username,
                    profilePicture: user.profile_picture || 'https://latestnewsandaffairs.site/public/pfp.jpg' // Default profile picture
                }));
            }

            // 🔍 Fetch matching posts
            let postQuery = 'SELECT * FROM posts';
            let queryParams = [];

            if (username_like) {
                postQuery += ' WHERE username LIKE ?';
                queryParams.push(`%${username_like}%`);
            }

            if (start_timestamp && end_timestamp) {
                postQuery += queryParams.length > 0 ? ' AND' : ' WHERE';
                postQuery += ' timestamp BETWEEN ? AND ?';
                queryParams.push(start_timestamp, end_timestamp);
            }

            postQuery += ' ORDER BY timestamp DESC'; // Sort by latest posts

            const [postResults] = await promisePool.execute(postQuery, queryParams);

            posts = postResults.map(post => ({
                _id: post._id,
                message: post.message,
                timestamp: post.timestamp,
                username: post.username,
                sessionId: post.sessionId,
                likes: post.likes,
                dislikes: post.dislikes,
                likedBy: post.likedBy ? JSON.parse(post.likedBy) : [],
                dislikedBy: post.dislikedBy ? JSON.parse(post.dislikedBy) : [],
                comments: post.comments ? JSON.parse(post.comments) : [],
                photo: post.photo ? (post.photo.startsWith('http') ? post.photo : `data:image/jpeg;base64,${post.photo.toString('base64')}`) : null,
                profilePicture: post.profile_picture || 'https://latestnewsandaffairs.site/public/pfp.jpg' // Default profile picture
            }));

            // 📌 Return both users & posts in a single response
            return res.status(200).json({ users, posts });
        } catch (error) {
            console.error("❌ Error retrieving data:", error);
            return res.status(500).json({ message: 'Error retrieving data', error });
        }
    }

    // Handle POST requests to update profile picture
    else if (req.method === 'POST') {
        const { username, profilePicture } = req.body;

        if (!username || !profilePicture) {
            return res.status(400).json({ message: 'Username and profile picture are required' });
        }

        try {
            const [result] = await promisePool.execute(
                'UPDATE posts SET profile_picture = ? WHERE username = ?',
                [profilePicture, username]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'User not found' });
            }

            return res.status(200).json({ message: 'Profile picture updated successfully' });
        } catch (error) {
            console.error('Error updating profile picture:', error);
            return res.status(500).json({ message: 'Error updating profile picture', error });
        }
    }

    return res.status(405).json({ message: 'Method not allowed' });
};

