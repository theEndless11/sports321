const { promisePool } = require('../utils/db');

const allowedOrigins = [
  'https://latestnewsandaffairs.site',
  'http://localhost:5173',
];

const setCorsHeaders = (req, res) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
};

const handler = async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
  const { method } = req;

  if (method === 'POST') {
    const { action, name, creator, image, groupId, userId, username } = req.body;

    // 1. CREATE group
    if (!action && name && creator) {
      const [result] = await promisePool.query(
        'INSERT INTO Groups (name, creator, image) VALUES (?, ?, ?)',
        [name, creator, image || null]
      );
      return res.status(201).json({ success: true, groupId: result.insertId });
    }

    // 2. JOIN group
    if (action === 'join') {
      const [groupRows] = await promisePool.query('SELECT * FROM Groups WHERE id = ?', [groupId]);
      if (groupRows.length === 0) return res.status(404).json({ error: 'Group not found' });

      const group = groupRows[0];

      const [existingMember] = await promisePool.query(
        'SELECT * FROM group_members WHERE group_id = ? AND user_id = ?',
        [groupId, userId]
      );
      if (existingMember.length > 0) {
        return res.status(400).json({ error: 'You are already a member of this group' });
      }

      const [existingRequest] = await promisePool.query(
        'SELECT * FROM join_requests WHERE group_id = ? AND user_id = ? AND status = "pending"',
        [groupId, userId]
      );
      if (existingRequest.length > 0) {
        return res.status(400).json({ error: 'Join request already pending' });
      }

      const [memberCount] = await promisePool.query(
        'SELECT COUNT(*) as count FROM group_members WHERE group_id = ? AND status = "active"',
        [groupId]
      );
      if (memberCount[0].count >= (group.max_members || 100)) {
        return res.status(400).json({ error: 'Group is full' });
      }

      if (group.is_private || group.join_approval_required) {
        await promisePool.query(
          'INSERT INTO join_requests (group_id, user_id, username, message, status, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
          [groupId, userId, username || '', '', 'pending']
        );
        return res.status(200).json({ success: true, message: 'Join request submitted' });
      }

      // Public group: Add member directly
      await promisePool.query(
        'INSERT INTO group_members (group_id, user_id, username, role, joined_at, status) VALUES (?, ?, ?, "member", NOW(), "active")',
        [groupId, userId, username || '']
      );
      return res.status(200).json({ success: true, message: 'Joined group successfully' });
    }

    // 3. LEAVE group
    if (action === 'leave') {
      const [result] = await promisePool.query(
        'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
        [groupId, userId]
      );
      if (result.affectedRows === 0) {
        return res.status(400).json({ error: 'You are not a member of this group' });
      }
      return res.status(200).json({ success: true, message: 'Left the group' });
    }

    return res.status(400).json({ error: 'Invalid POST action or missing parameters' });
  }

  if (method === 'GET') {
    const { userId, groupId } = req.query;

    if (groupId) {
      // Get single group details
      const [groupRows] = await promisePool.query('SELECT * FROM Groups WHERE id = ?', [groupId]);
      if (groupRows.length === 0) return res.status(404).json({ error: 'Group not found' });

      const group = groupRows[0];

      const [members] = await promisePool.query(`
        SELECT user_id, username, role, joined_at, status
        FROM group_members
        WHERE group_id = ? AND status = 'active'
        ORDER BY 
          CASE role
            WHEN 'owner' THEN 1
            WHEN 'admin' THEN 2
            WHEN 'moderator' THEN 3
            ELSE 4
          END, username
      `, [groupId]);

      let userMembership = null;
      if (userId) {
        const [membership] = await promisePool.query(
          'SELECT * FROM group_members WHERE group_id = ? AND user_id = ?',
          [groupId, userId]
        );
        userMembership = membership[0] || null;
      }

      return res.status(200).json({
        success: true,
        group,
        members,
        userMembership,
        isMember: !!userMembership,
        canJoin: !userMembership && !group.is_private
      });
    }

    // Get all groups for a user
    const [groups] = await promisePool.query(`
      SELECT g.*, 
             gm.role AS user_role,
             gm.joined_at AS user_joined_at,
             (SELECT COUNT(*) FROM group_members WHERE group_id = g.id AND status = 'active') AS member_count
      FROM Groups g
      LEFT JOIN group_members gm ON g.id = gm.group_id AND gm.user_id = ?
      ORDER BY gm.joined_at DESC, g.name ASC
    `, [userId || '']);

    const joinedGroups = [], availableGroups = [];

    groups.forEach(group => {
      if (group.user_role) {
        joinedGroups.push({
          ...group,
          isMember: true,
          userRole: group.user_role,
          joinedAt: group.user_joined_at
        });
      } else if (!group.is_private) {
        availableGroups.push({
          ...group,
          isMember: false,
          canJoin: true
        });
      }
    });

    return res.status(200).json({
      success: true,
      joinedGroups,
      availableGroups,
      allGroups: groups
    });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });

} catch (error) {
  console.error('Group handler error:', error);
  return res.status(500).json({ error: 'Internal server error' });
}
};

module.exports = handler;



