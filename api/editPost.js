const { promisePool } = require('../utils/db');
const { v4: uuidv4 } = require('uuid');

// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

// Handle like/dislike actions
const handleLikeDislike = (post, action, username) => {
    const isLike = action === 'like';
    const likedBy = post.likedBy;
    const dislikedBy = post.dislikedBy;

    if (dislikedBy.includes(username)) {
        post.dislikes -= 1;
        post.dislikedBy = dislikedBy.filter(user => user !== username);
    }
    if (likedBy.includes(username)) {
        post.likes -= 1;
        post.likedBy = likedBy.filter(user => user !== username);
    } else {
        post[isLike ? 'likes' : 'dislikes'] += 1;
        post[isLike ? 'likedBy' : 'dislikedBy'].push(username);
    }
    return true;
};

// Handle comment or reply hearting
const handleHeart = (target, action, username) => {
    const targetArray = target[action === 'heart comment' ? 'heartedBy' : 'replies'];
    if (targetArray.includes(username)) {
        target.hearts -= 1;
        targetArray = targetArray.filter(user => user !== username);
    } else {
        target.hearts += 1;
        targetArray.push(username);
    }
    return true;
};

// Main API handler
module.exports = async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        setCorsHeaders(res);
        return res.status(200).end();
    }

    setCorsHeaders(res);
    const { postId, username, action, comment, reply, commentId, replyId } = req.body;

    if (!postId || !action || !username) {
        return res.status(400).json({ message: 'Post ID, action, and username are required' });
    }

    try {
        const [posts] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);
        if (posts.length === 0) return res.status(404).json({ message: 'Post not found' });

        const post = posts[0];
        post.likedBy = JSON.parse(post.likedBy || '[]');
        post.dislikedBy = JSON.parse(post.dislikedBy || '[]');
        post.comments = JSON.parse(post.comments || '[]');

        let shouldUpdateDB = false;

        if (['like', 'dislike'].includes(action)) {
            shouldUpdateDB = handleLikeDislike(post, action, username);
        } else if (action === 'heart comment') {
            const targetComment = post.comments.find(c => String(c.commentId) === String(commentId));
            if (!targetComment) return res.status(404).json({ message: 'Comment not found to heart' });

            targetComment.heartedBy = targetComment.heartedBy || [];
            targetComment.hearts = targetComment.hearts || 0;
            shouldUpdateDB = handleHeart(targetComment, action, username);
        } else if (action === 'reply') {
            if (!reply || !reply.trim()) return res.status(400).json({ message: 'Reply cannot be empty' });

            const targetComment = post.comments.find(c => String(c.commentId) === String(commentId));
            if (!targetComment) return res.status(404).json({ message: 'Comment not found to reply to' });

            targetComment.replies = targetComment.replies || [];
            const newReply = {
                replyId: uuidv4(),
                username,
                reply,
                timestamp: new Date(),
                hearts: 0,
                heartedBy: []
            };
            targetComment.replies.push(newReply);
            shouldUpdateDB = true;
        } else if (action === 'heart reply') {
            const targetComment = post.comments.find(c => String(c.commentId) === String(commentId));
            if (!targetComment) return res.status(404).json({ message: 'Comment not found to reply to' });

            const targetReply = targetComment.replies.find(r => String(r.replyId) === String(replyId));
            if (!targetReply) return res.status(404).json({ message: 'Reply not found to heart' });

            targetReply.heartedBy = targetReply.heartedBy || [];
            targetReply.hearts = targetReply.hearts || 0;
            shouldUpdateDB = handleHeart(targetReply, action, username);
        } else if (action === 'comment') {
            if (!comment || !comment.trim()) return res.status(400).json({ message: 'Comment cannot be empty' });

            const newComment = {
                commentId: commentId || uuidv4(),
                username,
                comment,
                timestamp: new Date(),
                hearts: 0,
                heartedBy: [],
                replies: []
            };
            post.comments.push(newComment);
            shouldUpdateDB = true;
        } else {
            return res.status(400).json({ message: 'Invalid action type' });
        }

        if (shouldUpdateDB) {
            await promisePool.execute(
                'UPDATE posts SET likes = ?, dislikes = ?, likedBy = ?, dislikedBy = ?, comments = ? WHERE _id = ?',
                [post.likes, post.dislikes, JSON.stringify(post.likedBy), JSON.stringify(post.dislikedBy), JSON.stringify(post.comments), postId]
            );
        }

        res.status(200).json(post);
    } catch (error) {
        console.error('Error updating post:', error);
        res.status(500).json({ message: 'Error updating post', error });
    }
};




