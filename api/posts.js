const { promisePool } = require('../utils/db'); // Use MySQL connection pool

// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins or set a specific domain
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS'); // Allowed methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Allowed headers
    res.setHeader('Access-Control-Allow-Credentials', 'true'); // Enable credentials if needed
};

// Serverless API handler for posts
module.exports = async function handler(req, res) {
    setCorsHeaders(res);

    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Handle GET requests to fetch posts or recommend usernames
    if (req.method === 'GET') {
        const { username, username_like } = req.query; // Extract the query parameters (if any)

        let sqlQuery = 'SELECT * FROM posts ORDER BY timestamp DESC';
        let queryParams = [];

        // If a username is provided, filter posts by that username
        if (username) {
            sqlQuery = 'SELECT * FROM posts WHERE username = ? ORDER BY timestamp DESC';
            queryParams = [username];
        }

        // If a username_like is provided, search for matching usernames
        else if (username_like) {
            // SQL query to fetch usernames starting with the given input
            sqlQuery = 'SELECT DISTINCT username FROM posts WHERE username LIKE ? ORDER BY username ASC LIMIT 10';
            queryParams = [`${username_like}%`]; // Wildcard search for usernames starting with username_like
        }

        try {
            // Fetch posts or recommended usernames based on the query
            const [results] = await promisePool.execute(sqlQuery, queryParams);

            if (username_like) {
                // If we're searching for usernames, return only the list of matching usernames
                const usernames = results.map(result => result.username);
                res.status(200).json(usernames);
            } else {
                // If we're fetching posts, map over the posts and parse necessary fields
                const formattedPosts = results.map(post => {
                    let photoUrl = null;

                    if (post.photo) {
                        // Ensure the photo is being parsed correctly
                        if (post.photo.startsWith('http')) {
                            photoUrl = post.photo; // If it's already a valid URL, use it
                        } else if (post.photo.startsWith('data:image/')) {
                            photoUrl = post.photo; // If it's already a base64 string, use it directly
                        } else {
                            photoUrl = `data:image/jpeg;base64,${post.photo.toString('base64')}`;
                        }
                    }

                    return {
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
                        photo: photoUrl // Add the formatted photo URL here
                    };
                });

                res.status(200).json(formattedPosts);
            }
        } catch (error) {
            console.error("❌ Error retrieving posts or usernames:", error);
            res.status(500).json({ message: 'Error retrieving posts or usernames', error });
        }
    } else {
        res.status(405).json({ message: 'Method Not Allowed' });
    }
};


