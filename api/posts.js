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

    // Handle GET requests to fetch posts, recommend usernames, or fetch profile picture
    if (req.method === 'GET') {
        const { username, username_like, start_timestamp, end_timestamp } = req.query; // Extract the query parameters (if any)
        
        // Fetch profile picture if the username query is provided
        if (username) {
            let sqlQuery = 'SELECT profile_picture, timestamp FROM posts WHERE username = ?';
            let queryParams = [username];

            // Add timestamp filtering if provided
            if (start_timestamp && end_timestamp) {
                sqlQuery += ' AND timestamp BETWEEN ? AND ?';
                queryParams.push(start_timestamp, end_timestamp);
            }

            try {
                // Retrieve the profile picture and timestamp from the database
                const [rows] = await promisePool.execute(sqlQuery, queryParams);

                if (rows.length === 0) {
                    return res.status(404).json({ message: 'User not found' });
                }

                // If no profile picture exists, return a default one
                const profilePicture = rows[0].profile_picture || 'https://latestnewsandaffairs.site/public/pfp.jpg';
                return res.status(200).json({ profilePicture });

            } catch (error) {
                console.error('Error retrieving profile picture:', error);
                return res.status(500).json({ message: 'Error retrieving profile picture', error });
            }
        }

        // If a username_like is provided, search for matching usernames
        else if (username_like) {
            const sqlQuery = 'SELECT DISTINCT username FROM posts WHERE username LIKE ? ORDER BY username ASC LIMIT 10';
            const queryParams = [`${username_like}%`]; // Wildcard search for usernames starting with username_like

            try {
                const [results] = await promisePool.execute(sqlQuery, queryParams);
                const usernames = results.map(result => result.username);
                res.status(200).json(usernames);
            } catch (error) {
                console.error("❌ Error retrieving usernames:", error);
                res.status(500).json({ message: 'Error retrieving usernames', error });
            }
        }

        // Fetch posts with timestamp filtering
        else {
            let sqlQuery = 'SELECT * FROM posts ORDER BY timestamp DESC';
            let queryParams = [];

            // Add timestamp filtering if provided
            if (start_timestamp && end_timestamp) {
                sqlQuery = 'SELECT * FROM posts WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp DESC';
                queryParams = [start_timestamp, end_timestamp];
            }

            try {
                const [results] = await promisePool.execute(sqlQuery, queryParams);

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
                          profile_picture: profilePicture,
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
            } catch (error) {
                console.error("❌ Error retrieving posts:", error);
                res.status(500).json({ message: 'Error retrieving posts', error });
            }
        }
    }

    // Handle POST requests to update profile picture
    else if (req.method === 'POST') {
        const { username, profilePicture } = req.body;  // Expecting profile picture as a URL or base64 data

        if (!username || !profilePicture) {
            return res.status(400).json({ message: 'Username and profile picture are required' });
        }

        try {
            // Update the user's profile picture in the database
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

    // If the method is not GET or POST
    return res.status(405).json({ message: 'Method not allowed' });
};


