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

// Handle GET requests for retrieving posts or user profile information
if (req.method === 'GET') {
    const { username_like, start_timestamp, end_timestamp, username, page = 1, limit = 5, sort } = req.query;
    let sqlQuery = 'SELECT * FROM posts';
    let queryParams = [];
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    // Apply filters to query
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

        let postsResponse = { posts: [], hasMorePosts: false };

        if (usernames.length) {
            // Query to get profile picture of users
            const usersQuery = `SELECT username, profile_picture FROM users WHERE username IN (${usernames.map(() => '?').join(',')})`;
            const [usersResult] = await promisePool.execute(usersQuery, usernames);

            // Log users' profile picture data to verify it's being fetched correctly
            console.log('Users Profile Pictures:', usersResult);

            // Create a map of username to profile picture
            const usersMap = usersResult.reduce((acc, user) => {
                // If the user has a profile picture (either a valid URL or Base64 string), use it
                if (user.profile_picture) {
                    acc[user.username] = user.profile_picture.startsWith('data:image') 
                        ? user.profile_picture  // Use Base64 encoded string directly
                        : user.profile_picture; // Use the URL path
                } else {
                    // Fallback for users who don't have a profile picture
                    acc[user.username] = 'https://latestnewsandaffairs.site/public/pfp.jpg';
                }
                return acc;
            }, {});

            // Process each post, comments, and replies to add profile pictures
            postsResponse.posts = results.map(post => {
                // Enrich comments with profile pictures
                const enrichedComments = (post.comments ? JSON.parse(post.comments) : []).map(comment => {
                    return {
                        ...comment,
                        profilePicture: usersMap[comment.username] || 'https://latestnewsandaffairs.site/public/pfp.jpg',
                        replies: comment.replies.map(reply => ({
                            ...reply,
                            profilePicture: usersMap[reply.username] || 'https://latestnewsandaffairs.site/public/pfp.jpg',
                        }))
                    };
                });

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
                    profilePicture: usersMap[post.username] || 'https://latestnewsandaffairs.site/public/pfp.jpg',  // Assign profile picture from map
                };
            });

            // Total posts count
            const totalPostsQuery = 'SELECT COUNT(*) AS count FROM posts';
            const [[{ count }]] = await promisePool.execute(totalPostsQuery);
            postsResponse.hasMorePosts = (parseInt(page, 10) * parseInt(limit, 10)) < count;
        }
        // Fetch user profile if requested
        if (username) {
            const userQuery = 'SELECT location, status, profession, hobby, description, profile_picture FROM users WHERE username = ?';
            const [userResult] = await promisePool.execute(userQuery, [username]);

            const userProfileResponse = userResult.length ? userResult[0] : {
                username,
                location: 'Location not available',
                status: 'Status not available',
                profession: 'Profession not available',
                hobby: 'Hobby not available',
                description: 'No description available',
                profile_picture: 'No profile picture available'
            };

            return res.status(200).json(userProfileResponse);
        }

        return res.status(200).json(postsResponse);

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

