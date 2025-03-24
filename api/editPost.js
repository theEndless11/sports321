const { promisePool } = require('../utils/db'); // MySQL connection pool

// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');  
};

// Serverless API handler for liking, disliking, or commenting on a post
module.exports = async function handler(req, res) {
    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        setCorsHeaders(res);
        return res.status(200).end(); // Respond with 200 OK for OPTIONS pre-flight
    }

    setCorsHeaders(res);

    const { postId, username, action, comment, reply } = req.body;

    if (!postId || !action || !username) {
        return res.status(400).json({ message: 'Post ID, action, and username are required' });
    }

    try {
        const [posts] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);

        if (posts.length === 0) {
            return res.status(404).json({ message: 'Post not found' });
        }

        const post = posts[0];

        // ✅ Ensure `likedBy` is parsed properly and initialized as an array
        post.likedBy = JSON.parse(post.likedBy || '[]');
        post.comments = JSON.parse(post.comments || '[]');

        post.likes = post.likes || 0;
        post.dislikes = post.dislikes || 0;
        post.hearts = post.hearts || 0;

        let shouldUpdateDB = false; // ✅ Prevents unnecessary updates

        // ✅ Handle the "like" action (stored in DB)
        if (action === 'like') {
            if (post.likedBy.includes(username)) {
                post.likes -= 1;
                post.likedBy = post.likedBy.filter(user => user !== username);
            } else {
                post.likes += 1;
                post.likedBy.push(username);
            }
            shouldUpdateDB = true;
        }
        // ✅ Handle the "dislike" action (COUNT ONLY, NOT STORED AS USERS)
        else if (action === 'dislike') {
            post.dislikes += 1; // ✅ Just increments the count
            shouldUpdateDB = true;
        }
        // ✅ Handle the "heart" action (COUNT ONLY, NOT STORED AS USERS)
        else if (action === 'heart') {
            post.hearts += 1; // ✅ Just increments the count
            shouldUpdateDB = true;
        }
        // ✅ Handle the "comment" action
        else if (action === 'comment') {
            if (!comment || !comment.trim()) {
                return res.status(400).json({ message: 'Comment cannot be empty' });
            }
            post.comments.push({ username, comment, timestamp: new Date(), replies: [] });
            shouldUpdateDB = true;
        }
        // ✅ Handle the "reply" action
        else if (action === 'reply') {
            if (!reply || !reply.trim()) {
                return res.status(400).json({ message: 'Reply cannot be empty' });
            }

            const commentIndex = post.comments.findIndex(c => c.username === username);
            if (commentIndex !== -1) {
                post.comments[commentIndex].replies.push({ username, reply, timestamp: new Date() });
                shouldUpdateDB = true;
            } else {
                return res.status(400).json({ message: 'Comment not found' });
            }
        } else {
            return res.status(400).json({ message: 'Invalid action type' });
        }

        if (shouldUpdateDB) {
            // ✅ Update only `likes`, `dislikes`, `hearts`, `likedBy`, and `comments`
            await promisePool.execute(
                `UPDATE posts SET likes = ?, dislikes = ?, hearts = ?, likedBy = ?, comments = ? WHERE _id = ?`,
                [
                    post.likes,
                    post.dislikes,
                    post.hearts,
                    JSON.stringify(post.likedBy), // Store `likedBy` in DB
                    JSON.stringify(post.comments),
                    postId
                ]
            );
        }

        // ✅ Return the updated post as a response
        res.status(200).json(post);

    } catch (error) {
        console.error("Error updating post:", error);
        res.status(500).json({ message: 'Error updating post', error });
    }
};
