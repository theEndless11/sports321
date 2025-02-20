import { promisePool } from '../utils/db'; // MySQL connection pool

// Set CORS headers for all methods
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');  // Allow all origins or specify your domain
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');  // Allowed methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');  // Allowed headers
};

export default async function handler(req, res) {
    console.log("Incoming request body:", req.body);  // Add this line to log the request body for PUT method

    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        setCorsHeaders(res);
        return res.status(200).end(); // Respond with 200 OK for OPTIONS pre-flight
    }

    setCorsHeaders(res);

    if (req.method === 'DELETE') {
        const { postId, username, sessionId } = req.body;

        // Check that the required fields are present
        if (!postId || !username || !sessionId) {
            return res.status(400).json({ message: 'Missing required fields: postId, username, sessionId' });
        }

        try {
            const [posts] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);

            if (posts.length === 0) {
                return res.status(404).json({ message: 'Post not found' });
            }

            const post = posts[0];

            // Ensure the post belongs to the user making the request
            if (post.username !== username) {
                return res.status(403).json({ message: 'You can only delete your own posts' });
            }

            // Delete the post from the database
            await promisePool.execute('DELETE FROM posts WHERE _id = ?', [postId]);

            return res.status(200).json({ message: 'Post deleted successfully' });

        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Error deleting post', error });
        }
    } else if (req.method === 'PUT') {
        // Log incoming body to confirm
        console.log("Incoming PUT body:", req.body);

        const { id, message, username, timestamp, sessionId } = req.body;

 if (!id || !message || !username || !timestamp) {
    return res.status(400).json({ message: 'Missing required fields: id, message, username, timestamp' });
}


        try {
            const [posts] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [id]);

            if (posts.length === 0) {
                return res.status(404).json({ message: 'Post not found' });
            }

            const post = posts[0];

            // Ensure the post belongs to the user making the request
            if (post.username !== username) {
                return res.status(403).json({ message: 'You can only edit your own posts' });
            }

            // Update the post
            await promisePool.execute(
                `UPDATE posts SET message = ?, timestamp = ? WHERE _id = ?`,
                [message, timestamp, id]
            );

            return res.status(200).json({ message: 'Post updated successfully', post });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Error editing post', error });
        }
    } else {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }
}