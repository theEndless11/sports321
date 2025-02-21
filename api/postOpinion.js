import { promisePool } from '../utils/db';
import { publishToAbly } from '../utils/ably';
import multer from 'multer';
import path from 'path';
import * as bodyParser from 'body-parser';  // To parse JSON bodies

// Set up Multer for photo uploads (store in 'uploads' folder)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, './uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });
const uploadPhoto = upload.single('photo');

// Parse incoming JSON data for requests that are not multipart
const jsonParser = bodyParser.json();

// Middleware for handling CORS headers
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
export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        setCorsHeaders(req, res);
        return res.status(200).end();
    }

    setCorsHeaders(req, res);

    // POST: Create new post
    if (req.method === 'POST') {
        // If the request contains a file (multipart), use multer to parse it
        uploadPhoto(req, res, async (err) => {
            if (err) {
                return res.status(500).json({ message: 'Error uploading file', error: err });
            }

            // After multer parses the file, parse the JSON body
            jsonParser(req, res, async () => {
                const { message, username, sessionId } = req.body;

                if (!message || message.trim() === '') {
                    return res.status(400).json({ message: 'Message cannot be empty' });
                }
                if (!username || !sessionId) {
                    return res.status(400).json({ message: 'Username and sessionId are required' });
                }

                try {
                    let photoPath = null;

                    if (req.file) {
                        photoPath = `/uploads/${req.file.filename}`;
                    } else if (req.body.photo && req.body.photo.startsWith('data:image')) {
                        photoPath = req.body.photo;
                    }

                    const [result] = await promisePool.execute(
                        'INSERT INTO posts (message, timestamp, username, sessionId, likes, dislikes, likedBy, dislikedBy, comments, photo) VALUES (?, NOW(), ?, ?, 0, 0, ?, ?, ?, ?)',
                        [message, username, sessionId, JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), photoPath || null]
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

                    // Publish to Ably
                    try {
                        await publishToAbly('newOpinion', newPost);
                    } catch (error) {
                        console.error('Error publishing to Ably:', error);
                    }

                    return res.status(201).json(newPost);
                } catch (error) {
                    console.error('Error saving post:', error);
                    return res.status(500).json({ message: 'Error saving post', error });
                }
            });
        });
    }

    return res.status(405).json({ message: 'Method Not Allowed' });
}

