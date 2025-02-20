import { promisePool } from '../utils/db';  // Use the MySQL connection pool from db.js

// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');  // Allow all origins or set a specific domain
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');  // Allowed methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');  // Allowed headers
    res.setHeader('Access-Control-Allow-Credentials', 'true'); // Enable cookies if needed
};

// Serverless API handler for getting posts
export default async function handler(req, res) {
    // Set CORS headers before processing the request
    setCorsHeaders(res);

    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end(); // Respond with a 200 OK for OPTIONS pre-flight
    }

    // Handle GET requests to fetch posts
    if (req.method === 'GET') {
        try {
            // Fetch posts from the database, sorted by the timestamp in descending order
            const [posts] = await promisePool.execute('SELECT * FROM posts ORDER BY timestamp DESC');

            // Map over the posts and parse the JSON fields (likedBy, dislikedBy, comments)
            const formattedPosts = posts.map(post => ({
                _id: post._id,
                message: post.message,
                timestamp: post.timestamp,
                username: post.username,
                sessionId: post.sessionId,
                likes: post.likes,
                dislikes: post.dislikes,
                likedBy: JSON.parse(post.likedBy),  // Parse JSON string back to array
                dislikedBy: JSON.parse(post.dislikedBy),  // Parse JSON string back to array
                comments: JSON.parse(post.comments)  // Parse JSON string back to array of comments
            }));

            // Send posts as a JSON response
            res.status(200).json(formattedPosts);
        } catch (error) {
            console.error("Error retrieving posts:", error);
            res.status(500).json({ message: 'Error retrieving posts', error }); // Handle any errors
        }
    } else {
        // If the request is not a GET request, respond with 405 Method Not Allowed
        res.status(405).json({ message: 'Method Not Allowed' });
    }
}
