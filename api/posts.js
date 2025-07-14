const { promisePool } = require('../utils/db'); // MySQL connection pool

// Set CORS headers
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');  
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');  
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');  
};

module.exports = async function handler(req, res) {
  setCorsHeaders(res); 

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
if (req.method === 'GET') {
    const { username_like, start_timestamp, end_timestamp, username, page = 1, limit = 5, sort } = req.query;
    let sqlQuery = 'SELECT * FROM posts';
    let queryParams = [];
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    if (username_like) {
        sqlQuery += ' WHERE username LIKE ?';
        queryParams.push(`%${username_like}%`);
    }

    if (start_timestamp && end_timestamp) {
        sqlQuery += queryParams.length ? ' AND' : ' WHERE';
        sqlQuery += ' timestamp BETWEEN ? AND ?';
        queryParams.push(start_timestamp, end_timestamp);
    }

    const sortOptions = {
         'most-liked': 'likes DESC',
         'most-comments': 'CHAR_LENGTH(comments) DESC',
        'newest': 'timestamp DESC'
    };
    sqlQuery += ` ORDER BY ${sortOptions[sort] || 'timestamp DESC'} LIMIT ? OFFSET ?`;
    queryParams.push(parseInt(limit, 10), offset);

try {
    const [results] = await promisePool.execute(sqlQuery, queryParams);
    const usernames = [...new Set(results.map(post => post.username))];

    // Extract usernames from replyTo fields
    const replyToUsernames = results
        .map(post => {
            try {
                const replyTo = post.replyTo ? JSON.parse(post.replyTo) : null;
                return replyTo?.username;
            } catch {
                return null;
            }
        })
        .filter(Boolean);

    // Combine all unique usernames
    const allUsernames = [...new Set([...usernames, ...replyToUsernames])];

    let postsResponse = { posts: [], hasMorePosts: false };

    if (allUsernames.length) {
        // Fetch profile pictures for all relevant users
        const usersQuery = `SELECT username, profile_picture FROM users WHERE username IN (${allUsernames.map(() => '?').join(',')})`;
        const [usersResult] = await promisePool.execute(usersQuery, allUsernames);

        // Map usernames to profile pictures
        const usersMap = usersResult.reduce((acc, user) => {
            acc[user.username.toLowerCase()] = user.profile_picture
                ? (user.profile_picture.startsWith('data:image') ? user.profile_picture : `data:image/jpeg;base64,${user.profile_picture}`)
                : 'https://latestnewsandaffairs.site/public/pfp.jpg';
            return acc;
        }, {});

        // Process posts and enrich comments
        postsResponse.posts = results.map(post => {
            // Enrich comments with profile pictures
            const enrichedComments = (post.comments ? JSON.parse(post.comments) : []).map(comment => ({
                ...comment,
                profilePicture: usersMap[comment.username?.toLowerCase()] || 'https://latestnewsandaffairs.site/public/pfp.jpg',
                replies: (comment.replies || []).map(reply => ({
                    ...reply,
                    profilePicture: usersMap[reply.username?.toLowerCase()] || 'https://latestnewsandaffairs.site/public/pfp.jpg',
                }))
            }));

            // Enrich replyTo with profile picture
            let replyToData = post.replyTo ? JSON.parse(post.replyTo) : null;
            if (replyToData) {
                replyToData.profilePicture = usersMap[replyToData.username?.toLowerCase()] || 'https://latestnewsandaffairs.site/public/pfp.jpg';
            }

            // Return enriched post object
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
                hearts: post.hearts,
                comments: enrichedComments,
                photo: post.photo && (post.photo.startsWith('http') || post.photo.startsWith('data:image/'))
                    ? post.photo
                    : post.photo ? `data:image/jpeg;base64,${post.photo.toString('base64')}` : null,
                profilePicture: usersMap[post.username.toLowerCase()] || 'https://latestnewsandaffairs.site/public/pfp.jpg',
                tags: post.tags ? JSON.parse(post.tags) : [],
                replyTo: replyToData
            };
        });
 
            // Count total posts with the same filters
            const totalPostsQuery = `SELECT COUNT(*) AS count FROM posts${username_like || start_timestamp ? ' WHERE' : ''} ${username_like ? 'username LIKE ?' : ''} ${username_like && start_timestamp ? ' AND ' : ''} ${start_timestamp ? 'timestamp BETWEEN ? AND ?' : ''}`;
            const [totalResult] = await promisePool.execute(totalPostsQuery, queryParams.slice(0, queryParams.length - 2));
            postsResponse.hasMorePosts = (parseInt(page, 10) * parseInt(limit, 10)) < totalResult[0].count;
        }

// Fetch user profile if requested
if (username) {
    try {
        const userQuery = 'SELECT location, status, profession, hobby, description, profile_picture FROM users WHERE username = ?';
        const [userResult] = await promisePool.execute(userQuery, [username]);

        if (userResult.length) {
            // If profile_picture exists, it should already be in Base64 format (in your case it is)
            return res.status(200).json(userResult[0]);
        } else {
            return res.status(200).json({
                username,
                location: 'Location not available',
                status: 'Status not available',
                profession: 'Profession not available',
                hobby: 'Hobby not available',
                description: 'No description available',
                profile_picture: 'https://latestnewsandaffairs.site/public/pfp.jpg', // Default profile picture if none found
            });
        }
    } catch (userError) {
        console.error('❌ Error retrieving user profile:', userError);
        return res.status(500).json({ message: 'Error retrieving user profile', error: userError });
    }
}

return res.status(200).json(postsResponse); // Fetch posts data

        } catch (error) {
            console.error('❌ Error retrieving posts:', error);
            return res.status(500).json({ message: 'Error retrieving posts', error });
        }
    }

    // Handle POST requests for updating location, status, profession, hobby, description, and profile picture
    if (req.method === 'POST') {
        const { username, location, status, profession, hobby, description, profilePicture } = req.body;

        if (!username) {
            return res.status(400).json({ message: 'Username is required' });
        }

        try {
            // Update the location, status, profession, hobby in the users table
            if (location || status || profession || hobby) {
                const updateFields = [];
                const updateValues = [];

                if (location) {
                    updateFields.push('location = ?');
                    updateValues.push(location);
                }
                if (status) {
                    updateFields.push('status = ?');
                    updateValues.push(status);
                }
                if (profession) {
                    updateFields.push('profession = ?');
                    updateValues.push(profession);
                }
                if (hobby) {
                    updateFields.push('hobby = ?');
                    updateValues.push(hobby);
                }

                // Add the condition to the end (username)
                updateValues.push(username);

                const updateQuery = `UPDATE users SET ${updateFields.join(', ')} WHERE username = ?`;

                // Execute the update query for location, status, profession, hobby
                await promisePool.execute(updateQuery, updateValues);
            }

            // Handle updating description and profile picture in the users table
            if (description || profilePicture) {
                const updateFields = [];
                const updateValues = [];

                if (description) {
                    updateFields.push('description = ?');
                    updateValues.push(description);
                }
                if (profilePicture) {
                    updateFields.push('profile_picture = ?');
                    updateValues.push(profilePicture);
                }

                // Add the condition to the end (username)
                updateValues.push(username);

                const updateQuery = `UPDATE users SET ${updateFields.join(', ')} WHERE username = ?`;

                // Execute the update query for description and profile picture
                await promisePool.execute(updateQuery, updateValues);
            }

            return res.status(200).json({ message: 'Profile updated successfully' });

        } catch (error) {
            console.error('❌ Error updating profile:', error);
            return res.status(500).json({ message: 'Error updating profile', error });
        }
    }

    // Handle unsupported methods
    return res.status(405).json({ message: 'Method Not Allowed' });
};

