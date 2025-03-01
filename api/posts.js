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

    // Handle GET requests to fetch posts
    if (req.method === 'GET') {
        const { username, username_like, start_timestamp, end_timestamp } = req.query; // Extract query parameters

        let sqlQuery = 'SELECT * FROM posts ORDER BY timestamp DESC';
        let queryParams = [];

        // Filter posts by username if provided
        if (username) {
            sqlQuery = 'SELECT * FROM posts WHERE username = ? ORDER BY timestamp DESC';
            queryParams = [username];
        }
        // Filter posts by timestamp range if provided
        else if (start_timestamp && end_timestamp) {
            sqlQuery = 'SELECT * FROM posts WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp DESC';
            queryParams = [start_timestamp, end_timestamp];
        }

        try {
            // Fetch posts from the database
            const [results] = await promisePool.execute(sqlQuery, queryParams);

            const formattedPosts = await Promise.all(results.map(async (post) => {
                let photoUrl = null;

                // Format the photo URL (if available)
                if (post.photo) {
                    if (post.photo.startsWith('http')) {
                        photoUrl = post.photo; // If it's already a valid URL, use it
                    } else if (post.photo.startsWith('data:image/')) {
                        photoUrl = post.photo; // If it's a base64 string, use it directly
                    } else {
                        photoUrl = `data:image/jpeg;base64,${post.photo.toString('base64')}`;
                    }
                }

                // Fetch the profile picture associated with the user
                const [profileRows] = await promisePool.execute(
                    'SELECT profile_picture FROM posts WHERE username = ?',
                    [post.username]
                );

                // If no profile picture exists, use a default
                const profilePicture = profileRows.length > 0 ? profileRows[0].profile_picture || 'https://latestnewsandaffairs.site/public/pfp.jpg' : 'https://latestnewsandaffairs.site/public/pfp.jpg';

                // Return formatted post data along with the profile picture
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
                    profile_picture: profilePicture, // Include profile picture in the post data
                    photo: photoUrl // Include the formatted photo URL here
                };
            }));

            // Send the formatted posts with profile pictures included
            res.status(200).json(formattedPosts);
        } catch (error) {
            console.error("❌ Error retrieving posts:", error);
            res.status(500).json({ message: 'Error retrieving posts', error });
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


