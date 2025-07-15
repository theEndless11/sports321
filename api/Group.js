// /api/groupHandler.js
const { promisePool } = require('../utils/db'); // MySQL connection pool

exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': event.headers.origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  // Handle CORS preflight request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers,
      body: '',
    };
  }

  try {
    const { path, httpMethod } = event;

    if (path === '/createGroup' && httpMethod === 'POST') {
      const body = JSON.parse(event.body);
      const { name, creator } = body;

      // Check for valid input
      if (!name || !creator) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Missing name or creator' }),
        };
      }

      // Verify user exists
      const [userRows] = await promisePool.query('SELECT username FROM Users WHERE username = ?', [creator]);
      if (userRows.length === 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'User does not exist' }),
        };
      }

      // Insert group
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
