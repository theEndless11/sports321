const { promisePool } = require('../utils/db'); // Assuming promisePool is your MySQL connection pool

// Function to set CORS headers
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins or specify a specific one
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); // Allow necessary methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Allow necessary headers
    res.setHeader('Access-Control-Allow-Credentials', 'true'); // Enable credentials if needed
};

// The Lambda handler function
module.exports.handler = async (event, context) => {
    const res = {
        statusCode: 200,
        headers: {},
        body: '',
    };

    try {
        // Handle OPTIONS request (preflight check for CORS)
        if (event.httpMethod === 'OPTIONS') {
            setCorsHeaders(res);
            return { ...res, statusCode: 204 };  // Return 204 for preflight response
        }

        setCorsHeaders(res); // Set CORS headers for actual request

        // Query to fetch users and their profile pictures
        const [users] = await promisePool.execute('SELECT username, profile_picture FROM posts');

        // Respond with the list of users
        res.body = JSON.stringify(users);
    } catch (error) {
        console.error("❌ Error fetching users:", error);
        res.statusCode = 500;
        res.body = JSON.stringify({ message: 'Error fetching users', error });
    }

    return res;
};
