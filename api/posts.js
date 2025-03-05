// Use require instead of import
const { promisePool } = require('../utils/db'); // MySQL connection pool

// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');  // Allow all origins or specify your domain
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');  // Allowed methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');  // Allowed headers
};

// Serverless API handler for posts and profile pictures
module.exports = async function handler(req, res) {
    setCorsHeaders(res);

    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end(); // End the request immediately after sending a response for OPTIONS
    }

// Handle GET requests to fetch posts
if (req.method === 'GET') {
    const { username_like, start_timestamp, end_timestamp } = req.query; // Extract the query parameters (if any)

    let sqlQuery = 'SELECT * FROM posts';
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

    sqlQuery += ' ORDER BY timestamp DESC'; // Sorting posts by timestamp

    try {
        const [results] = await promisePool.execute(sqlQuery, queryParams);

        const formattedPosts = results.map(post => {
            let photoUrl = null;

            if (post.photo) {
                // Ensure the photo is being parsed correctly
                if (post.photo.startsWith('http') || post.photo.startsWith('data:image/')) {
                    photoUrl = post.photo;
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
                likedBy: post.likedBy ? JSON.parse(post.likedBy || '[]') : [],
                dislikedBy: post.dislikedBy ? JSON.parse(post.dislikedBy || '[]') : [],
                comments: post.comments ? JSON.parse(post.comments || '[]') : [],
                photo: photoUrl,
                profilePicture: post.profile_picture || 'https://latestnewsandaffairs.site/public/pfp.jpg' // Default profile picture
            };
        });

        return res.status(200).json(formattedPosts); // Return response after processing
    } catch (error) {
        console.error("❌ Error retrieving posts:", error);
        return res.status(500).json({ message: 'Error retrieving posts', error });
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

