const { promisePool } = require('../utils/db'); // MySQL connection pool

// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');  // Allow all origins or specify your domain
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');  // Allowed methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');  // Allowed headers
};

// Serverless API handler for posts, profile pictures, user descriptions, and replies
module.exports = async function handler(req, res) {
    setCorsHeaders(res);

    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end(); // End the request immediately after sending a response for OPTIONS
    }

    // Handle GET requests to fetch posts, user descriptions, and replies
    if (req.method === 'GET') {
        const { username_like, start_timestamp, end_timestamp, username, page, limit, sort, commentId } = req.query;

        // If we are looking for replies to a specific comment
        if (commentId) {
            try {
                // Fetch all posts
                const [results] = await promisePool.execute('SELECT * FROM posts');

                // Find the comment with the given commentId and get its replies
                let replyResponse = [];

                for (let post of results) {
                    const comments = JSON.parse(post.comments || '[]');
                    for (let comment of comments) {
                        if (comment.commentId === commentId) {
                            replyResponse = comment.replies || [];
                            break;
                        }
                    }
                    if (replyResponse.length) break;  // Exit early if the comment is found
                }

                // Return the replies found for the given commentId
                return res.status(200).json({ replies: replyResponse });

            } catch (error) {
                console.error("❌ Error fetching replies:", error);
                return res.status(500).json({ message: 'Error fetching replies', error });
            }
        }

        // Default behavior if no commentId is provided, retrieve posts with comments and replies
        let sqlQuery = 'SELECT * FROM posts';
        let queryParams = [];

        // Pagination logic
        const pageNumber = parseInt(page, 10) || 1;  // Default to page 1
        const pageSize = parseInt(limit, 10) || 5;   // Default to 5 posts per page
        const offset = (pageNumber - 1) * pageSize;

        // Apply username filter
        if (username_like) {
            sqlQuery += ' WHERE username LIKE ?';
            queryParams.push(`%${username_like}%`);
        }

        // Apply timestamp filter
        if (start_timestamp && end_timestamp) {
            sqlQuery += queryParams.length > 0 ? ' AND' : ' WHERE';
            sqlQuery += ' timestamp BETWEEN ? AND ?';
            queryParams.push(start_timestamp, end_timestamp);
        }

        // Sorting logic
        const sortOptions = {
            'most-liked': 'likes DESC',
            'most-comments': 'CHAR_LENGTH(comments) DESC', // Sort based on comment length
            'newest': 'timestamp DESC'
        };
        sqlQuery += ` ORDER BY ${sortOptions[sort] || 'timestamp DESC'}`;

        // Pagination
        sqlQuery += ' LIMIT ? OFFSET ?';
        queryParams.push(pageSize, offset);

        try {
            const [results] = await promisePool.execute(sqlQuery, queryParams);

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
                    likedBy: JSON.parse(post.likedBy || '[]'),
                    dislikedBy: JSON.parse(post.dislikedBy || '[]'),
                    hearts: post.hearts,
                    heartedBy: JSON.parse(post.heartedBy || '[]'),
                    comments: JSON.parse(post.comments || '[]').map(comment => ({
                        commentId: comment.commentId,
                        username: comment.username,
                        comment: comment.comment,
                        timestamp: comment.timestamp,
                        hearts: comment.hearts || 0,
                        heartedBy: Array.isArray(comment.heartedBy) ? comment.heartedBy : [],
                        replies: Array.isArray(comment.replies) ? comment.replies.map(reply => ({
                            replyId: reply.replyId,
                            username: reply.username,
                            reply: reply.reply,
                            timestamp: reply.timestamp
                        })) : [] // Make sure replies are properly parsed
                    })),
                    photo: photoUrl,
                    profilePicture: post.profile_picture || 'https://latestnewsandaffairs.site/public/pfp.jpg'
                };
            });

            // Fetch total post count for pagination
            const totalPostsQuery = 'SELECT COUNT(*) AS count FROM posts';
            const [totalPostsResult] = await promisePool.execute(totalPostsQuery);
            const totalPosts = totalPostsResult[0].count;
            const hasMorePosts = (pageNumber * pageSize) < totalPosts;

            let response = { posts: formattedPosts, hasMorePosts };

            // Fetch user details from users table if username is provided
            if (username) {
                const userQuery = 'SELECT location, status, profession, hobby FROM users WHERE username = ?';
                const [userResult] = await promisePool.execute(userQuery, [username]);

                if (userResult.length > 0) {
                    const userData = userResult[0];
                    response.location = userData.location || 'Location not available';
                    response.status = userData.status || 'Status not available';
                    response.profession = userData.profession || 'Profession not available';
                    response.hobby = userData.hobby || 'Hobby not available';
                } else {
                    response.location = 'Location not available';
                    response.status = 'Status not available';
                    response.profession = 'Profession not available';
                    response.hobby = 'Hobby not available';
                }

                // Fetch description from posts table
                const descriptionQuery = 'SELECT description FROM posts WHERE username = ?';
                const [descriptionResult] = await promisePool.execute(descriptionQuery, [username]);
                response.description = descriptionResult.length > 0 ? descriptionResult[0].description : 'No description available';
            }

            return res.status(200).json(response);

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
        // Update the location, status, profession, and hobby in the users table
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

            // Add the condition to the end
            updateValues.push(username);  // Only add the username at the end

            const updateQuery = `UPDATE users SET ${updateFields.join(', ')} WHERE username = ?`;

            // Execute the update query
            await promisePool.execute(updateQuery, updateValues);
            return res.status(200).json({ message: 'Profile updated successfully' });
        }

        // Handle description and profile picture updates if needed
        if (description || profilePicture) {
            if (description) {
                await promisePool.execute('UPDATE posts SET description = ? WHERE username = ?', [description, username]);
            }
            if (profilePicture) {
                await promisePool.execute('UPDATE posts SET profile_picture = ? WHERE username = ?', [profilePicture, username]);
            }

            return res.status(200).json({ message: 'Profile updated successfully' });
        }

        // If description is provided, update in posts table
        if (description) {
            if (description.trim() === '') {
                return res.status(400).json({ message: 'Description cannot be empty' });
            }
            await promisePool.execute('UPDATE posts SET description = ? WHERE username = ?', [description, username]);
            return res.status(200).json({ message: 'Description updated successfully' });
        }

        // If profile picture is provided, update in posts table
        if (profilePicture) {
            const [result] = await promisePool.execute('UPDATE posts SET profile_picture = ? WHERE username = ?', [profilePicture, username]);
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'User not found' });
            }
            return res.status(200).json({ message: 'Profile picture updated successfully' });
        }

        return res.status(400).json({ message: 'No valid data provided to update' });
    } catch (error) {
        console.error('❌ Error updating profile:', error);
        return res.status(500).json({ message: 'Error updating profile', error });
    }
}
    // Handle unsupported methods
    return res.status(405).json({ message: 'Method Not Allowed' });
};

