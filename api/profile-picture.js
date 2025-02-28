const { promisePool } = require('../utils/db');  // Corrected to use MySQL connection pool
// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins or set a specific domain
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS'); // Allowed methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Allowed headers
    res.setHeader('Access-Control-Allow-Credentials', 'true'); // Enable credentials if needed
};

// Function to handle profile picture update and retrieval
const profilePictureHandler = async (req, res) => {
    setCorsHeaders(req, res);

    // Handle GET request to retrieve profile picture
    if (req.method === 'GET') {
        const { username } = req.query;  // Get username from the query string

        if (!username) {
            return res.status(400).json({ message: 'Username is required' });
        }

        try {
            // Retrieve the profile picture from the database
            const [rows] = await promisePool.execute(
                'SELECT profile_picture FROM users WHERE username = ?',
                [username]
            );

            if (rows.length === 0) {
                return res.status(404).json({ message: 'User not found' });
            }

            // If no profile picture exists, return a default one
            const profilePicture = rows[0].profile_picture || 'defaultProfilePicture.jpg';
            return res.status(200).json({ profilePicture });
        } catch (error) {
            console.error('Error retrieving profile picture:', error);
            return res.status(500).json({ message: 'Error retrieving profile picture', error });
        }
    }

    // Handle POST request to update profile picture
    if (req.method === 'POST') {
        const { username, profilePicture } = req.body;  // Expecting profile picture as a URL or base64 data

        if (!username || !profilePicture) {
            return res.status(400).json({ message: 'Username and profile picture are required' });
        }

        try {
            // Update the user's profile picture in the database
            const [result] = await promisePool.execute(
                'UPDATE users SET profile_picture = ? WHERE username = ?',
                [profilePicture, username]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'User not found' });
            }

            return res.status(200).json({ message: 'Profile picture updated successfully' });
        } catch (error) {
            console.error('Error updating profile picture:', error);
            return res.status(500).json({ message: 'Error updating profile picture', error });
        }
    }

    // If the method is not GET or POST
    return res.status(405).json({ message: 'Method not allowed' });
};

module.exports = { profilePictureHandler };
