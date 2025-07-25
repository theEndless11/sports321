const { promisePool } = require('../utils/db');
const { publishToAbly } = require('../utils/ably');

// Set CORS headers with specific origin
const allowedOrigins = [
  'https://latestnewsandaffairs.site', 'http://localhost:5173'];

const setCorsHeaders = (req, res) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin'); // Ensures caching doesn't cause CORS mismatch
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
};


// ===== OPTIMIZED NOTIFICATION FUNCTIONS =====

/**
 * Send notifications to all followers when user creates a post
 */
async function sendPostNotificationsToFollowers(connection, username, postId, message, photo) {
    try {
        // Get all followers in a single query with better performance
        const [followers] = await connection.execute(`
            SELECT f.follower as username
            FROM follows f
            WHERE f.following = ? 
            AND f.relationship_status IN ('none', 'accepted')
            AND f.follower != ?
        `, [username, username]);

        if (followers.length === 0) {
            console.log(`📭 No followers found for ${username}`);
            return;
        }

        console.log(`📢 Sending post notifications to ${followers.length} followers of ${username}`);

        // Create optimized notification message
        const postPreview = message 
            ? (message.length > 50 ? message.substring(0, 50) + '...' : message)
            : (photo ? 'shared a photo' : 'made a post');
        
        const notificationMessage = `${username} posted: ${postPreview}`;
        const metadata = JSON.stringify({
            postId: postId,
            postType: photo ? 'photo' : 'text',
            preview: postPreview
        });

        // Batch insert all notifications in a single query
        const values = followers.map(follower => [
            follower.username,      // recipient
            username,               // sender
            'new_post',             // type
            notificationMessage,    // message
            metadata                // metadata
        ]);

        if (values.length > 0) {
            const placeholders = values.map(() => '(?, ?, ?, ?, ?)').join(', ');
            const flatValues = values.flat();

            await connection.execute(`
                INSERT INTO notifications (recipient, sender, type, message, metadata)
                VALUES ${placeholders}
            `, flatValues);

            console.log(`✅ Sent post notifications to ${followers.length} followers`);
        }

    } catch (error) {
        console.error('❌ Error sending post notifications:', error);
        // Don't throw - notifications shouldn't break post creation
    }
}

/**
 * Send notifications to users mentioned in tags (@username)
 */
async function sendTagNotifications(connection, authorUsername, taggedUsers, postId, message) {
    try {
        if (!taggedUsers || taggedUsers.length === 0) return;

        // Filter out duplicates and author
        const uniqueTags = [...new Set(taggedUsers.filter(tag => tag !== authorUsername))];
        if (uniqueTags.length === 0) return;

        // Verify tagged users exist in a single query
        const placeholders = uniqueTags.map(() => '?').join(',');
        const [validUsers] = await connection.execute(`
            SELECT username FROM users 
            WHERE username IN (${placeholders})
        `, uniqueTags);

        if (validUsers.length === 0) {
            console.log(`📭 No valid tagged users found`);
            return;
        }

        const postPreview = message 
            ? (message.length > 30 ? message.substring(0, 30) + '...' : message)
            : 'a post';

        const notificationMessage = `${authorUsername} mentioned you in ${postPreview}`;
        const metadata = JSON.stringify({
            postId: postId,
            mentionType: 'tag'
        });

        // Batch insert tag notifications
        const values = validUsers.map(user => [
            user.username,          // recipient
            authorUsername,         // sender  
            'tag_mention',          // type
            notificationMessage,    // message
            metadata                // metadata
        ]);

        if (values.length > 0) {
            const placeholders = values.map(() => '(?, ?, ?, ?, ?)').join(', ');
            const flatValues = values.flat();

            await connection.execute(`
                INSERT INTO notifications (recipient, sender, type, message, metadata)
                VALUES ${placeholders}
            `, flatValues);

            console.log(`✅ Sent tag notifications to ${validUsers.length} users`);
        }

    } catch (error) {
        console.error('❌ Error sending tag notifications:', error);
        // Don't throw - notifications shouldn't break post creation
    }
}

/**
 * Send notification when someone replies to a post
 */
async function sendReplyNotification(connection, replierUsername, originalAuthor, postId, replyMessage) {
    try {
        // Don't send notification if replying to own post
        if (replierUsername === originalAuthor) return;

        // Verify the original author exists
        const [userExists] = await connection.execute(
            'SELECT 1 FROM users WHERE username = ? LIMIT 1',
            [originalAuthor]
        );

        if (userExists.length === 0) return;

        const replyPreview = replyMessage 
            ? (replyMessage.length > 40 ? replyMessage.substring(0, 40) + '...' : replyMessage)
            : 'replied to your post';

        const notificationMessage = `${replierUsername} replied: ${replyPreview}`;
        const metadata = JSON.stringify({
            postId: postId,
            replyType: 'post_reply'
        });

        await connection.execute(`
            INSERT INTO notifications (recipient, sender, type, message, metadata)
            VALUES (?, ?, ?, ?, ?)
        `, [
            originalAuthor,
            replierUsername,
            'post_reply',
            notificationMessage,
            metadata
        ]);

        console.log(`✅ Sent reply notification to ${originalAuthor}`);

    } catch (error) {
        console.error('❌ Error sending reply notification:', error);
        // Don't throw - notifications shouldn't break post creation
    }
}

