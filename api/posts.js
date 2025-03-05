// Use require instead of import
const { promisePool } = require('../utils/db'); // MySQL connection pool

// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');  // Allow all origins or specify your domain
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');  // Allowed methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');  // Allowed headers
};

// Serverless API handler for posts and profile pictures
module.exports = async function handler(req, res) {
    setCorsHeaders(res);

    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end(); // End the request immediately after sending a response for OPTIONS
    }

    // Handle GET requests to fetch a single post
    if (req.method === 'GET' && req.url.startsWith('/api/posts/')) {
        const postId = req.url.split('/')[3]; // Extract postId from the URL

        try {
            // Fetch the post with the provided postId
            const [posts] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);

            if (posts.length === 0) {
                return res.status(404).json({ message: 'Post not found' });
            }

            const post = posts[0];

            // Fetch the comments for this post
            const [commentsResult] = await promisePool.execute(
                'SELECT * FROM comments WHERE post_id = ? ORDER BY timestamp DESC',
                [postId]
            );

            // Format the photo URL
            let photoUrl = null;
            if (post.photo) {
                if (post.photo.startsWith('http') || post.photo.startsWith('data:image/')) {
                    photoUrl = post.photo;
                } else {
                    photoUrl = `data:image/jpeg;base64,${post.photo.toString('base64')}`;
                }
            }

            // Return the post with comments
            return res.status(200).json({
                _id: post._id,
                message: post.message,
                timestamp: post.timestamp,
                username: post.username,
                sessionId: post.sessionId,
                likes: post.likes,
                dislikes: post.dislikes,
                likedBy: post.likedBy ? JSON.parse(post.likedBy || '[]') : [],
                dislikedBy: post.dislikedBy ? JSON.parse(post.dislikedBy || '[]') : [],
                comments: commentsResult.map(comment => ({
                    username: comment.username,
                    comment: comment.message,
                    timestamp: comment.timestamp
                })),
                photo: photoUrl,
                profilePicture: post.profile_picture || 'https://latestnewsandaffairs.site/public/pfp.jpg' // Default profile picture
            });

        } catch (error) {
            console.error("❌ Error retrieving post:", error);
            return res.status(500).json({ message: 'Error retrieving post', error });
        }
    }

    // Handle GET requests to fetch multiple posts
    else if (req.method === 'GET') {
        // Parse query parameters manually (for non-Express environments)
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const username_like = urlObj.searchParams.get('username_like');
        const start_timestamp = urlObj.searchParams.get('start_timestamp');
        const end_timestamp = urlObj.searchParams.get('end_timestamp');

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
            // Fetch posts
            const [results] = await promisePool.execute(sqlQuery, queryParams);

            // Create a list of posts with comments attached
            const formattedPosts = await Promise.all(results.map(async (post) => {
                // Fetch the comments for this post from the `comments` table
                const [commentsResult] = await promisePool.execute(
                    'SELECT * FROM comments WHERE post_id = ? ORDER BY timestamp DESC',
                    [post._id]
                );

                // Format the photo URL
                let photoUrl = null;
                if (post.photo) {
                    if (post.photo.startsWith('http') || post.photo.startsWith('data:image/')) {
                        photoUrl = post.photo;
                    } else {
                        photoUrl = `data:image/jpeg;base64,${post.photo.toString('base64')}`;
                    }
                }

                // Return the formatted post with comments
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
                    comments: commentsResult.map(comment => ({
                        username: comment.username,
                        comment: comment.message,
                        timestamp: comment.timestamp
                    })),
                    photo: photoUrl,
                    profilePicture: post.profile_picture || 'https://latestnewsandaffairs.site/public/pfp.jpg' // Default profile picture
                };
            }));

            // Return the posts with comments
            return res.status(200).json(formattedPosts);

        } catch (error) {
            console.error("❌ Error retrieving posts:", error);
            return res.status(500).json({ message: 'Error retrieving posts', error });
        }
    } else {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }
};
