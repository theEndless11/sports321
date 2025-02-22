import { promisePool } from '../utils/db'; // Use MySQL connection pool

// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins or set a specific domain
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS'); // Allowed methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Allowed headers
    res.setHeader('Access-Control-Allow-Credentials', 'true'); // Enable credentials if needed
};

// Serverless API handler for getting posts
export default async function handler(req, res) {
    setCorsHeaders(res);

    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Handle GET requests to fetch posts
    if (req.method === 'GET') {
        try {
            // Fetch posts from the database, sorted by timestamp (newest first)
            const [posts] = await promisePool.execute('SELECT * FROM posts ORDER BY timestamp DESC');

            // Map over the posts and parse necessary fields
            const formattedPosts = posts.map(post => ({
                _id: post._id,
                message: post.message,
                timestamp: post.timestamp,
                username: post.username,
                sessionId: post.sessionId,
                likes: post.likes,
                dislikes: post.dislikes,
                likedBy: post.likedBy ? JSON.parse(post.likedBy) : [],
                dislikedBy: post.dislikedBy ? JSON.parse(post.dislikedBy) : [],
                comments: post.comments ? JSON.parse(post.comments) : [],
                photo: post.photo ? (post.photo.startsWith('data:image') ? post.photo : `data:image/webp;base64,${post.photo.toString('base64')}`) : null
            }));

            res.status(200).json(formattedPosts);
        } catch (error) {
            console.error("❌ Error retrieving posts:", error);
            res.status(500).json({ message: 'Error retrieving posts', error });
        }
    } else {
        res.status(405).json({ message: 'Method Not Allowed' });
    }
}

