import express from 'express';
import multer from 'multer';
import { promisePool } from '../utils/db';
import { publishToAbly } from '../utils/ably';
import path from 'path';

const app = express();

// Body parsing middleware for JSON data
app.use(express.json());

// Set up Multer for photo uploads (store in 'uploads' folder)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './uploads/');  // Folder where photos will be saved
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));  // Unique file name
  }
});

const upload = multer({ storage: storage });

// Middleware for handling photo uploads in POST request
const uploadPhoto = upload.single('photo');

// Set CORS headers
const setCorsHeaders = (req, res) => {
    const allowedOrigins = ['https://latestnewsandaffairs.site'];  // Add more origins if needed
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
export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        setCorsHeaders(req, res);
        return res.status(200).end();
    }

    setCorsHeaders(req, res);

    // POST: Create new post
    if (req.method === 'POST') {
        // Use middleware to parse the body
        uploadPhoto(req, res, async (err) => {
            if (err) {
                // If there is an error during file upload, respond immediately
                return res.status(500).json({ message: 'Error uploading photo', error: err });
            }

            const { message, username, sessionId } = req.body;  // Destructure from req.body

            // Check for missing fields
            if (!message || message.trim() === '') {
                return res.status(400).json({ message: 'Message cannot be empty' });
            }
            if (!username || !sessionId) {
                return res.status(400).json({ message: 'Username and sessionId are required' });
            }

            try {
                // Upload photo if provided in the request
                let photoPath = null;

                // Check if the request has a file (from the photo upload)
                if (req.file) {
                    // File is uploaded, store file path
                    photoPath = `/uploads/${req.file.filename}`;
                } else if (req.body.photo && req.body.photo.startsWith('data:image')) {
                    // If photo is sent as base64
                    photoPath = req.body.photo;
                }

                // Insert the new post into MySQL with or without photo
                const [result] = await promisePool.execute(
                    'INSERT INTO posts (message, timestamp, username, sessionId, likes, dislikes, likedBy, dislikedBy, comments, photo) VALUES (?, NOW(), ?, ?, 0, 0, ?, ?, ?, ?)',
                    [message, username, sessionId, JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), photoPath || null]
                );

                const newPost = {
                    _id: result.insertId,  // MySQL auto-incremented ID
                    message,
                    timestamp: new Date(),
                    username,
                    likes: 0,
                    dislikes: 0,
                    likedBy: [],
                    dislikedBy: [],
                    comments: [],
                    photo: photoPath  // Include the photo path or base64 string
                };

                // Publish the new post to Ably
                try {
                    await publishToAbly('newOpinion', newPost);
                } catch (error) {
                    console.error('Error publishing to Ably:', error);
                }

                // Ensure that only one response is sent
                return res.status(201).json(newPost);

            } catch (error) {
                console.error('Error saving post:', error);
                return res.status(500).json({ message: 'Error saving post', error });
            }
        });

    }

    // PUT/PATCH: Handle likes/dislikes (same as before)
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

            return res.status(200).json(updatedPost);
        } catch (error) {
            console.error('Error updating post:', error);
            return res.status(500).json({ message: 'Error updating post', error });
        }
    }

    // Handle other methods
    return res.status(405).json({ message: 'Method Not Allowed' });
}

