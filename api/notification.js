const { promisePool } = require('../utils/db');

const allowedOrigins = [
  '*',
  'http://localhost:5173'
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

    // 🔹 GET notifications
if (method === 'GET' && action !== 'count') {
  const [notifications] = await promisePool.execute(
    `SELECT id, recipient, sender, type, message, created_at, metadata
     FROM notifications
     WHERE recipient = ?
     ORDER BY created_at DESC
     LIMIT 50`,
    [username]
  );
  
  // Process notifications to ensure metadata is properly parsed
  const processedNotifications = notifications.map(notification => ({
    ...notification,
    metadata: notification.metadata ? 
      (typeof notification.metadata === 'string' ? 
        JSON.parse(notification.metadata) : 
        notification.metadata
      ) : null
  }));
  
  return res.status(200).json(processedNotifications);
}

// Get notification count endpoint
if (method === 'GET' && action === 'count') {
  const [result] = await promisePool.execute(
    'SELECT COUNT(*) AS count FROM notifications WHERE recipient = ?',
    [username]
  );
  return res.status(200).json({ count: result[0].count });
}
    // 🧹 DELETE old notifications
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


