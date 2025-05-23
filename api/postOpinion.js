const { promisePool } = require('../utils/db');
const { publishToAbly } = require('../utils/ably');

// Set CORS headers
const setCorsHeaders = (req, res) => {
    const allowedOrigins = ['https://latestnewsandaffairs.site'];
    const origin = req.headers.origin;

    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', 'https://latestnewsandaffairs.site');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Cache-Control', 'no-cache');
};

// Handle post actions (creating, liking, disliking)
const handler = async (req, res) => {
    if (req.method === 'OPTIONS') {
        setCorsHeaders(req, res);
        return res.status(200).end();
    }

    setCorsHeaders(req, res);
    
// POST: Create new post
if (req.method === 'POST') {
    const { message, username, sessionId, photo } = req.body;

    if (!username || !sessionId) {
        return res.status(400).json({ message: 'Username and sessionId are required' });
    }

    if (!message && !photo) {
        return res.status(400).json({ message: 'Post content cannot be empty' });
    }

    try {
        let profilePicture = 'https://latestnewsandaffairs.site/public/pfp1.jpg'; // Default picture

        // Fetch profile picture from the users table based on username
        const [userResult] = await promisePool.execute(
            'SELECT profile_picture FROM users WHERE username = ? LIMIT 1',
            [username]
        );

        // If a profile picture is found for the user, use it
        if (userResult.length > 0 && userResult[0].profile_picture) {
            profilePicture = userResult[0].profile_picture;
        }

        let photoUrl = photo || null;

        // Insert new post into the posts table (no need to insert profile_picture anymore)
        const [result] = await promisePool.execute(
            `INSERT INTO posts (message, timestamp, username, sessionId, likes, dislikes, likedBy, dislikedBy, comments, photo)
             VALUES (?, NOW(), ?, ?, 0, 0, ?, ?, ?, ?)`,
            [message || '', username, sessionId, '[]', '[]', '[]', photoUrl]
        );

        const newPost = {
            _id: result.insertId,
            message: message || '',
            timestamp: new Date(),
            username,
            likes: 0,
            dislikes: 0,
            likedBy: [],
            dislikedBy: [],
            comments: [],
            photo: photoUrl,
            profilePicture // Include profile picture in the post response
        };

        // Publish the new post to Ably
        try {
            await publishToAbly('newOpinion', newPost);
        } catch (error) {
            console.error('Error publishing to Ably:', error);
        }

        return res.status(201).json(newPost);  // Ensure response is sent here and stop further execution
    } catch (error) {
        console.error('Error saving post:', error);
        return res.status(500).json({ message: 'Error saving post', error });  // Ensure response is sent here
    }
}


    // PUT/PATCH: Handle likes/dislikes
    if (req.method === 'PUT' || req.method === 'PATCH') {
        const { postId, action, username } = req.body;  // action can be 'like' or 'dislike'

        if (!postId || !action || !username) {
            return res.status(400).json({ message: 'Post ID, action, and username are required' });
        }

        try {
            // Get the post from MySQL
            const [postRows] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);
            const post = postRows[0];

            if (!post) {
                return res.status(404).json({ message: 'Post not found' });
            }

            let updatedLikes = post.likes;
            let updatedDislikes = post.dislikes;
            let updatedLikedBy = JSON.parse(post.likedBy);
            let updatedDislikedBy = JSON.parse(post.dislikedBy);

            // Handle the 'like' action
            if (action === 'like') {
                if (updatedLikedBy.includes(username)) {
                    return res.status(400).json({ message: 'You have already liked this post' });
                }
                if (updatedDislikedBy.includes(username)) {
                    updatedDislikes -= 1;
                    updatedDislikedBy = updatedDislikedBy.filter(user => user !== username);
                }
                updatedLikes += 1;
                updatedLikedBy.push(username);
            }

            // Handle the 'dislike' action
            if (action === 'dislike') {
                if (updatedDislikedBy.includes(username)) {
                    return res.status(400).json({ message: 'You have already disliked this post' });
                }
                if (updatedLikedBy.includes(username)) {
                    updatedLikes -= 1;
                    updatedLikedBy = updatedLikedBy.filter(user => user !== username);
                }
                updatedDislikes += 1;
                updatedDislikedBy.push(username);
            }

            // Update the post in MySQL
            await promisePool.execute(
                'UPDATE posts SET likes = ?, dislikes = ?, likedBy = ?, dislikedBy = ? WHERE _id = ?',
                [updatedLikes, updatedDislikes, JSON.stringify(updatedLikedBy), JSON.stringify(updatedDislikedBy), postId]
            );

            const updatedPost = {
                _id: postId,
                message: post.message,
                timestamp: post.timestamp,
                username: post.username,
                likes: updatedLikes,
                dislikes: updatedDislikes,
                comments: JSON.parse(post.comments)
            };

            try {
                await publishToAbly('updateOpinion', updatedPost);
            } catch (error) {
                console.error('Error publishing to Ably:', error);
            }

            return res.status(200).json(updatedPost);  // Ensure response is sent here and stop further execution
        } catch (error) {
            console.error('Error updating post:', error);
            return res.status(500).json({ message: 'Error updating post', error });  // Ensure response is sent here
        }
    }

    // Handle other methods
    return res.status(405).json({ message: 'Method Not Allowed' });  // Ensure this is the last response in case method is not supported
};

module.exports = handler;
