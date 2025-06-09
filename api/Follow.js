// api/social.js - All social media endpoints in one file
const mysql = require('mysql2/promise');
const cors = require('cors');

// CORS configuration
const corsOptions = {
  origin: ['http://localhost:5173','*'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

export default async function handler(req, res) {
  // Handle CORS
  await new Promise((resolve) => {
    cors(corsOptions)(req, res, resolve);
  });

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action } = req.body;

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);

    switch (action) {
      case 'follow':
        return await handleFollow(req, res, connection);
      case 'unfollow':
        return await handleUnfollow(req, res, connection);
      case 'add_friend':
        return await handleAddFriend(req, res, connection);
      case 'remove_friend':
        return await handleRemoveFriend(req, res, connection);
      case 'relationship_status':
        return await handleRelationshipStatus(req, res, connection);
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Database error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Follow a user
async function handleFollow(req, res, connection) {
  const { follower, following } = req.body;

  if (!follower || !following) {
    return res.status(400).json({ error: 'Follower and following usernames are required' });
  }

  if (follower === following) {
    return res.status(400).json({ error: 'Cannot follow yourself' });
  }

  // Check if both users exist
  const [userCheck] = await connection.execute(
    'SELECT username FROM users WHERE username IN (?, ?)',
    [follower, following]
  );

  if (userCheck.length !== 2) {
    return res.status(404).json({ error: 'One or both users not found' });
  }

  // Check if already following
  const [existingFollow] = await connection.execute(
    'SELECT * FROM follows WHERE follower = ? AND following = ?',
    [follower, following]
  );

  if (existingFollow.length > 0) {
    return res.status(409).json({ error: 'Already following this user' });
  }

  // Create follow relationship
  await connection.execute(
    'INSERT INTO follows (follower, following, created_at) VALUES (?, ?, NOW())',
    [follower, following]
  );

  // Update follower counts
  await connection.execute(
    'UPDATE users SET followers_count = followers_count + 1 WHERE username = ?',
    [following]
  );

  await connection.execute(
    'UPDATE users SET following_count = following_count + 1 WHERE username = ?',
    [follower]
  );

  return res.status(201).json({ 
    success: true, 
    message: `${follower} is now following ${following}` 
  });
}

// Unfollow a user
async function handleUnfollow(req, res, connection) {
  const { follower, following } = req.body;

  if (!follower || !following) {
    return res.status(400).json({ error: 'Follower and following usernames are required' });
  }

  // Check if follow relationship exists
  const [existingFollow] = await connection.execute(
    'SELECT * FROM follows WHERE follower = ? AND following = ?',
    [follower, following]
  );

  if (existingFollow.length === 0) {
    return res.status(404).json({ error: 'Follow relationship not found' });
  }

  // Remove follow relationship
  await connection.execute(
    'DELETE FROM follows WHERE follower = ? AND following = ?',
    [follower, following]
  );

  // Update follower counts
  await connection.execute(
    'UPDATE users SET followers_count = GREATEST(followers_count - 1, 0) WHERE username = ?',
    [following]
  );

  await connection.execute(
    'UPDATE users SET following_count = GREATEST(following_count - 1, 0) WHERE username = ?',
    [follower]
  );

  return res.status(200).json({ 
    success: true, 
    message: `${follower} unfollowed ${following}` 
  });
}

// Add friend / Send friend request / Accept friend request
async function handleAddFriend(req, res, connection) {
  const { requester, recipient } = req.body;

  if (!requester || !recipient) {
    return res.status(400).json({ error: 'Requester and recipient usernames are required' });
  }

  if (requester === recipient) {
    return res.status(400).json({ error: 'Cannot add yourself as friend' });
  }

  // Check if both users exist
  const [userCheck] = await connection.execute(
    'SELECT username FROM users WHERE username IN (?, ?)',
    [requester, recipient]
  );

  if (userCheck.length !== 2) {
    return res.status(404).json({ error: 'One or both users not found' });
  }

  // Check existing friendship status
  const [existingFriendship] = await connection.execute(
    'SELECT * FROM friendships WHERE (user1 = ? AND user2 = ?) OR (user1 = ? AND user2 = ?)',
    [requester, recipient, recipient, requester]
  );

  if (existingFriendship.length > 0) {
    const friendship = existingFriendship[0];
    
    if (friendship.status === 'accepted') {
      return res.status(409).json({ error: 'Already friends' });
    }
    
    if (friendship.status === 'pending') {
      // If there's a pending request from recipient to requester, accept it
      if (friendship.user1 === recipient && friendship.user2 === requester) {
        await connection.execute(
          'UPDATE friendships SET status = "accepted", accepted_at = NOW() WHERE id = ?',
          [friendship.id]
        );

        // Update friend counts
        await connection.execute(
          'UPDATE users SET friends_count = friends_count + 1 WHERE username IN (?, ?)',
          [requester, recipient]
        );

        return res.status(200).json({ 
          success: true, 
          message: 'Friend request accepted' 
        });
      } else {
        return res.status(409).json({ error: 'Friend request already sent' });
      }
    }
  }

  // Send new friend request
  await connection.execute(
    'INSERT INTO friendships (user1, user2, status, created_at) VALUES (?, ?, "pending", NOW())',
    [requester, recipient]
  );

  return res.status(201).json({ 
    success: true, 
    message: 'Friend request sent' 
  });
}

// Remove friend / Cancel friend request
async function handleRemoveFriend(req, res, connection) {
  const { requester, recipient } = req.body;

  if (!requester || !recipient) {
    return res.status(400).json({ error: 'Requester and recipient usernames are required' });
  }

  // Find existing friendship
  const [existingFriendship] = await connection.execute(
    'SELECT * FROM friendships WHERE (user1 = ? AND user2 = ?) OR (user1 = ? AND user2 = ?)',
    [requester, recipient, recipient, requester]
  );

  if (existingFriendship.length === 0) {
    return res.status(404).json({ error: 'No friendship found' });
  }

  const friendship = existingFriendship[0];
  const wasAccepted = friendship.status === 'accepted';

  // Remove friendship
  await connection.execute(
    'DELETE FROM friendships WHERE id = ?',
    [friendship.id]
  );

  // If they were friends, update friend counts
  if (wasAccepted) {
    await connection.execute(
      'UPDATE users SET friends_count = GREATEST(friends_count - 1, 0) WHERE username IN (?, ?)',
      [requester, recipient]
    );
    
    return res.status(200).json({ 
      success: true, 
      message: 'Friend removed' 
    });
  } else {
    return res.status(200).json({ 
      success: true, 
      message: 'Friend request cancelled' 
    });
  }
}

// Check relationship status between two users
async function handleRelationshipStatus(req, res, connection) {
  const { currentUser, targetUser } = req.body;

  if (!currentUser || !targetUser) {
    return res.status(400).json({ error: 'Both usernames are required' });
  }

  // Check follow status
  const [followCheck] = await connection.execute(
    'SELECT * FROM follows WHERE follower = ? AND following = ?',
    [currentUser, targetUser]
  );

  // Check friendship status
  const [friendshipCheck] = await connection.execute(
    'SELECT * FROM friendships WHERE (user1 = ? AND user2 = ?) OR (user1 = ? AND user2 = ?)',
    [currentUser, targetUser, targetUser, currentUser]
  );

  let friendshipStatus = 'none';
  if (friendshipCheck.length > 0) {
    const friendship = friendshipCheck[0];
    if (friendship.status === 'accepted') {
      friendshipStatus = 'friends';
    } else if (friendship.status === 'pending') {
      if (friendship.user1 === currentUser) {
        friendshipStatus = 'pending_sent';
      } else {
        friendshipStatus = 'pending_received';
      }
    }
  }

  return res.status(200).json({
    isFollowing: followCheck.length > 0,
    friendshipStatus: friendshipStatus
  });
}

