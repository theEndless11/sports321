import fs from 'fs';
import path from 'path';
import express from 'express';
import multer from 'multer';
import { promisePool } from '../utils/db';
import { publishToAbly } from '../utils/ably';

// Ensure the uploads directory exists
const uploadDir = path.resolve('uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('Uploads directory created');
}

const app = express();
app.use(express.json());

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../uploads'); // Log the resolved path
        console.log(`Resolved upload path: ${uploadDir}`); // Add this log for debugging
        cb(null, uploadDir); // Save file in 'uploads' folder
    },
    filename: (req, file, cb) => {
        const filename = `${Date.now()}${path.extname(file.originalname)}`;
        console.log(`Saving file as: ${filename}`);
        cb(null, filename); // Set filename as current timestamp + extension
    }
});

const upload = multer({ storage });
const uploadPhoto = upload.single('photo');

const setCorsHeaders = (req, res) => {
    const allowedOrigins = ['https://latestnewsandaffairs.site'];
    const origin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes(origin) ? origin : 'https://latestnewsandaffairs.site');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Cache-Control', 'no-cache');
};

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        setCorsHeaders(req, res);
        return res.status(200).end();
    }

    setCorsHeaders(req, res);

    if (req.method === 'POST') {
        try {
            await new Promise((resolve, reject) => {
                uploadPhoto(req, res, (err) => {
                    if (err) {
                        reject({ message: 'Error uploading photo', error: err });
                    } else {
                        resolve();
                    }
                });
            });

            const { message, username, sessionId } = req.body;

            if (!message || !message.trim()) return res.status(400).json({ message: 'Message cannot be empty' });
            if (!username || !sessionId) return res.status(400).json({ message: 'Username and sessionId are required' });

            let photoPath = req.file ? `/uploads/${req.file.filename}` : req.body.photo?.startsWith('data:image') ? req.body.photo : null;

            const [result] = await promisePool.execute(
                'INSERT INTO posts (message, timestamp, username, sessionId, likes, dislikes, likedBy, dislikedBy, comments, photo) VALUES (?, NOW(), ?, ?, 0, 0, ?, ?, ?, ?)',
                [message, username, sessionId, JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), photoPath]
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
                photo: photoPath
            };

            await publishToAbly('newOpinion', newPost).catch((error) => console.error('Error publishing to Ably:', error));

            return res.status(201).json(newPost);
        } catch (error) {
            console.error('Error saving post:', error);
            return res.status(500).json({ message: 'Error saving post', error });
        }
    }

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
}
