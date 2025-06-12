const { promisePool } = require('../utils/db');

// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

// Helper function to get actual follower/friend counts
async function getActualCounts(username) {
    try {
        // Get followers count (people following this user)
        const [followersResult] = await promisePool.execute(
            'SELECT COUNT(*) as count FROM follows WHERE following = ? AND relationship_status = "none"',
            [username]
        );

        // Get following count (people this user follows)
        const [followingResult] = await promisePool.execute(
            'SELECT COUNT(*) as count FROM follows WHERE follower = ? AND relationship_status = "none"',
            [username]
        );

        // Get friends count (accepted relationships)
        const [friendsResult] = await promisePool.execute(
            'SELECT COUNT(DISTINCT CASE WHEN follower = ? THEN following WHEN following = ? THEN follower END) as count FROM follows WHERE (follower = ? OR following = ?) AND relationship_status = "accepted"',
            [username, username, username, username]
        );

        return {
            followersCount: followersResult[0].count || 0,
            followingCount: followingResult[0].count || 0,
            friendsCount: Math.floor((friendsResult[0].count || 0) / 2) // Divide by 2 since friendships are bidirectional
        };
    } catch (error) {
        console.error('Error getting actual counts:', error);
        return {
            followersCount: 0,
            followingCount: 0,
            friendsCount: 0
        };
    }
}

// Helper function to sync database counts
async function syncUserCounts(username) {
    try {
        const actualCounts = await getActualCounts(username);
        await promisePool.execute(
            'UPDATE users SET followers_count = ?, following_count = ?, friends_count = ? WHERE username = ?',
            [actualCounts.followersCount, actualCounts.followingCount, actualCounts.friendsCount, username]
        );
        return actualCounts;
    } catch (error) {
        console.error('Error syncing user counts:', error);
        return null;
    }
}

module.exports = async function handler(req, res) {
    setCorsHeaders(res);

    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method === 'GET') {
        const { username } = req.query;

        if (!username) {
            return res.status(400).json({ message: 'Username is required' });
        }

        try {
            // First, sync the user counts to ensure accuracy
            const actualCounts = await syncUserCounts(username);

            // Fetch user details with updated counts
            const userQuery = `
                SELECT 
                    id,location, status, profession, hobby, profile_picture, description,
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

            // Use actual counts if sync was successful, otherwise use database values
            const finalCounts = actualCounts || {
                followersCount: user.followersCount || 0,
                followingCount: user.followingCount || 0,
                friendsCount: user.friendsCount || 0
            };

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
                profilePicture: userProfilePicture,
            }));

            // Response payload
            const response = {
                user: {
                    username: username,
                    id: user.id,
                    location: user.location || 'Location not available',
                    status: user.status || 'Status not available',
                    profession: user.profession || 'Profession not available',
                    hobby: user.hobby || 'Hobby not available',
                    profile_picture: userProfilePicture,
                    description: user.description || 'No description available',
                    followers_count: finalCounts.followersCount,
                    following_count: finalCounts.followingCount,
                    friends_count: finalCounts.friendsCount,
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

