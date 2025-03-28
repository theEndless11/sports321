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
// ✅ Handle "heart" action (Hearting a specific comment inside a post)
else if (action === 'heart') {
    // Find the target comment by `commentId`
    const targetCommentIndex = post.comments.findIndex(c => String(c.commentId) === String(commentId));

    if (targetCommentIndex !== -1) {
        const targetComment = post.comments[targetCommentIndex];

        // Ensure `heartedBy` is always an array
        targetComment.heartedBy = Array.isArray(targetComment.heartedBy) ? targetComment.heartedBy : [];
        targetComment.hearts = targetComment.hearts || 0;

        if (targetComment.heartedBy.includes(username)) {
            // Remove heart only if the same user is toggling their own heart
            targetComment.hearts -= 1;
            targetComment.heartedBy = targetComment.heartedBy.filter(user => user !== username);
        } else {
            // Add heart if a new user is hearting this comment
            targetComment.hearts += 1;
            targetComment.heartedBy.push(username);
        }

        // ✅ Update the comment inside the `post.comments` array
        post.comments[targetCommentIndex] = targetComment;

        shouldUpdateDB = true;
    } else {
        return res.status(404).json({ message: 'Comment not found to heart' });
    }
}

// ✅ Handle "comment" action (Adding a new comment to a post)
else if (action === 'comment') {
    if (!comment || !comment.trim()) {
        return res.status(400).json({ message: 'Comment cannot be empty' });
    }

    // Get the user's profile picture from the database
    try {
        const [userResults] = await promisePool.query(
            'SELECT profile_picture FROM users WHERE username = ?',
            [username]  // Use the username passed in the request
        );

        // Check if the user exists, else fallback to default profile picture
        const userProfilePicture = userResults.length > 0 ? userResults[0].profile_picture : 'default-pfp.jpg';

        // Generate a new `commentId` if not provided
        const newCommentId = commentId || uuidv4();

        // Create a new comment object
        const newComment = {
            commentId: newCommentId,
            username,
            comment,
            profilePicture: userProfilePicture, // Store only the reference (URL or path)
            timestamp: new Date(),
            hearts: 0,
            heartedBy: [], // Store users who hearted this comment
            replies: []
        };

        // Add new comment to the post's `comments` array
        post.comments.push(newComment);

        shouldUpdateDB = true;

    } catch (error) {
        console.error("Error fetching user profile picture:", error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

// ✅ Handle "reply" action (Replying to a specific comment)
else if (action === 'reply') {
    if (!reply || !reply.trim()) {
        return res.status(400).json({ message: 'Reply cannot be empty' });
    }

    // Find the target comment inside the post's `comments` array
    const targetCommentIndex = post.comments.findIndex(c => String(c.commentId) === String(commentId));

    if (targetCommentIndex !== -1) {
        const targetComment = post.comments[targetCommentIndex];

        // Ensure `replies` is always an array
        targetComment.replies = Array.isArray(targetComment.replies) ? targetComment.replies : [];

        // Get the user's profile picture from the database
        try {
            const [userResults] = await promisePool.query(
                'SELECT profile_picture FROM users WHERE username = ?',
                [username]  // Use the username of the user who is replying
            );

            // Check if the user exists, else fallback to default profile picture
            const userProfilePicture = userResults.length > 0 ? userResults[0].profile_picture : 'default-pfp.jpg';

            // Generate a unique `replyId` for tracking replies
            const newReply = {
                replyId: uuidv4(), // Unique ID for each reply
                username,
                reply,
                profilePicture: userProfilePicture, // Store only the reference (URL or path)
                timestamp: new Date(),
                hearts: 0,         // Track the number of hearts for this reply
                heartedBy: []      // Track users who hearted this reply
            };

            // Push new reply inside the correct comment
            targetComment.replies.push(newReply);

            // Update the post's comments array
            post.comments[targetCommentIndex] = targetComment;

            shouldUpdateDB = true;

        } catch (error) {
            console.error("Error fetching user profile picture for reply:", error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    } else {
        return res.status(404).json({ message: 'Comment not found to reply to' });
    }
}

 else {
            return res.status(400).json({ message: 'Invalid action type' });
        }

        // ✅ Update the database if needed
        if (shouldUpdateDB) {
            await promisePool.execute(
                `UPDATE posts SET likes = ?, dislikes = ?, likedBy = ?, dislikedBy = ?, comments = ? WHERE _id = ?`,
                [
                    post.likes,
                    post.dislikes,
                    JSON.stringify(post.likedBy),
                    JSON.stringify(post.dislikedBy),
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




