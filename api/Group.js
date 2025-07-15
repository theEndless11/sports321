const { promisePool } = require('../utils/db');

const allowedOrigins = [
  'https://latestnewsandaffairs.site',
  'http://localhost:5173',
  'https://sports321.vercel.app',
];

const headers = {
  'Content-Type': 'application/json',
};

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

exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  const req = {
    method: event.httpMethod,
    headers: event.headers || {},
  };

  const res = {
    setHeader: (name, value) => {
      headers[name] = value;
    },
  };

  if (req.method === 'OPTIONS') {
    setCorsHeaders(req, res);
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  setCorsHeaders(req, res);

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


