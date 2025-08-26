const { promisePool } = require('../utils/db');

const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

async function getActualCounts(username) {
    try {
        const [followersResult] = await promisePool.execute(
            'SELECT COUNT(*) as count FROM follows WHERE following = ? AND relationship_status = "none"',
            [username]
        );

        const [followingResult] = await promisePool.execute(
            'SELECT COUNT(*) as count FROM follows WHERE follower = ? AND relationship_status = "none"',
            [username]
        );

        const [friendsResult] = await promisePool.execute(
            'SELECT COUNT(DISTINCT CASE WHEN follower = ? THEN following WHEN following = ? THEN follower END) as count FROM follows WHERE (follower = ? OR following = ?) AND relationship_status = "accepted"',
            [username, username, username, username]
        );

        return {
            followersCount: followersResult[0].count || 0,
            followingCount: followingResult[0].count || 0,
            friendsCount: Math.floor((friendsResult[0].count || 0) / 2)
        };
    } catch (error) {
        console.error('Error getting actual counts:', error);
        return { followersCount: 0, followingCount: 0, friendsCount: 0 };
    }
}

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
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        const { username } = req.query;
        if (!username) return res.status(400).json({ message: 'Username is required' });

        try {
            const actualCounts = await syncUserCounts(username);

            const userQuery = `
                SELECT id, created_at, Music, profile_picture, description, verified,
                       followers_count AS followersCount, following_count AS followingCount, 
                       friends_count AS friendsCount
                FROM users WHERE username = ?
            `;
            const [userResult] = await promisePool.execute(userQuery, [username]);
            if (!userResult.length) return res.status(404).json({ message: 'User not found' });
            
            const user = userResult[0];
            const finalCounts = actualCounts || {
                followersCount: user.followersCount || 0,
                followingCount: user.followingCount || 0,
                friendsCount: user.friendsCount || 0
            };

            const userProfilePicture = user.profile_picture || 'https://latestnewsandaffairs.site/public/pfp.jpg';

            const postsQuery = 'SELECT _id, message, timestamp, username, sessionId, likes, likedBy, comments_count, views_count, photo FROM posts WHERE username = ?';
            const [postsResult] = await promisePool.execute(postsQuery, [username]);

            const formattedPosts = postsResult.map(post => ({
                _id: post._id,
                message: post.message,
                timestamp: post.timestamp,
                username: post.username,
                sessionId: post.sessionId,
                likes: post.likes,
                views_count: post.views_count || 0,
                likedBy: post.likedBy ? JSON.parse(post.likedBy || '[]') : [],
                commentCount: post.comments_count || 0,
                comments: post.comments ? JSON.parse(post.comments || '[]') : [],
                photo: post.photo ? 
                    (post.photo.startsWith('http') || post.photo.startsWith('data:image/') ? 
                        post.photo : `data:image/jpeg;base64,${post.photo.toString('base64')}`) : null,
                profilePicture: userProfilePicture,
                verified: Boolean(user.verified)
            }));

            const response = {
                user: {
                    username: username,
                    id: user.id,
                    created_at: user.created_at || 'created_at not available',
                    Music: user.Music || 'Music not available',
                    profile_picture: userProfilePicture,
                    description: user.description || 'No description available',
                    verified: Boolean(user.verified),
                    followers_count: finalCounts.followersCount,
                    following_count: finalCounts.followingCount,
                    friends_count: finalCounts.friendsCount,
                },
                posts: formattedPosts,
            };

            return res.status(200).json(response);

        } catch (error) {
            console.error("Error searching user and posts:", error);
            return res.status(500).json({ message: 'Error retrieving user and posts', error });
        }
    }

    return res.status(405).json({ message: 'Method Not Allowed' });
};
