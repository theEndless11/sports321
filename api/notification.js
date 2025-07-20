const cors = require('cors');
const { promisePool } = require('../utils/db');

// CORS Configuration
const corsOptions = {
  origin: ['*', 'http://localhost:5173'],
  methods: ['GET', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

// Main handler
module.exports = async function handler(req, res) {
  await new Promise(resolve => cors(corsOptions)(req, res, resolve));
  const { method, url } = req;

  // Handle preflight
  if (method === 'OPTIONS') return res.status(200).end();

  try {
    // Route: GET /api/notifications/:username
    if (method === 'GET' && /^\/api\/notifications\/[^/]+$/.test(url)) {
      const username = url.split('/').pop();
      if (!username) return res.status(400).json({ error: 'Username is required' });

      const [notifications] = await promisePool.execute(
        `SELECT id, recipient, sender, type, message, created_at
         FROM notifications
         WHERE recipient = ?
         ORDER BY created_at DESC
         LIMIT 50`,
        [username]
      );

      return res.status(200).json(notifications);
    }

    // Route: GET /api/notifications/:username/count
    if (method === 'GET' && /^\/api\/notifications\/[^/]+\/count$/.test(url)) {
      const username = url.split('/')[3];
      if (!username) return res.status(400).json({ error: 'Username is required' });

      const [result] = await promisePool.execute(
        'SELECT COUNT(*) as count FROM notifications WHERE recipient = ?',
        [username]
      );

      return res.status(200).json({ count: result[0].count });
    }

    // Route: DELETE /api/notifications/cleanup
    if (method === 'DELETE' && url === '/api/notifications/cleanup') {
      await promisePool.execute(
        'DELETE FROM notifications WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)'
      );
      return res.status(200).json({ success: true, message: 'Old notifications cleaned up' });
    }

    // If no matching route
    return res.status(404).json({ error: 'Not found' });

  } catch (error) {
    console.error('Notification API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
