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
    if (req.method === 'POST') {
  const { name, creator, image } = req.body

  if (!name || !creator) {
    return res.status(400).json({ error: 'Missing name or creator' })
  }

  const [result] = await promisePool.query(
    'INSERT INTO Groups (name, creator, image) VALUES (?, ?, ?)',
    [name, creator, image || null]
  )

  return res.status(200).json({ message: 'Group created', groupId: result.insertId })
}
    }

    if (req.method === 'GET') {
      const [groups] = await promisePool.query('SELECT * FROM Groups');
      return res.status(200).json(groups);
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = handler;



