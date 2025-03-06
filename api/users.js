const { promisePool } = require('../utils/db');  // Assuming promisePool is your MySQL connection pool

const setCorsHeaders = (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins, or set a specific origin here
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); // Allow all necessary methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Allow necessary headers
    res.setHeader('Access-Control-Allow-Credentials', 'true'); // Enable credentials if needed
};

const profilePictureHandler = async (req, res) => {
    // Handle OPTIONS request (preflight check for CORS)
    if (req.method === 'OPTIONS') {
        setCorsHeaders(req, res); 
        return res.status(204).end();  // Send a 204 response with no content
    }

    setCorsHeaders(req, res); 

  // Fetch all users and their profile pictures
connection.query('SELECT username, profile_picture FROM users', (err, results) => {
  if (err) {
    console.error("Error fetching users:", err);
  } else {
    console.log("Users and profile pictures:", results);
  }

  // Close the connection
  connection.end();
});
