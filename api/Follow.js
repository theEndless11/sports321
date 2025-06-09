const { promisePool } = require('../utils/db');
const cors = require('cors');

// CORS settings for localhost and production
const corsOptions = {
  origin: ['http://localhost:5173', '*'], // update production domain
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

module.exports = async function handler(req, res) {
  // CORS middleware
  await new Promise((resolve) => cors(corsOptions)(req, res, resolve));

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body;
  const connection = promisePool;

  try {
    switch (action) {
      case 'follow':
        return await followUser(req, res, connection);
      case 'unfollow':
        return await unfollowUser(req, res, connection);
      case 'add_friend':
        return await addFriend(req, res, connection);
      case 'remove_friend':
        return await removeFriend(req, res, connection);
      case 'relationship_status':
        return await getRelationshipStatus(req, res, connection);
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('❌ Error in social API:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// Follow
async function followUser(req, res, db) {
  const { follower, following } = req.body;
  if (!follower || !following || follower === following)
    return res.status(400).json({ error: 'Invalid usernames' });

  const [rows] = await db.execute(
    'SELECT * FROM follows WHERE follower = ? AND following = ?',
    [follower, following]
  );
  if (rows.length) return res.status(409).json({ error: 'Already following or requested' });

  await db.execute(
    'INSERT INTO follows (follower, following, relationship_status) VALUES (?, ?, ?)',
    [follower, following, 'none']
  );

  return res.status(201).json({ success: true, message: `${follower} is now following ${following}` });
}

// Unfollow / Remove friend
async function unfollowUser(req, res, db) {
  const { follower, following } = req.body;
  if (!follower || !following)
    return res.status(400).json({ error: 'Invalid usernames' });

  await db.execute(
    'DELETE FROM follows WHERE follower = ? AND following = ?',
    [follower, following]
  );

  return res.status(200).json({ success: true, message: 'Unfollowed successfully' });
}

// Add friend (send or accept request)
async function addFriend(req, res, db) {
  const { requester, recipient } = req.body;
  if (!requester || !recipient || requester === recipient)
    return res.status(400).json({ error: 'Invalid usernames' });

  const [rows] = await db.execute(
    'SELECT * FROM follows WHERE follower = ? AND following = ?',
    [recipient, requester]
  );

  if (rows.length && rows[0].relationship_status === 'pending') {
    // Accept the request
    await db.execute(
      'UPDATE follows SET relationship_status = "accepted" WHERE follower = ? AND following = ?',
      [recipient, requester]
    );

    // Insert reverse accepted row
    await db.execute(
      'INSERT INTO follows (follower, following, relationship_status) VALUES (?, ?, ?)',
      [requester, recipient, 'accepted']
    );

    return res.status(200).json({ success: true, message: 'Friend request accepted' });
  }

  // Check if already requested
  const [existing] = await db.execute(
    'SELECT * FROM follows WHERE follower = ? AND following = ?',
    [requester, recipient]
  );
  if (existing.length) return res.status(409).json({ error: 'Request already sent or exists' });

  // Send friend request
  await db.execute(
    'INSERT INTO follows (follower, following, relationship_status) VALUES (?, ?, ?)',
    [requester, recipient, 'pending']
  );

  return res.status(201).json({ success: true, message: 'Friend request sent' });
}

// Remove friend or cancel request
async function removeFriend(req, res, db) {
  const { requester, recipient } = req.body;
  if (!requester || !recipient)
    return res.status(400).json({ error: 'Invalid usernames' });

  // Remove both directions if accepted
  await db.execute(
    'DELETE FROM follows WHERE (follower = ? AND following = ?) OR (follower = ? AND following = ?)',
    [requester, recipient, recipient, requester]
  );

  return res.status(200).json({ success: true, message: 'Friendship removed or request cancelled' });
}

// Get current relationship status
async function getRelationshipStatus(req, res, db) {
  const { currentUser, targetUser } = req.body;
  if (!currentUser || !targetUser)
    return res.status(400).json({ error: 'Invalid usernames' });

  const [rows] = await db.execute(
    'SELECT relationship_status, follower, following FROM follows WHERE (follower = ? AND following = ?) OR (follower = ? AND following = ?)',
    [currentUser, targetUser, targetUser, currentUser]
  );

  let isFollowing = false;
  let friendshipStatus = 'none';

  for (const row of rows) {
    if (row.follower === currentUser && row.following === targetUser && row.relationship_status === 'none') {
      isFollowing = true;
    } else if (row.relationship_status === 'pending') {
      friendshipStatus = row.follower === currentUser ? 'pending_sent' : 'pending_received';
    } else if (row.relationship_status === 'accepted') {
      friendshipStatus = 'friends';
    }
  }

  return res.status(200).json({ isFollowing, friendshipStatus });
}