/**
 * Enhanced notification helper with duplicate prevention
 */
async function createNotificationWithMetadata(connection, recipient, sender, type, message, metadata = null) {
    try {
        // Prevent duplicate notifications within 2 minutes using created_at
        const [existing] = await connection.execute(`
            SELECT id FROM notifications 
            WHERE recipient = ? AND sender = ? AND type = ? AND message = ?
            AND created_at > DATE_SUB(NOW(), INTERVAL 2 MINUTE)
            LIMIT 1
        `, [recipient, sender, type, message]);
        
        if (existing.length > 0) {
            console.log(`⚠️ Duplicate notification prevented: ${type} from ${sender} to ${recipient}`);
            return null;
        }
        
        const [result] = await connection.execute(`
            INSERT INTO notifications (recipient, sender, type, message, metadata) 
            VALUES (?, ?, ?, ?, ?)
        `, [recipient, sender, type, message, metadata ? JSON.stringify(metadata) : null]);
        
        console.log(`✅ Notification created: ${type} from ${sender} to ${recipient}`);
        return result.insertId;
        
    } catch (error) {
        console.error('Error creating notification:', error);
        return null;
    }
}

/**
 * Bulk notification creation for better performance
 */
async function createBulkNotifications(connection, notifications) {
    try {
        if (!notifications || notifications.length === 0) return;

        const values = notifications.map(notif => [
            notif.recipient,
            notif.sender,
            notif.type,
            notif.message,
            notif.metadata ? JSON.stringify(notif.metadata) : null
        ]);

        const placeholders = values.map(() => '(?, ?, ?, ?, ?)').join(', ');
        const flatValues = values.flat();

        const [result] = await connection.execute(`
            INSERT INTO notifications (recipient, sender, type, message, metadata)
            VALUES ${placeholders}
        `, flatValues);

        console.log(`✅ Created ${notifications.length} bulk notifications`);
        return result;

    } catch (error) {
        console.error('Error creating bulk notifications:', error);
        return null;
    }
}

 const handler = async (req, res) => {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(req, res); // ✅ CORS headers for preflight
    return res.status(200).end()
  }

  setCorsHeaders(req, res); // 🟢 Still apply to regular requests

    // POST: Create new post
   if (req.method === 'POST') {
    const { message, username, sessionId, photo, profilePic, tags, replyTo } = req.body;
    
    if (!username || !sessionId) {
        return res.status(400).json({ message: 'Username and sessionId are required' });
    }
    if (!message && !photo) {
        return res.status(400).json({ message: 'Post content cannot be empty' });
    }

    const connection = await promisePool.getConnection();
    
try {
    await connection.beginTransaction();
    
    let profilePicture = 'https://latestnewsandaffairs.site/public/pfp1.jpg'; // Default picture
    
    // Fetch profile picture from the users table based on username if not provided
    const [userResult] = await connection.execute(
        'SELECT profile_picture FROM users WHERE username = ? LIMIT 1',
        [username]
    );
    
    // If a profile picture is found for the user, use it
    if (userResult.length > 0 && userResult[0].profile_picture) {
        profilePicture = userResult[0].profile_picture;
    }

    let photoUrl = photo || null;
    
    // Use provided tags or extract from message
    const extractedTags = tags || (message ? [...new Set(message.match(/@(\w+)/g)?.map(tag => tag.slice(1)) || [])] : []);
    
    // Validate replyTo if provided
    let replyToData = null;
    if (replyTo && replyTo.postId) {
        const [replyPost] = await connection.execute(
            'SELECT _id, username, message, photo, timestamp FROM posts WHERE _id = ?',
            [replyTo.postId]
        );
        if (replyPost.length > 0) {
            replyToData = {
                postId: replyPost[0]._id,
                username: replyPost[0].username,
                message: replyPost[0].message,
                photo: replyPost[0].photo,
                timestamp: replyPost[0].timestamp
            };
        } else {
            await connection.rollback();
            return res.status(400).json({ message: 'Replied-to post not found' });
        }
    }

    // Insert new post into the posts table
    const [result] = await connection.execute(
        `INSERT INTO posts (message, timestamp, username, sessionId, likes, dislikes, likedBy, dislikedBy, comments, photo, tags, replyTo)
         VALUES (?, NOW(), ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)`,
        [
            message || '',
            username,
            sessionId,
            '[]', // likedBy
            '[]', // dislikedBy
            '[]', // comments
            photoUrl,
            JSON.stringify(extractedTags),
            replyToData ? JSON.stringify(replyToData) : null
        ]
    );

    const postId = result.insertId;
    
    // Create the new post object
    const newPost = {
        _id: postId,
        message: message || '',
        timestamp: new Date(),
        username,
        likes: 0,
        dislikes: 0,
        likedBy: [],
        dislikedBy: [],
        comments: [],
        photo: photoUrl,
        profilePicture,
        tags: extractedTags,
        replyTo: replyToData
    };

    // ===== OPTIMIZED NOTIFICATION SYSTEM =====
    const notificationPromises = [];

    // 1. Send notifications to followers
    if (username) {
        notificationPromises.push(sendPostNotificationsToFollowers(connection, username, postId, message, photoUrl));
    }

    // 2. Send notifications to tagged users
    if (extractedTags.length > 0) {
        notificationPromises.push(sendTagNotifications(connection, username, extractedTags, postId, message));
    }

    // 3. Send reply notification
    if (replyToData && replyToData.username !== username) {
        notificationPromises.push(sendReplyNotification(connection, username, replyToData.username, postId, message));
    }

    // Execute all notifications concurrently
    await Promise.allSettled(notificationPromises);

    await connection.commit();
    console.log(`✅ Post created successfully with ${extractedTags.length} tags and notifications sent`);
    
    // Publish the new post to Ably
    try {
        await publishToAbly('newOpinion', newPost);
    } catch (error) {
        console.error('Error publishing to Ably:', error);
    }

    return res.status(201).json(newPost);

} catch (error) {
    await connection.rollback();
    console.error('Error saving post:', {
        error: error.message,
        username,
        postData: { message: message?.substring(0, 50), photo: !!photo }
    });
    return res.status(500).json({ message: 'Error saving post', error: error.message });
} finally {
    connection.release();
}
}

    // PUT/PATCH: Handle likes/dislikes
    if (req.method === 'PUT' || req.method === 'PATCH') {
        const { postId, action, username } = req.body;
      
        if (!postId || !action || !username) {
            return res.status(400).json({ message: 'Post ID, action, and username are required' });
        }

        try {
            // Get the post from MySQL
            const [postRows] = await promisePool.execute('SELECT * FROM posts WHERE _id = ?', [postId]);
            const post = postRows[0];

            if (!post) {
                return res.status(404).json({ message: 'Post not found' });
            }

            let updatedLikes = post.likes;
            let updatedDislikes = post.dislikes;
            let updatedLikedBy = JSON.parse(post.likedBy);
            let updatedDislikedBy = JSON.parse(post.dislikedBy);

            // Handle the 'like' action
            if (action === 'like') {
                if (updatedLikedBy.includes(username)) {
                    return res.status(400).json({ message: 'You have already liked this post' });
                }
                if (updatedDislikedBy.includes(username)) {
                    updatedDislikes -= 1;
                    updatedDislikedBy = updatedDislikedBy.filter(user => user !== username);
                }
                updatedLikes += 1;
                updatedLikedBy.push(username);
            }

            // Handle the 'dislike' action
            if (action === 'dislike') {
                if (updatedDislikedBy.includes(username)) {
                    return res.status(400).json({ message: 'You have already disliked this post' });
                }
                if (updatedLikedBy.includes(username)) {
                    updatedLikes -= 1;
                    updatedLikedBy = updatedLikedBy.filter(user => user !== username);
                }
                updatedDislikes += 1;
                updatedDislikedBy.push(username);
            }

            // Update the post in MySQL
            await promisePool.execute(
                'UPDATE posts SET likes = ?, dislikes = ?, likedBy = ?, dislikedBy = ? WHERE _id = ?',
                [updatedLikes, updatedDislikes, JSON.stringify(updatedLikedBy), JSON.stringify(updatedDislikedBy), postId]
            );

            const updatedPost = {
                _id: postId,
                message: post.message,
                timestamp: post.timestamp,
                username: post.username,
                likes: updatedLikes,
                dislikes: updatedDislikes,
                comments: JSON.parse(post.comments),
                photo: post.photo,
                profilePicture: post.profilePicture,
               tags: JSON.parse(post.tags || '[]'),
                replyTo: JSON.parse(post.replyTo || 'null')
            };

            try {
                await publishToAbly('updateOpinion', updatedPost);
            } catch (error) {
                console.error('Error publishing to Ably:', error);
            }

            return res.status(200).json(updatedPost);
        } catch (error) {
            console.error('Error updating post:', error);
            return res.status(500).json({ message: 'Error updating post', error });
        }
    }

    // Handle other methods
    return res.status(405).json({ message: 'Method Not Allowed' });
};
   
module.exports = handler;
