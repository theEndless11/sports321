// pages/api/follow.js (or wherever your API handler resides)
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

// === Helper: Notification creation ===
async function createNotification(recipient, sender, type, message) {
  try {
    await promisePool.execute(
      'INSERT INTO notifications (recipient, sender, type, message) VALUES (?, ?, ?, ?)',
      [recipient, sender, type, message]
    );
  } catch (error) {
    console.error('Error creating notification:', error);
  }
}

// === Helper: Follower/friend counts ===
async function updateFollowerCount(username, increment) {
  try {
    await promisePool.execute(
      'UPDATE users SET followers_count = GREATEST(0, COALESCE(followers_count,0) + ?) WHERE username = ?',
      [increment, username]
    );
  } catch (e) {
    console.error('Error updating follower count:', e);
  }
}

async function updateFriendsCount(username, increment) {
  try {
    await promisePool.execute(
      'UPDATE users SET friends_count = GREATEST(0, COALESCE(friends_count,0) + ?) WHERE username = ?',
      [increment, username]
    );
  } catch (e) {
    console.error('Error updating friends count:', e);
  }
}

// === Core API handler ===
module.exports = async function handler(req, res) {
  await new Promise(resolve => cors(corsOptions)(req, res, resolve));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, currentUser, targetUser, follower, following, requester, recipient } = req.body;

  try {
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
        if (currentUser && targetUser) {
          return await getRelationshipStatus(req, res);
        }
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (err) {
    console.error('❌ Error in Follow API:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// === Follow Logic ===
async function followUser(req, res) {
  const { follower, following } = req.body;
  if (!follower || !following || follower === following) {
    return res.status(400).json({ error: 'Invalid usernames' });
  }

  const [rows] = await promisePool.execute(
    'SELECT 1 FROM follows WHERE follower = ? AND following = ?',
    [follower, following]
  );
  if (rows.length) {
    return res.status(409).json({ error: 'Already following' });
  }

  await promisePool.execute(
    'INSERT INTO follows (follower, following, relationship_status) VALUES (?, ?, ?)',
    [follower, following, RELATIONSHIP.FOLLOWING]
  );
  await updateFollowerCount(following, 1);

  await createNotification(
    following,
    follower,
    'follow',
    `${follower} started following you`
  );

  return res.status(201).json({ success: true, message: 'Followed successfully' });
}

async function unfollowUser(req, res) {
  const { follower, following } = req.body;
  if (!follower || !following) {
    return res.status(400).json({ error: 'Invalid usernames' });
  }

  const [result] = await promisePool.execute(
    'DELETE FROM follows WHERE follower = ? AND following = ? AND relationship_status = ?',
    [follower, following, RELATIONSHIP.FOLLOWING]
  );

  if (result.affectedRows > 0) {
    await updateFollowerCount(following, -1);
  }

  return res.status(200).json({ success: true, message: 'Unfollowed successfully' });
}

// === Friend Logic ===
async function addFriend(req, res) {
  const { requester, recipient } = req.body;
  if (!requester || !recipient || requester === recipient) {
    return res.status(400).json({ error: 'Invalid usernames' });
  }

  const [reverseRows] = await promisePool.execute(
    'SELECT relationship_status FROM follows WHERE follower = ? AND following = ?',
    [recipient, requester]
  );

  if (reverseRows.length && reverseRows[0].relationship_status === RELATIONSHIP.PENDING) {
    // Accept pending request
    await promisePool.execute(
      'UPDATE follows SET relationship_status = ? WHERE follower = ? AND following = ?',
      [RELATIONSHIP.ACCEPTED, recipient, requester]
    );

    const [alreadyExists] = await promisePool.execute(
      'SELECT 1 FROM follows WHERE follower = ? AND following = ?',
      [requester, recipient]
    );
    if (!alreadyExists.length) {
      await promisePool.execute(
        'INSERT INTO follows (follower, following, relationship_status) VALUES (?, ?, ?)',
        [requester, recipient, RELATIONSHIP.ACCEPTED]
      );
    }

    await updateFriendsCount(requester, 1);
    await updateFriendsCount(recipient, 1);

    await createNotification(
      recipient,
      requester,
      'friend_accepted',
      `${requester} accepted your friend request`
    );
    await promisePool.execute(
      'DELETE FROM notifications WHERE recipient = ? AND sender = ? AND type = ?',
      [requester, recipient, 'friend_request']
    );

    return res.status(200).json({ success: true, message: 'Friend request accepted' });
  }

  // Send new friend request
  const [existing] = await promisePool.execute(
    'SELECT 1 FROM follows WHERE follower = ? AND following = ?',
    [requester, recipient]
  );
  if (existing.length) {
    return res.status(409).json({ error: 'Friend request already exists' });
  }

  await promisePool.execute(
    'INSERT INTO follows (follower, following, relationship_status) VALUES (?, ?, ?)',
    [requester, recipient, RELATIONSHIP.PENDING]
  );
  await createNotification(
    recipient,
    requester,
    'friend_request',
    `${requester} sent you a friend request`
  );

  return res.status(201).json({ success: true, message: 'Friend request sent' });
}

async function removeFriend(req, res) {
  const { requester, recipient } = req.body;
  if (!requester || !recipient) {
    return res.status(400).json({ error: 'Invalid usernames' });
  }

  const [friendshipCheck] = await promisePool.execute(
    'SELECT relationship_status FROM follows WHERE ((follower = ? AND following = ?) OR (follower = ? AND following = ?)) AND relationship_status = ?',
    [requester, recipient, recipient, requester, RELATIONSHIP.ACCEPTED]
  );
  const wereFriends = friendshipCheck.length > 0;

  await promisePool.execute(
    'DELETE FROM follows WHERE (follower = ? AND following = ?) OR (follower = ? AND following = ?)',
    [requester, recipient, recipient, requester]
  );

  await promisePool.execute(
    'DELETE FROM notifications WHERE ((recipient = ? AND sender = ?) OR (recipient = ? AND sender = ?)) AND type = ?',
    [requester, recipient, recipient, requester, 'friend_request']
  );

  if (wereFriends) {
    await updateFriendsCount(requester, -1);
    await updateFriendsCount(recipient, -1);
  }

  return res.status(200).json({ success: true, message: 'Friendship removed or cancelled' });
}

// === Relationship status ===
async function getRelationshipStatus(req, res) {
  const { currentUser, targetUser } = req.body;
  if (!currentUser || !targetUser) {
    return res.status(400).json({ error: 'Invalid usernames' });
  }

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

// === Notifications ===
async function getUserNotifications(req, res) {
  const { username } = req.params;
  if (!username) {
    return res.status(400).json({ error: 'Username required' });
  }

  try {
    const [notifications] = await promisePool.execute(
      'SELECT * FROM notifications WHERE recipient = ? ORDER BY created_at DESC LIMIT 50',
      [username]
    );
    return res.status(200).json({ notifications });
  } catch (err) {
    console.error('Error fetching notifications:', err);
    return res.status(500).json({ error: 'Failed to fetch notifications' });
  }
}

async function cleanupOldNotifications(req, res) {
  try {
    await promisePool.execute(
      'DELETE FROM notifications WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)'
    );
    return res.status(200).json({ success: true, message: 'Old notifications cleaned up' });
  } catch (err) {
    console.error('Error cleaning up notifications:', err);
    return res.status(500).json({ error: 'Failed to cleanup notifications' });
  }
}

// === Module exports ===
module.exports = {
  handler,
  followUser,
  unfollowUser,
  addFriend,
  removeFriend,
  getRelationshipStatus,
  getUserNotifications,
  cleanupOldNotifications,
};

