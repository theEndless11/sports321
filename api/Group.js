const { promisePool } = require('../utils/db');
const { publishToAbly } = require('../utils/ably');

// Set CORS headers with specific origin
const allowedOrigins = [
  'https://latestnewsandaffairs.site', 'http://localhost:5173'];

const setCorsHeaders = (req, res) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin'); // Ensures caching doesn't cause CORS mismatch
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
};
 const handler = async (req, res) => {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(req, res); // ✅ CORS headers for preflight
    return res.status(200).end();
  }

  setCorsHeaders(req, res); // 🟢 Still apply to regular requests
  try {
    if (req.method === 'POST') {
      const body = JSON.parse(event.body);
      const { name, creator } = body;

      if (!name || !creator) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Missing name or creator' }),
        };
      }

      const [result] = await promisePool.query(
        'INSERT INTO Groups (name, creator) VALUES (?, ?)',
        [name, creator]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          id: result.insertId,
          name,
          creator,
        }),
      };
    }

    if (req.method === 'GET') {
      const [groups] = await promisePool.query('SELECT * FROM Groups');

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(groups),
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};


