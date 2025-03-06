const { promisePool } = require('../utils/db');  // Assuming promisePool is your MySQL connection pool

// Function to set CORS headers
const setCorsHeaders = (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins, or set a specific origin here
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); // Allow all necessary methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Allow necessary headers
    res.setHeader('Access-Control-Allow-Credentials', 'true'); // Enable credentials if needed
};

// API to fetch users and their profile pictures
app.get('/api/users', async (req, res) => {
    try {
        // Handle OPTIONS request (preflight check for CORS)
        if (req.method === 'OPTIONS') {
            setCorsHeaders(req, res);
            return res.status(204).end();  // Send a 204 response with no content
        }

        setCorsHeaders(req, res); // Set CORS headers for actual request

        // Query to fetch users and their profile pictures
        const [users] = await promisePool.execute('SELECT username, profile_picture FROM users');

        // Respond with the list of users
        res.json(users);
    } catch (error) {
        console.error("❌ Error fetching users:", error);
        res.status(500).json({ message: 'Error fetching users', error });
    }
});
