const { promisePool } = require('../utils/db'); // MySQL connection pool
const { v4: uuidv4 } = require('uuid'); // For generating unique comment IDs

// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');  // Allow all origins or specify your domain
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');  // Allowed methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');  // Allowed headers
};

// Serverless API handler for posts
module.exports = async function handler(req, res) {
    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        setCorsHeaders(res);
        return res.status(200).end();
    }

    setCorsHeaders(res);

    const { postId, username, action, comment, reply, commentId } = req.body;

    if (!postId || !action || !username) {
        return res.status(400).json({ message: 'Post ID, action, and username are required' });
    }

    try {
        // Fetch the post by postId
        const [posts] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);

        if (posts.length === 0) {
            return res.status(404).json({ message: 'Post not found' });
        }

        const post = posts[0];

        // ✅ Ensure JSON fields are properly parsed
        post.likedBy = JSON.parse(post.likedBy || '[]');
        post.dislikedBy = JSON.parse(post.dislikedBy || '[]');
        post.heartedBy = JSON.parse(post.heartedBy || '[]'); 
        post.comments = JSON.parse(post.comments || '[]');

        let shouldUpdateDB = false; // ✅ Prevent unnecessary database updates

        // ✅ Handle "like" action
        if (action === 'like') {
            if (post.dislikedBy.includes(username)) {
                post.dislikes -= 1;
                post.dislikedBy = post.dislikedBy.filter(user => user !== username);
            }

            if (post.likedBy.includes(username)) {
                post.likes -= 1;
                post.likedBy = post.likedBy.filter(user => user !== username);
            } else {
                post.likes += 1;
                post.likedBy.push(username);
            }
            shouldUpdateDB = true;
        }
        // ✅ Handle "dislike" action
        else if (action === 'dislike') {
            if (post.likedBy.includes(username)) {
                post.likes -= 1;
                post.likedBy = post.likedBy.filter(user => user !== username);
            }

            if (post.dislikedBy.includes(username)) {
                post.dislikes -= 1;
                post.dislikedBy = post.dislikedBy.filter(user => user !== username);
            } else {
                post.dislikes += 1;
                post.dislikedBy.push(username);
            }
            shouldUpdateDB = true;
        }
  // ✅ Handle "heart" action
else if (action === 'heart') {
    const comment = post.comments.find(comment => comment.commentId === commentId);
    if (comment) {
        if (comment.heartedBy.includes(username)) {
            comment.hearts -= 1;
            comment.heartedBy = comment.heartedBy.filter(user => user !== username);
        } else {
            comment.hearts += 1;
            comment.heartedBy.push(username);
        }
        shouldUpdateDB = true;
    }

    if (shouldUpdateDB) {
        // Save the updated post to the database here (not shown)
    }

    // Respond with the updated post
    res.json(post); // Return the entire post, including updated hearts
}

        // ✅ Handle "comment" action
        else if (action === 'comment') {
            if (!comment || !comment.trim()) {
                return res.status(400).json({ message: 'Comment cannot be empty' });
            }

            const newCommentId = commentId || uuidv4(); // ✅ Generate a new ID if not provided
            post.comments.push({
                commentId: newCommentId,
                username,
                comment,
                timestamp: new Date(),
                replies: []
            });
            shouldUpdateDB = true;
        }
        // ✅ Handle "reply" action
        else if (action === 'reply') {
            if (!reply || !reply.trim()) {
                return res.status(400).json({ message: 'Reply cannot be empty' });
            }

            const commentIndex = post.comments.findIndex(c => c.commentId === commentId);
            if (commentIndex !== -1) {
                post.comments[commentIndex].replies.push({
                    username,
                    reply,
                    timestamp: new Date()
                });
                shouldUpdateDB = true;
            } else {
                return res.status(400).json({ message: 'Comment not found to reply to' });
            }
        } else {
            return res.status(400).json({ message: 'Invalid action type' });
        }

        // ✅ Update the database if needed
        if (shouldUpdateDB) {
            await promisePool.execute(
                `UPDATE posts SET likes = ?, dislikes = ?, likedBy = ?, dislikedBy = ?, hearts = ?, heartedBy = ?, comments = ? WHERE _id = ?`,
                [
                    post.likes,
                    post.dislikes,
                    JSON.stringify(post.likedBy),
                    JSON.stringify(post.dislikedBy),
                    post.hearts,
                    JSON.stringify(post.heartedBy),
                    JSON.stringify(post.comments),
                    postId
                ]
            );
        }

        // ✅ Return the updated post
        res.status(200).json(post);

    } catch (error) {
        console.error("Error updating post:", error);
        res.status(500).json({ message: 'Error updating post', error });
    }
};



