const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { promisePool } = require('../utils/db');
const { publishToAbly } = require('../utils/ably');
const crypto = require('crypto');

// Set CORS headers
const setCorsHeaders = (req, res) => {
    const allowedOrigins = ['https://latestnewsandaffairs.site'];
    const origin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes(origin) ? origin : 'https://latestnewsandaffairs.site');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Cache-Control', 'no-cache');
};

// Multer setup for handling images in memory
const storage = multer.memoryStorage();
const upload = multer({ storage });
const uploadPhoto = upload.single('photo');

// Main API handler (Handles POST, GET (image), PUT/PATCH)
const handler = async (req, res) => {
    if (req.method === 'OPTIONS') {
        setCorsHeaders(req, res);
        return res.status(200).end();
    }

    setCorsHeaders(req, res);

    // 📌 **Handle GET request to retrieve images**
    if (req.method === 'GET') {
        const { postId } = req.query;

        if (!postId) {
            return res.status(400).json({ message: 'Post ID is required' });
        }

        try {
            const [postRows] = await promisePool.execute('SELECT photo FROM posts WHERE _id = ?', [postId]);

            if (!postRows.length) {
                return res.status(404).json({ message: 'Post not found' });
            }

            const imageBuffer = postRows[0].photo;

            if (!imageBuffer) {
                return res.status(404).json({ message: 'No image found for this post' });
            }

            res.setHeader('Content-Type', 'image/webp'); // Adjust MIME type if necessary
            return res.send(imageBuffer);
        } catch (error) {
            console.error('Error retrieving image:', error);
            return res.status(500).json({ message: 'Error retrieving image', error });
        }
    }

   if (req.method === 'POST') {
    try {
        await new Promise((resolve, reject) => {
            uploadPhoto(req, res, (err) => {
                if (err) reject({ message: 'Error uploading photo', error: err });
                else resolve();
            });
        });

        const { message, username, sessionId } = req.body;
        if (!username || !sessionId) return res.status(400).json({ message: 'Username and sessionId are required' });

        if (!message && !req.file && !req.body.photo?.startsWith('data:image')) {
            return res.status(400).json({ message: 'Message or photo is required' });
        }

        let photoBuffer = null;
        let photoUrl = null;

        if (req.file) {
            photoBuffer = req.file.buffer;
            photoUrl = `https://sports321.vercel.app/api/postOpinion?postId=${result.insertId}`;
        } else if (req.body.photo?.startsWith('data:image')) {
            const matches = req.body.photo.match(/^data:image\/([a-zA-Z]*);base64,([^\"]*)/);
            photoBuffer = Buffer.from(matches[2], 'base64');
            photoUrl = `https://sports321.vercel.app/api/postOpinion?postId=${result.insertId}`;
        }

        const [result] = await promisePool.execute(
            'INSERT INTO posts (message, timestamp, username, sessionId, likes, dislikes, likedBy, dislikedBy, comments, photo) VALUES (?, NOW(), ?, ?, 0, 0, ?, ?, ?, ?)',
            [message, username, sessionId, JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), photoBuffer]
        );

        const newPost = {
            _id: result.insertId,
            message,
            timestamp: new Date(),
            username,
            likes: 0,
            dislikes: 0,
            likedBy: [],
            dislikedBy: [],
            comments: [],
            photo: photoUrl
        };

        console.log("📸 New Post Created:", newPost);
        return res.status(201).json(newPost);
    } catch (error) {
        console.error('Error saving post:', error);
        return res.status(500).json({ message: 'Error saving post', error });
    }
}

    // 📌 **Handle PUT/PATCH requests for likes/dislikes**
    if (req.method === 'PUT' || req.method === 'PATCH') {
        const { postId, action, username } = req.body;
        if (!postId || !action || !username) return res.status(400).json({ message: 'Post ID, action, and username are required' });

        try {
            const [postRows] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);
            const post = postRows[0];
            if (!post) return res.status(404).json({ message: 'Post not found' });

            let updatedLikes = post.likes;
            let updatedDislikes = post.dislikes;
            let updatedLikedBy = JSON.parse(post.likedBy);
            let updatedDislikedBy = JSON.parse(post.dislikedBy);

            if (action === 'like') {
                if (updatedLikedBy.includes(username)) return res.status(400).json({ message: 'You have already liked this post' });
                updatedDislikedBy = updatedDislikedBy.filter(user => user !== username);
                updatedLikedBy.push(username);
                updatedLikes++;
                updatedDislikes = updatedDislikedBy.length;
            } else if (action === 'dislike') {
                if (updatedDislikedBy.includes(username)) return res.status(400).json({ message: 'You have already disliked this post' });
                updatedLikedBy = updatedLikedBy.filter(user => user !== username);
                updatedDislikedBy.push(username);
                updatedDislikes++;
                updatedLikes = updatedLikedBy.length;
            }

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

            await publishToAbly('updateOpinion', updatedPost).catch((error) => console.error('Error publishing to Ably:', error));

            return res.status(200).json(updatedPost);
        } catch (error) {
            console.error('Error updating post:', error);
            return res.status(500).json({ message: 'Error updating post', error });
        }
    }

    return res.status(405).json({ message: 'Method Not Allowed' });
};

// ✅ **Export the merged handler**
module.exports = handler;

