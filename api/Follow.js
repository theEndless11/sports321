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
    // Default to checking relationship status if no action specified
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
    console.error('❌ Error in Follow API:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// === Follow Logic ===
async function followUser(req, res) {
  const { follower, following } = req.body;
  if (!follower || !following || follower === following)
    return res.status(400).json({ error: 'Invalid usernames' });

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

  // Update follower count
  await updateFollowerCount(following, 1);

  return res.status(201).json({ success: true, message: 'Followed successfully' });
}

async function unfollowUser(req, res) {
  const { follower, following } = req.body;
  if (!follower || !following)
    return res.status(400).json({ error: 'Invalid usernames' });

  const [result] = await promisePool.execute(
    'DELETE FROM follows WHERE follower = ? AND following = ? AND relationship_status = ?',
    [follower, following, RELATIONSHIP.FOLLOWING]
  );

  // Only update count if a row was actually deleted
  if (result.affectedRows > 0) {
    await updateFollowerCount(following, -1);
  }

  return res.status(200).json({ success: true, message: 'Unfollowed successfully' });
}

// === Friend Logic ===
async function addFriend(req, res) {
  const { requester, recipient } = req.body;
  if (!requester || !recipient || requester === recipient)
    return res.status(400).json({ error: 'Invalid usernames' });

  const [reverseRows] = await promisePool.execute(
    'SELECT relationship_status FROM follows WHERE follower = ? AND following = ?',
    [recipient, requester]
  );

  // Accept request if it exists
  if (reverseRows.length && reverseRows[0].relationship_status === RELATIONSHIP.PENDING) {
    await promisePool.execute(
      'UPDATE follows SET relationship_status = ? WHERE follower = ? AND following = ?',
      [RELATIONSHIP.ACCEPTED, recipient, requester]
    );

    const [alreadyExists] = await promisePool.execute(
      'SELECT * FROM follows WHERE follower = ? AND following = ?',
      [requester, recipient]
    );

    if (!alreadyExists.length) {
      await promisePool.execute(
        'INSERT INTO follows (follower, following, relationship_status) VALUES (?, ?, ?)',
        [requester, recipient, RELATIONSHIP.ACCEPTED]
      );
    } else {
      await promisePool.execute(
        'UPDATE follows SET relationship_status = ? WHERE follower = ? AND following = ?',
        [RELATIONSHIP.ACCEPTED, requester, recipient]
      );
    }

    // Update friends count for both users
    await updateFriendsCount(requester, 1);
    await updateFriendsCount(recipient, 1);

    return res.status(200).json({ success: true, message: 'Friend request accepted' });
  }

  // Otherwise, send request
  const [existing] = await promisePool.execute(
    'SELECT * FROM follows WHERE follower = ? AND following = ?',
    [requester, recipient]
  );

  if (existing.length)
    return res.status(409).json({ error: 'Friend request already sent or exists' });

  await promisePool.execute(
    'INSERT INTO follows (follower, following, relationship_status) VALUES (?, ?, ?)',
    [requester, recipient, RELATIONSHIP.PENDING]
  );

  return res.status(201).json({ success: true, message: 'Friend request sent' });
}

async function removeFriend(req, res) {
  const { requester, recipient } = req.body;
  if (!requester || !recipient)
    return res.status(400).json({ error: 'Invalid usernames' });

  // Check if they were friends before removing
  const [friendshipCheck] = await promisePool.execute(
    'SELECT relationship_status FROM follows WHERE ((follower = ? AND following = ?) OR (follower = ? AND following = ?)) AND relationship_status = ?',
    [requester, recipient, recipient, requester, RELATIONSHIP.ACCEPTED]
  );

  const wereFriends = friendshipCheck.length > 0;

  await promisePool.execute(
    'DELETE FROM follows WHERE (follower = ? AND following = ?) OR (follower = ? AND following = ?)',
    [requester, recipient, recipient, requester]
  );

  // Update friends count if they were actually friends
  if (wereFriends) {
    await updateFriendsCount(requester, -1);
    await updateFriendsCount(recipient, -1);
  }

  return res.status(200).json({ success: true, message: 'Friendship removed or request cancelled' });
}

// === Status Check ===
async function getRelationshipStatus(req, res) {
  const { currentUser, targetUser } = req.body;
  if (!currentUser || !targetUser)
    return res.status(400).json({ error: 'Invalid usernames' });

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
}

// === Helper Functions ===
async function updateFollowerCount(username, increment) {
  try {
    await promisePool.execute(
      'UPDATE users SET followers_count = GREATEST(0, COALESCE(followers_count, 0) + ?) WHERE username = ?',
      [increment, username]
    );
  } catch (error) {
    console.error('Error updating follower count:', error);
  }
}

async function updateFriendsCount(username, increment) {
  try {
    await promisePool.execute(
      'UPDATE users SET friends_count = GREATEST(0, COALESCE(friends_count, 0) + ?) WHERE username = ?',
      [increment, username]
    );
  } catch (error) {
    console.error('Error updating friends count:', error);
  }
}
