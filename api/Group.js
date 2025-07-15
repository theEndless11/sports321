const { promisePool } = require('../utils/db'); // MySQL connection pool

const allowedOrigins = [
  'https://latestnewsandaffairs.site',
  'http://localhost:5173',
];

const headers = {
  'Content-Type': 'application/json',
};

const setCorsHeaders = (req, res) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin'); // Avoid caching issues
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
    const { path, httpMethod } = event;

    if (path === '/createGroup' && httpMethod === 'POST') {
      const body = JSON.parse(event.body);
      const { name, creator } = body;

      if (!name || !creator) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Missing name or creator' }),
        };
      }

      // Directly insert into Groups without user verification
      const [result] = await promisePool.query(
        'INSERT INTO Groups (name, creator) VALUES (?, ?)',
        [name, creator]
      );

      const group = {
        id: result.insertId,
        name,
        creator,
      };

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(group),
      };
    }

    if (path === '/getGroups' && httpMethod === 'GET') {
      const [groups] = await promisePool.query('SELECT * FROM Groups');

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(groups),
      };
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Route not found' }),
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

