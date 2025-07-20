const { promisePool } = require('../utils/db');

const allowedOrigins = [
  'https://latestnewsandaffairs.site',
  'http://localhost:5173',
  'https://sports321.vercel.app',
];

const setCorsHeaders = (req, res) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
};

const handler = async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { method } = req;
    const { username, action } = req.query;

    if (!username && method !== 'DELETE') {
      return res.status(400).json({ error: 'Username is required' });
    }

    // GET /api/notification?username=john — get latest notifications
    if (method === 'GET' && action !== 'count') {
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

    // GET /api/notification?username=john&action=count — get count
    if (method === 'GET' && action === 'count') {
      const [result] = await promisePool.execute(
        'SELECT COUNT(*) AS count FROM notifications WHERE recipient = ?',
        [username]
      );
      return res.status(200).json({ count: result[0].count });
    }

    // DELETE /api/notification?action=cleanup — cleanup old notifications
    if (method === 'DELETE' && action === 'cleanup') {
      await promisePool.execute(
        'DELETE FROM notifications WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)'
      );
      return res.status(200).json({ success: true, message: 'Old notifications cleaned up' });
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (error) {
    console.error('Notification API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = handler;

