const { promisePool } = require('../utils/db');
const { publishToAbly } = require('../utils/ably');
const multer = require('multer');
const path = require('path');
const bodyParser = require('body-parser');

// Set up Multer for photo uploads (store in 'uploads' folder)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, './uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname)); // Unique filename
    }
});

const upload = multer({ storage: storage });
const uploadPhoto = upload.single('photo');

// Parse incoming JSON data for requests that are not multipart
const jsonParser = bodyParser.json();

// Middleware for handling CORS headers
const setCorsHeaders = (req, res) => {
    const allowedOrigins = ['https://latestnewsandaffairs.site'];  // Replace with your actual allowed origins
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
module.exports = async function handler(req, res) {
    // Handle CORS and preflight requests
    if (req.method === 'OPTIONS') {
        setCorsHeaders(req, res);
        return res.status(200).end();
    }

    // Set CORS headers for all other requests
    setCorsHeaders(req, res);

    // POST: Create new post
    if (req.method === 'POST') {
        console.log('Received POST request');

        // If the request contains a file (multipart), use multer to parse it
        uploadPhoto(req, res, async (err) => {
            if (err) {
                console.error('Error uploading file:', err);
                return res.status(500).json({ message: 'Error uploading file', error: err });
            }

            // Log the incoming request data after multer parses the file
            console.log('File uploaded successfully, parsing body...');
            console.log('Request body:', req.body);

            // After multer parses the file, parse the JSON body
            jsonParser(req, res, async () => {
                // If `req.body` is empty, send the "Method Not Allowed" response before further processing
                if (!req.body.message || !req.body.username || !req.body.sessionId) {
                    console.log('Missing message, username, or sessionId');
                    return res.status(400).json({ message: 'Message, username, and sessionId are required' });
                }

                const { message, username, sessionId } = req.body;

                // Ensure message is not empty
                if (!message || message.trim() === '') {
                    console.log('Message is empty');
                    return res.status(400).json({ message: 'Message cannot be empty' });
                }

                // Ensure valid username and sessionId
                if (!username || !sessionId) {
                    console.log('Missing username or sessionId');
                    return res.status(400).json({ message: 'Username and sessionId are required' });
                }

                try {
                    let photoPath = null;

                    // Check if the request contains a file
                    if (req.file) {
                        console.log('Photo uploaded:', req.file.filename);
                        photoPath = `/uploads/${req.file.filename}`;
                    } else if (req.body.photo && req.body.photo.startsWith('data:image')) {
                        // Check if the photo is sent as base64 data
                        console.log('Received base64 photo data');
                        photoPath = req.body.photo;
                    }

                    // Insert new post into MySQL
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
                        console.log('Publishing to Ably...');
                        await publishToAbly('newOpinion', newPost);
                    } catch (error) {
                        console.error('Error publishing to Ably:', error);
                    }

                    // Respond with the newly created post
                    console.log('Post created successfully:', newPost);
                    return res.status(201).json(newPost);
                } catch (error) {
                    console.error('Error saving post:', error);
                    return res.status(500).json({ message: 'Error saving post', error });
                }
            });
        });
    }
};
