import { promisePool } from '../utils/db'; // MySQL connection pool
import fs from 'fs'; // File system module for local file deletion

const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

export default async function handler(req, res) {
    console.log("Incoming request body:", req.body);  // Log the request body

    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        setCorsHeaders(res);
        return res.status(200).end();
    }

    setCorsHeaders(res);

    if (req.method === 'DELETE') {
        const { postId, username, sessionId } = req.body;

        // Check that the required fields are present
        if (!postId || !username || !sessionId) {
            return res.status(400).json({ message: 'Missing required fields: postId, username, sessionId' });
        }

        try {
            console.log(`Fetching post with postId: ${postId}`); // Log to ensure the correct postId is being used
            const [posts] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);

            if (posts.length === 0) {
                console.log(`No post found with postId: ${postId}`); // Log if no post found
                return res.status(404).json({ message: 'Post not found' });
            }

            const post = posts[0];

            // Log the post retrieved from the database
            console.log('Post found:', post);

            // Ensure the post belongs to the user making the request
            if (post.username !== username) {
                return res.status(403).json({ message: 'You can only delete your own posts' });
            }

            // If the post has a photo, handle its deletion
            if (post.photo) {
                console.log(`Deleting photo associated with postId: ${postId}`);  // Log that we are deleting the photo
                // If photos are stored locally
                if (post.photo.startsWith('data:image/')) {
                    // Optionally delete local file if photos are stored in the filesystem
                    const base64Data = post.photo.split(',')[1];
                    const buffer = Buffer.from(base64Data, 'base64');
                    const filePath = `./uploads/${postId}.jpg`;  // Assuming we save images with the postId

                    // Check if the file exists before attempting to delete
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);  // Delete the image from the filesystem
                        console.log(`Deleted local image file for postId: ${postId}`);  // Log file deletion
                    } else {
                        console.log(`No image file found for postId: ${postId}`);  // Log if no file found
                    }
                }
                // If photos are stored in cloud storage, you would need to implement cloud delete logic here
                // Example:
                // await cloudStorage.deleteFile(post.photo);
            }

            // Delete the post from the database
            await promisePool.execute('DELETE FROM posts WHERE _id = ?', [postId]);

            return res.status(200).json({ message: 'Post deleted successfully' });

        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Error deleting post', error });
        }
    } else if (req.method === 'PUT') {
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
