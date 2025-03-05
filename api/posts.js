// Use require instead of import
const { promisePool } = require('../utils/db'); // MySQL connection pool

// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');  // Allow all origins or specify your domain
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');  // Allowed methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');  // Allowed headers
};

// Serverless API handler for posts, profile pictures, and user descriptions
module.exports = async function handler(req, res) {
    setCorsHeaders(res);

    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end(); // End the request immediately after sending a response for OPTIONS
    }

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
                    profilePicture: post.profile_picture || 'https://latestnewsandaffairs.site/public/pfp.jpg', // Default profile picture
                    description: post.description || 'No description available.'
                };
            });

            return res.status(200).json({ posts: formattedPosts });

        } catch (error) {
            console.error("❌ Error retrieving posts:", error);
            return res.status(500).json({ message: 'Error retrieving posts', error });
        }
    }

    // Handle POST requests for updating descriptions and profile pictures
    if (req.method === 'POST') {
        const { username, description, profilePicture } = req.body;

        if (!username) {
            return res.status(400).json({ message: 'Username is required' });
        }

        if (description === undefined && profilePicture === undefined) {
            return res.status(400).json({ message: 'No valid data provided to update' });
        }

        try {
            // Check if the user exists
            const [userCheck] = await promisePool.execute('SELECT 1 FROM posts WHERE username = ?', [username]);

            if (userCheck.length === 0) {
                return res.status(404).json({ message: 'User not found' });
            }

            let updateMessages = [];

            // Update description if provided
            if (description !== undefined) {
                if (description.trim() === '') {
                    return res.status(400).json({ message: 'Description cannot be empty' });
                }

                const [descResult] = await promisePool.execute(
                    'UPDATE posts SET description = ? WHERE username = ? LIMIT 1',
                    [description, username]
                );

                if (descResult.affectedRows > 0) {
                    updateMessages.push('Description updated successfully');
                }
            }

            // Update profile picture if provided
            if (profilePicture !== undefined) {
                const [picResult] = await promisePool.execute(
                    'UPDATE posts SET profile_picture = ? WHERE username = ?',
                    [profilePicture, username]
                );

                if (picResult.affectedRows > 0) {
                    updateMessages.push('Profile picture updated successfully');
                }
            }

            return res.status(200).json({ message: updateMessages.join(' and ') });

        } catch (error) {
            console.error('❌ Error updating profile:', error);
            return res.status(500).json({ message: 'Error updating profile', error });
        }
    }

    // Handle unsupported methods
    return res.status(405).json({ message: 'Method Not Allowed' });
};

