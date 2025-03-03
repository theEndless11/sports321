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

    // Handle GET requests to fetch posts and search suggestions
    if (req.method === 'GET') {
        const { username_like, start_timestamp, end_timestamp } = req.query; // Extract the query parameters (if any)

        let sqlQuery = 'SELECT DISTINCT username, profile_picture FROM posts';
        let queryParams = [];

        // If searching for usernames containing the provided value
        if (username_like) {
            sqlQuery += ' WHERE username LIKE ?';
            queryParams.push(`%${username_like}%`);
        }

        // Add timestamp filtering if provided
        if (start_timestamp && end_timestamp) {
            sqlQuery += queryParams.length > 0 ? ' AND' : ' WHERE';
            sqlQuery += ' timestamp BETWEEN ? AND ?';
            queryParams.push(start_timestamp, end_timestamp);
        }

        sqlQuery += ' ORDER BY username'; // Sorting suggestions by username

        try {
            const [results] = await promisePool.execute(sqlQuery, queryParams);

            // Format the response to include profile pictures for username suggestions
            const formattedSuggestions = results.map(user => {
                return {
                    username: user.username,
                    profilePicture: user.profile_picture || 'https://latestnewsandaffairs.site/public/pfp.jpg'
                };
            });

            res.status(200).json(formattedSuggestions);
        } catch (error) {
            console.error("❌ Error retrieving posts:", error);
            res.status(500).json({ message: 'Error retrieving posts', error });
        }
    }

    // Handle POST requests to update profile picture
    else if (req.method === 'POST') {
        const { username, profilePicture } = req.body;

        if (!username || !profilePicture) {
            return res.status(400).json({ message: 'Username and profile picture are required' });
        }

        try {
            // Update the user's profile picture in the posts table
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

