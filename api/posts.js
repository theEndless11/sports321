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
    const { username_like, start_timestamp, end_timestamp, username, page, limit, sort } = req.query;

    let sqlQuery = 'SELECT * FROM posts';
    let queryParams = [];

    const pageNumber = parseInt(page, 10) || 1;
    const pageSize = parseInt(limit, 10) || 5;
    const offset = (pageNumber - 1) * pageSize;

    // Apply filters to query
    if (username_like) {
        sqlQuery += ' WHERE username LIKE ?';
        queryParams.push(`%${username_like}%`);
    }

    if (start_timestamp && end_timestamp) {
        sqlQuery += queryParams.length > 0 ? ' AND' : ' WHERE';
        sqlQuery += ' timestamp BETWEEN ? AND ?';
        queryParams.push(start_timestamp, end_timestamp);
    }

    // Sorting options
    const sortOptions = {
        'most-liked': 'likes DESC',
        'most-comments': 'CHAR_LENGTH(comments) DESC',
        'newest': 'timestamp DESC'
    };
    sqlQuery += ` ORDER BY ${sortOptions[sort] || 'timestamp DESC'}`;

    sqlQuery += ' LIMIT ? OFFSET ?';
    queryParams.push(pageSize, offset);

    try {
        const [results] = await promisePool.execute(sqlQuery, queryParams);

        // Fetch user profile picture for each post's username
        const usernames = results.map(post => post.username);

        if (usernames.length > 0) {
            // Dynamically create placeholders for IN clause
            const placeholders = usernames.map(() => '?').join(',');
            const usersQuery = `SELECT username, profile_picture FROM users WHERE username IN (${placeholders})`;
            const [usersResult] = await promisePool.execute(usersQuery, usernames);

            const usersProfilePictures = usersResult.reduce((acc, user) => {
                acc[user.username] = user.profile_picture || 'https://latestnewsandaffairs.site/public/pfp3.jpg'; // Default if not available
                return acc;
            }, {});

            const formattedPosts = results.map(post => {
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
                    hearts: post.hearts,
                    comments: post.comments ? JSON.parse(post.comments || '[]') : [],
                    photo: photoUrl,
                    profilePicture: usersProfilePictures[post.username] || 'https://latestnewsandaffairs.site/public/pfp.jpg' // Use profile picture from users table
                };
            });

            // Fetch total posts for pagination
            const totalPostsQuery = 'SELECT COUNT(*) AS count FROM posts';
            const [totalPostsResult] = await promisePool.execute(totalPostsQuery);
            const totalPosts = totalPostsResult[0].count;
            const hasMorePosts = (pageNumber * pageSize) < totalPosts;

            let postsResponse = { posts: formattedPosts, hasMorePosts };

            // Handle GET requests for retrieving user profile information
            if (username) {
                const userQuery = 'SELECT location, status, profession, hobby, description, profile_picture, username FROM users WHERE username = ?';
                
                try {
                    const [userResult] = await promisePool.execute(userQuery, [username]);

                    let userProfileResponse = {};

                    if (userResult.length > 0) {
                        const userData = userResult[0];
                        userProfileResponse.username = userData.username;
                        userProfileResponse.location = userData.location || 'Location not available';
                        userProfileResponse.status = userData.status || 'Status not available';
                        userProfileResponse.profession = userData.profession || 'Profession not available';
                        userProfileResponse.hobby = userData.hobby || 'Hobby not available';
                        userProfileResponse.description = userData.description || 'No description available';
                        userProfileResponse.profile_picture = userData.profile_picture || 'No profile picture available';
                    } else {
                        userProfileResponse.username = username;
                        userProfileResponse.location = 'Location not available';
                        userProfileResponse.status = 'Status not available';
                        userProfileResponse.profession = 'Profession not available';
                        userProfileResponse.hobby = 'Hobby not available';
                        userProfileResponse.description = 'No description available';
                        userProfileResponse.profile_picture = 'No profile picture available';
                    }

                    return res.status(200).json(userProfileResponse); // End GET request for user profile
                } catch (error) {
                    console.error("❌ Error retrieving user profile:", error);
                    return res.status(500).json({ message: 'Error retrieving user profile', error });
                }
            }

            return res.status(200).json(postsResponse); // Return the formatted posts with pagination info
        } else {
            // No usernames found, return posts without profile pictures
            const formattedPosts = results.map(post => {
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
                    hearts: post.hearts,
                    comments: post.comments ? JSON.parse(post.comments || '[]') : [],
                    photo: photoUrl,
                    profilePicture: 'https://latestnewsandaffairs.site/public/pfp3.jpg' // Default profile picture
                };
            });

            return res.status(200).json({ posts: formattedPosts, hasMorePosts: false });
        }
    } catch (error) {
        console.error("❌ Error retrieving posts:", error);
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

