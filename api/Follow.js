const { promisePool } = require('../utils/db');
const cors = require('cors');

// === Constants ===
const RELATIONSHIP = {
  FOLLOWING: 'none',
  PENDING: 'pending',
  ACCEPTED: 'accepted',
};

// === CORS Settings ===
const corsOptions = {
  origin: ['*', 'http://localhost:5173'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

module.exports = async function handler(req, res) {
  await new Promise(resolve => cors(corsOptions)(req, res, resolve));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, currentUser, targetUser } = req.body;

  try {
    if (!action && currentUser && targetUser) {
      return await getRelationshipStatus(req, res);
    }

    switch (action) {
      case 'follow':
        return await followUser(req, res);
      case 'unfollow':
        return await unfollowUser(req, res);
      case 'add_friend':
        return await addFriend(req, res);
      case 'remove_friend':
        return await removeFriend(req, res);
      case 'relationship_status':
        return await getRelationshipStatus(req, res);
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('❌ Error in Follow API:', {
      error: error.message,
      stack: error.stack,
      body: req.body
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// === Enhanced Notification Helper ===
async function createNotification(recipient, sender, type, message, connection = null) {
  try {
    const db = connection || promisePool;
    
    // Prevent duplicate notifications
    const [existing] = await db.execute(
      'SELECT id FROM notifications WHERE recipient = ? AND sender = ? AND type = ? AND updated_at > DATE_SUB(NOW(), INTERVAL 1 MINUTE)',
      [recipient, sender, type]
    );
    
    if (existing.length > 0) {
      console.log(`⚠️ Duplicate notification prevented: ${type} from ${sender} to ${recipient}`);
      return;
    }
    
    await db.execute(
      'INSERT INTO notifications (recipient, sender, type, message) VALUES (?, ?, ?, ?)',
      [recipient, sender, type, message]
    );
    console.log(`✅ Notification created: ${type} from ${sender} to ${recipient}`);
  } catch (error) {
    console.error('Error creating notification:', error);
    // Don't throw - notifications shouldn't break the main flow
  }
}

// === Enhanced Friend Logic with Transactions ===
async function addFriend(req, res) {
  const { requester, recipient } = req.body;
  
  // Input validation
  if (!requester || !recipient) {
    return res.status(400).json({ error: 'Both requester and recipient are required' });
  }
  
  if (requester === recipient) {
    return res.status(400).json({ error: 'Cannot send friend request to yourself' });
  }

  // Sanitize inputs
  const cleanRequester = requester.trim();
  const cleanRecipient = recipient.trim();

  console.log(`🔍 Friend request: ${cleanRequester} -> ${cleanRecipient}`);

  const connection = await promisePool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    // Check if there's a pending request TO the recipient (they want to accept)
    const [pendingRows] = await connection.execute(
      'SELECT relationship_status FROM follows WHERE follower = ? AND following = ? FOR UPDATE',
      [cleanRequester, cleanRecipient]
    );

    // ACCEPTING A FRIEND REQUEST
    if (pendingRows.length && pendingRows[0].relationship_status === RELATIONSHIP.PENDING) {
      console.log(`✅ Accepting friend request from ${cleanRequester} to ${cleanRecipient}`);
      
      // Update the original request to accepted
      await connection.execute(
        'UPDATE follows SET relationship_status = ?, updated_at = NOW() WHERE follower = ? AND following = ?',
        [RELATIONSHIP.ACCEPTED, cleanRequester, cleanRecipient]
      );

      // Check if reverse relationship exists
      const [existingReverse] = await connection.execute(
        'SELECT relationship_status FROM follows WHERE follower = ? AND following = ? FOR UPDATE',
        [cleanRecipient, cleanRequester]
      );

      if (!existingReverse.length) {
        // Create the reverse relationship
        await connection.execute(
          'INSERT INTO follows (follower, following, relationship_status, updated_at) VALUES (?, ?, ?, NOW())',
          [cleanRecipient, cleanRequester, RELATIONSHIP.ACCEPTED]
        );
      } else {
        // Update existing reverse relationship
        await connection.execute(
          'UPDATE follows SET relationship_status = ?, updated_at = NOW() WHERE follower = ? AND following = ?',
          [RELATIONSHIP.ACCEPTED, cleanRecipient, cleanRequester]
        );
      }

      // Update friend counts
      await updateFriendsCount(cleanRequester, 1, connection);
      await updateFriendsCount(cleanRecipient, 1, connection);

      // Create acceptance notification
      await createNotification(
        cleanRequester, // Notify the original requester
        cleanRecipient, // That the recipient accepted
        'friend_accepted',
        `${cleanRecipient} accepted your friend request`,
        connection
      );

      // Remove the original friend request notification
      await connection.execute(
        'DELETE FROM notifications WHERE recipient = ? AND sender = ? AND type = ?',
        [cleanRecipient, cleanRequester, 'friend_request']
      );

      await connection.commit();
      console.log(`✅ Friend request accepted successfully`);
      
      return res.status(200).json({ 
        success: true, 
        message: 'Friend request accepted',
        friendshipStatus: 'friends'
      });
    }

    // SENDING A NEW FRIEND REQUEST
    // Check if request already exists in either direction
    const [existingRequest] = await connection.execute(
      'SELECT relationship_status, follower, following FROM follows WHERE (follower = ? AND following = ?) OR (follower = ? AND following = ?) FOR UPDATE',
      [cleanRequester, cleanRecipient, cleanRecipient, cleanRequester]
    );

    // Check for existing relationships
    for (const row of existingRequest) {
      if (row.relationship_status === RELATIONSHIP.ACCEPTED) {
        await connection.rollback();
        return res.status(409).json({ error: 'Users are already friends' });
      }
      if (row.relationship_status === RELATIONSHIP.PENDING) {
        if (row.follower === cleanRequester && row.following === cleanRecipient) {
          await connection.rollback();
          return res.status(409).json({ error: 'Friend request already sent' });
        }
      }
      if (row.relationship_status === RELATIONSHIP.FOLLOWING) {
        if (row.follower === cleanRequester && row.following === cleanRecipient) {
          await connection.rollback();
          return res.status(409).json({ error: 'You are already following this user' });
        }
      }
    }

    // Verify both users exist
    const [userCheck] = await connection.execute(
      'SELECT username FROM users WHERE username IN (?, ?)',
      [cleanRequester, cleanRecipient]
    );
    
    if (userCheck.length !== 2) {
      await connection.rollback();
      return res.status(400).json({ error: 'One or both users do not exist' });
    }

    // Send new friend request
    console.log(`📤 Sending new friend request from ${cleanRequester} to ${cleanRecipient}`);
    
    await connection.execute(
      'INSERT INTO follows (follower, following, relationship_status, updated_at) VALUES (?, ?, ?, NOW())',
      [cleanRequester, cleanRecipient, RELATIONSHIP.PENDING]
    );

    await createNotification(
      cleanRecipient,
      cleanRequester,
      'friend_request',
      `${cleanRequester} sent you a friend request`,
      connection
    );

    await connection.commit();
    console.log(`✅ Friend request sent successfully`);
    
    return res.status(201).json({ 
      success: true, 
      message: 'Friend request sent',
      friendshipStatus: 'pending_sent'
    });

  } catch (error) {
    await connection.rollback();
    console.error('❌ Error in addFriend:', {
      error: error.message,
      code: error.code,
      requester: cleanRequester,
      recipient: cleanRecipient
    });
    
    // Handle specific MySQL errors
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Relationship already exists' });
    }
    
    return res.status(500).json({ error: 'Failed to process friend request' });
  } finally {
    connection.release();
  }
}

async function removeFriend(req, res) {
  const { requester, recipient } = req.body;
  
  if (!requester || !recipient) {
    return res.status(400).json({ error: 'Both requester and recipient are required' });
  }

  const cleanRequester = requester.trim();
  const cleanRecipient = recipient.trim();

  console.log(`🗑️ Removing friendship/request: ${cleanRequester} <-> ${cleanRecipient}`);

  const connection = await promisePool.getConnection();
  
  try {
    await connection.beginTransaction();

    // Check if they were friends
    const [friendshipCheck] = await connection.execute(
      'SELECT relationship_status FROM follows WHERE ((follower = ? AND following = ?) OR (follower = ? AND following = ?)) AND relationship_status = ? FOR UPDATE',
      [cleanRequester, cleanRecipient, cleanRecipient, cleanRequester, RELATIONSHIP.ACCEPTED]
    );

    const wereFriends = friendshipCheck.length > 0;

    // Remove all relationships between the users
    const [result] = await connection.execute(
      'DELETE FROM follows WHERE (follower = ? AND following = ?) OR (follower = ? AND following = ?)',
      [cleanRequester, cleanRecipient, cleanRecipient, cleanRequester]
    );

    console.log(`🗑️ Deleted ${result.affectedRows} relationship records`);

    // Remove related notifications
    await connection.execute(
      'DELETE FROM notifications WHERE ((recipient = ? AND sender = ?) OR (recipient = ? AND sender = ?)) AND type IN (?, ?)',
      [cleanRequester, cleanRecipient, cleanRecipient, cleanRequester, 'friend_request', 'friend_accepted']
    );

    // Update friend counts if they were actually friends
    if (wereFriends) {
      await updateFriendsCount(cleanRequester, -1, connection);
      await updateFriendsCount(cleanRecipient, -1, connection);
      console.log(`📊 Updated friend counts for both users`);
    }

    await connection.commit();
    console.log(`✅ Friendship removal completed`);

    return res.status(200).json({ 
      success: true, 
      message: wereFriends ? 'Friendship ended' : 'Friend request cancelled',
      friendshipStatus: 'none'
    });

  } catch (error) {
    await connection.rollback();
    console.error('❌ Error in removeFriend:', {
      error: error.message,
      requester: cleanRequester,
      recipient: cleanRecipient
    });
    return res.status(500).json({ error: 'Failed to remove friendship' });
  } finally {
    connection.release();
  }
}

// === Enhanced Helper Functions ===
async function updateFollowerCount(username, increment, connection = null) {
  try {
    const db = connection || promisePool;
    const [result] = await db.execute(
      'UPDATE users SET followers_count = GREATEST(0, COALESCE(followers_count, 0) + ?) WHERE username = ?',
      [increment, username]
    );
    
    if (result.affectedRows === 0) {
      console.warn(`⚠️ User not found for follower count update: ${username}`);
    }
  } catch (error) {
    console.error('Error updating follower count:', error);
    throw error; // Re-throw in transaction context
  }
}

async function updateFriendsCount(username, increment, connection = null) {
  try {
    const db = connection || promisePool;
    const [result] = await db.execute(
      'UPDATE users SET friends_count = GREATEST(0, COALESCE(friends_count, 0) + ?) WHERE username = ?',
      [increment, username]
    );
    
    if (result.affectedRows === 0) {
      console.warn(`⚠️ User not found for friends count update: ${username}`);
    }
  } catch (error) {
    console.error('Error updating friends count:', error);
    throw error; // Re-throw in transaction context
  }
}

// === Keep other functions unchanged ===
async function followUser(req, res) {
  const { follower, following } = req.body;
  if (!follower || !following || follower === following)
    return res.status(400).json({ error: 'Invalid usernames' });

  try {
    const [rows] = await promisePool.execute(
      'SELECT relationship_status FROM follows WHERE (follower = ? AND following = ?) OR (follower = ? AND following = ?)',
      [follower, following, following, follower]
    );

    if (rows.length)
      return res.status(409).json({ error: 'Relationship already exists' });

    await promisePool.execute(
      'INSERT INTO follows (follower, following, relationship_status) VALUES (?, ?, ?)',
      [follower, following, RELATIONSHIP.FOLLOWING]
    );

    await updateFollowerCount(following, 1);

    return res.status(201).json({ success: true, message: 'Followed successfully' });
  } catch (error) {
    console.error('Error in followUser:', error);
    return res.status(500).json({ error: 'Failed to follow user' });
  }
}

async function unfollowUser(req, res) {
  const { follower, following } = req.body;
  if (!follower || !following)
    return res.status(400).json({ error: 'Invalid usernames' });

  try {
    const [result] = await promisePool.execute(
      'DELETE FROM follows WHERE follower = ? AND following = ? AND relationship_status = ?',
      [follower, following, RELATIONSHIP.FOLLOWING]
    );

    if (result.affectedRows > 0) {
      await updateFollowerCount(following, -1);
    }

    return res.status(200).json({ success: true, message: 'Unfollowed successfully' });
  } catch (error) {
    console.error('Error in unfollowUser:', error);
    return res.status(500).json({ error: 'Failed to unfollow user' });
  }
}

async function getRelationshipStatus(req, res) {
  const { currentUser, targetUser } = req.body;
  if (!currentUser || !targetUser)
    return res.status(400).json({ error: 'Invalid usernames' });

  try {
    const [rows] = await promisePool.execute(
      'SELECT relationship_status, follower, following FROM follows WHERE (follower = ? AND following = ?) OR (follower = ? AND following = ?)',
      [currentUser, targetUser, targetUser, currentUser]
    );

    let isFollowing = false;
    let friendshipStatus = 'none';

    rows.forEach(row => {
      if (
        row.relationship_status === RELATIONSHIP.FOLLOWING &&
        row.follower === currentUser &&
        row.following === targetUser
      ) {
        isFollowing = true;
      }
      if (row.relationship_status === RELATIONSHIP.PENDING) {
        friendshipStatus = row.follower === currentUser ? 'pending_sent' : 'pending_received';
      }
      if (row.relationship_status === RELATIONSHIP.ACCEPTED) {
        friendshipStatus = 'friends';
      }
    });

    return res.status(200).json({ isFollowing, friendshipStatus });
  } catch (error) {
    console.error('Error in getRelationshipStatus:', error);
    return res.status(500).json({ error: 'Failed to get relationship status' });
  }
}

// === Export functions ===
module.exports.addFriend = addFriend;
module.exports.removeFriend = removeFriend;
