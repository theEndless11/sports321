// Use require instead of import
const { promisePool } = require('../utils/db'); // MySQL connection pool

// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');  // Allow all origins or specify your domain
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');  // Allowed methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');  // Allowed headers
};

// Search API handler to fetch user details and their posts
module.exports = async function handler(req, res) {
    setCorsHeaders(res);

    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end(); // End the request immediately after sending a response for OPTIONS
    }

    // Handle GET requests to search posts and fetch user details
    if (req.method === 'GET') {
        const { username } = req.query;

        if (!username) {
            return res.status(400).json({ message: 'Username is required' });
        }

        try {
            // Fetch user details from users table
            const userQuery = 'SELECT location, status, profession, hobby, description, profile_picture FROM users WHERE username = ?';
            const [userResult] = await promisePool.execute(userQuery, [username]);

            if (userResult.length === 0) {
                return res.status(404).json({ message: 'User not found' });
            }

            const user = userResult[0];

            // Fetch posts for the given username
            const postsQuery = 'SELECT * FROM posts WHERE username = ?';
            const [postsResult] = await promisePool.execute(postsQuery, [username]);

            // Format the posts to include image URL logic
            const formattedPosts = postsResult.map(post => {
                let photoUrl = null;
                if (post.photo) {
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

            // Prepare response with user details and posts
            const response = {
                user: {
                    username: user.username,
                    location: user.location || 'Location not available',
                    status: user.status || 'Status not available',
                    profession: user.profession || 'Profession not available',
                    hobby: user.hobby || 'Hobby not available',
                    description: user.description || 'No description available',
                    profile_picture: user.profile_picture || 'https://latestnewsandaffairs.site/public/pfp.jpg', // Default profile picture
                },
                posts: formattedPosts,
            };

            return res.status(200).json(response);

        } catch (error) {
            console.error("❌ Error searching user and posts:", error);
            return res.status(500).json({ message: 'Error retrieving user and posts', error });
        }
    } else {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }
};
