const { promisePool } = require('../utils/db');

// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Replace with your frontend URL
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

module.exports = async function handler(req, res) {
    setCorsHeaders(res);

    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end(); // End the request immediately after sending a response for OPTIONS
    }

        if (req.method === 'GET') {
        const { username } = req.query;

        if (!username) {
            return res.status(400).json({ message: 'Username is required' });
        }

        try {
            // Fetch user details (including profile_picture)
                const userQuery = `
      SELECT 
        location, status, profession, hobby, profile_picture, description,
        followers_count AS followersCount,
        following_count AS followingCount,
        friends_count AS friendsCount
      FROM users 
      WHERE username = ?
    `;
            const [userResult] = await promisePool.execute(userQuery, [username]);

            if (userResult.length === 0) {
                return res.status(404).json({ message: 'User not found' });
            }

            const user = userResult[0];

            // Ensure there's a valid profile picture
            const userProfilePicture = user.profile_picture || 'https://latestnewsandaffairs.site/public/pfp.jpg';

            // Fetch posts related to the user
            const postsQuery = 'SELECT _id, message, timestamp, username, sessionId, likes, dislikes, likedBy, dislikedBy, comments, photo FROM posts WHERE username = ?';
            const [postsResult] = await promisePool.execute(postsQuery, [username]);

            // Process posts and format the response
            const formattedPosts = postsResult.map(post => ({
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
                photo: post.photo 
                    ? (post.photo.startsWith('http') || post.photo.startsWith('data:image/') ? post.photo : `data:image/jpeg;base64,${post.photo.toString('base64')}`)
                    : null,
                profilePicture: userProfilePicture,  // Ensure post profile picture matches user profile picture
            }));

            // Response payload
            const response = {
                user: {
                    username: username,
                    location: user.location || 'Location not available',
                    status: user.status || 'Status not available',
                    profession: user.profession || 'Profession not available',
                    hobby: user.hobby || 'Hobby not available',
                    profile_picture: userProfilePicture, // User's profile picture
                    description: user.description || 'No description available',
                   followersCount: user.followersCount || 0,
                   followingCount: user.followingCount || 0,
                   friendsCount: user.friendsCount || 0,
                },
                posts: formattedPosts,
            };

            return res.status(200).json(response);

        } catch (error) {
            console.error("❌ Error searching user and posts:", error);
            return res.status(500).json({ message: 'Error retrieving user and posts', error });
        }
    }

    return res.status(405).json({ message: 'Method Not Allowed' });
};

