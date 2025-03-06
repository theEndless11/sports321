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
// Handle GET requests to fetch posts and user descriptions
if (req.method === 'GET') {
    const { username_like, start_timestamp, end_timestamp, username, page, limit } = req.query;

    let sqlQuery = 'SELECT * FROM posts';
    let queryParams = [];

    // Pagination logic
    const pageNumber = parseInt(page, 10) || 1;  // Default to page 1
    const pageSize = parseInt(limit, 10) || 5;   // Default to 5 posts per page
    const offset = (pageNumber - 1) * pageSize;

    // Fetch posts with timestamp filtering and username search
    if (username_like) {
        sqlQuery += ' WHERE username LIKE ?';
        queryParams.push(`%${username_like}%`);
    }

    if (start_timestamp && end_timestamp) {
        sqlQuery += queryParams.length > 0 ? ' AND' : ' WHERE';
        sqlQuery += ' timestamp BETWEEN ? AND ?';
        queryParams.push(start_timestamp, end_timestamp);
    }

    sqlQuery += ' ORDER BY timestamp DESC';
    sqlQuery += ' LIMIT ? OFFSET ?'; // Pagination
    queryParams.push(pageSize, offset);

    try {
        const [results] = await promisePool.execute(sqlQuery, queryParams);

        // Fetch total post count for pagination
        const totalPostsQuery = 'SELECT COUNT(*) AS count FROM posts';
        const [totalPostsResult] = await promisePool.execute(totalPostsQuery);
        const totalPosts = totalPostsResult[0].count;
        const hasMorePosts = (pageNumber * pageSize) < totalPosts;

        let response = { posts: [], hasMorePosts };

        // Fetch comments for each post from the comments table
        for (let post of results) {
            // Fetch the comments for the current post
            const commentsQuery = 'SELECT * FROM comments WHERE post_id = ? ORDER BY timestamp ASC';
            const [commentsResults] = await promisePool.execute(commentsQuery, [post._id]);

           // Format comments to match the structure
const formattedComments = commentsResults.map(comment => ({
    _id: comment._id,               // Assuming _id is the comment's ID
    postId: comment.post_id,        // The post ID that the comment belongs to
    username: comment.username,     // The username of the commenter
    comment: comment.comment,       // The comment content
    timestamp: comment.timestamp    // Timestamp for the comment
}));


            // Process the post data (including photo handling)
            let photoUrl = null;
            if (post.photo) {
                if (post.photo.startsWith('http') || post.photo.startsWith('data:image/')) {
                    photoUrl = post.photo;
                } else {
                    photoUrl = `data:image/jpeg;base64,${post.photo.toString('base64')}`;
                }
            }

            // Prepare the formatted post with its comments
            response.posts.push({
                _id: post._id,
                message: post.message,
                timestamp: post.timestamp,
                username: post.username,
                sessionId: post.sessionId,
                likes: post.likes,
                dislikes: post.dislikes,
                likedBy: post.likedBy ? JSON.parse(post.likedBy || '[]') : [],
                dislikedBy: post.dislikedBy ? JSON.parse(post.dislikedBy || '[]') : [],
                photo: photoUrl,
                   comments: post.comments ? JSON.parse(post.comments || '[]') : [],
                profilePicture: post.profile_picture || 'https://latestnewsandaffairs.site/public/pfp.jpg' // Default profile picture
            });
        }

        // Fetch user description if username is provided
        if (username) {
            const descriptionQuery = 'SELECT description FROM posts WHERE username = ?';
            const [userDescriptionResult] = await promisePool.execute(descriptionQuery, [username]);
            response.description = userDescriptionResult.length > 0 ? userDescriptionResult[0].description : '';
        }

        return res.status(200).json(response);

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

        try {
            if (description) {
                // Ensure the description is not empty
                if (description.trim() === '') {
                    return res.status(400).json({ message: 'Description cannot be empty' });
                }

                // Update the description in the database
                await promisePool.execute('UPDATE posts SET description = ? WHERE username = ?', [description, username]);
                return res.status(200).json({ message: 'Description updated successfully' });
            }

            if (profilePicture) {
                // Update the user's profile picture in the posts table
                const [result] = await promisePool.execute(
                    'UPDATE posts SET profile_picture = ? WHERE username = ?',
                    [profilePicture, username]
                );

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

