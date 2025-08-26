const { promisePool } = require('../utils/db');

const setCorsHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

module.exports = async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const defaultPfp = 'https://latestnewsandaffairs.site/public/pfp.jpg';

  if (req.method === 'GET') {
    const { username, username_like, start_timestamp, end_timestamp, page = 1, limit = 10, sort, userId } = req.query;

    if (username && !username_like && !start_timestamp && !end_timestamp && !userId) {
      return await handleUserProfile(username, res);
    }
    
    if (userId && (sort === 'general' || !sort)) {
      return await handlePersonalizedFeed(userId, page, limit, res, defaultPfp);
    }

    return await handleRegularPostsFetch(req.query, res, defaultPfp);
  }
};

async function handlePersonalizedFeed(userId, page, limit, res, defaultPfp) {
  try {
    const userData = await getUserDataAndRelationships(userId);
    if (!userData) return res.status(404).json({ message: 'User not found' });

    const recentlyViewed = await getRecentlyViewedPosts(userId);
    const feedPosts = await generateFeedComposition(userData, recentlyViewed, limit);
    const enrichedPosts = await enrichPostsWithUserData(feedPosts, defaultPfp);

    return res.status(200).json({
      posts: enrichedPosts,
      hasMorePosts: true,
      feedType: 'personalized'
    });
  } catch (error) {
    console.error('Personalized feed error:', error);
    return res.status(500).json({ error: 'Failed to generate personalized feed' });
  }
}

async function getUserDataAndRelationships(userId) {
  try {
    const [userRows] = await promisePool.execute(
      'SELECT username, city, country FROM users WHERE username = ?',
      [userId]
    );
    if (!userRows.length) return null;

    const [friendsRows] = await promisePool.execute(`
      SELECT CASE WHEN follower = ? THEN following ELSE follower END as friend_username
      FROM follows WHERE (follower = ? OR following = ?) AND relationship_status = 'accepted'
    `, [userId, userId, userId]);

    const [followingRows] = await promisePool.execute(`
      SELECT following as following_username FROM follows 
      WHERE follower = ? AND relationship_status = 'none'
    `, [userId]);

    return {
      ...userRows[0],
      friends: friendsRows.map(row => row.friend_username),
      following: followingRows.map(row => row.following_username)
    };
  } catch (error) {
    console.error('User data fetch error:', error);
    throw error;
  }
}

async function getRecentlyViewedPosts(userId) {
  try {
    const [viewedRows] = await promisePool.execute(`
      SELECT post_id FROM post_views 
      WHERE user_id = ? AND viewed_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
      ORDER BY viewed_at DESC LIMIT 1000
    `, [userId]);
    return new Set(viewedRows.map(row => row.post_id));
  } catch (error) {
    console.error('Viewed posts error:', error);
    return new Set();
  }
}

async function generateFeedComposition(userData, recentlyViewed, limit) {
  const posts = [];
  const composition = { random: 4, following: 3, friends: 2, regional: 1 };

  try {
    posts.push(...await getRandomPosts(userData, recentlyViewed, composition.random));
    posts.push(...await getFollowingPosts(userData, recentlyViewed, composition.following));
    posts.push(...await getFriendsPosts(userData, recentlyViewed, composition.friends));
    posts.push(...await getRegionalPosts(userData, recentlyViewed, composition.regional));

    if (posts.length < limit) {
      const additionalRandom = await getRandomPosts(
        userData, 
        new Set([...recentlyViewed, ...posts.map(p => p._id)]), 
        limit - posts.length
      );
      posts.push(...additionalRandom);
    }

    return shuffleArray(posts).slice(0, limit);
  } catch (error) {
    console.error('Feed composition error:', error);
    return await getRandomPosts(userData, recentlyViewed, limit);
  }
}

async function getRandomPosts(userData, recentlyViewed, count) {
  if (count <= 0) return [];
  
  const viewedCase = recentlyViewed.size > 0 ? 
    `CASE WHEN p._id IN (${Array.from(recentlyViewed).map(() => '?').join(',')}) THEN 1 ELSE 0 END` : '0';
  
  const [posts] = await promisePool.execute(`
    SELECT p.* FROM posts p WHERE p.timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY) 
    ORDER BY ${viewedCase}, RAND() LIMIT ?
  `, [...Array.from(recentlyViewed), count]);

  return posts.map(post => ({ ...post, feedType: 'random' }));
}

async function getFollowingPosts(userData, recentlyViewed, count) {
  if (count <= 0 || !userData.following.length) return await getRandomPosts(userData, recentlyViewed, count);

  const viewedCase = recentlyViewed.size > 0 ? 
    `CASE WHEN p._id IN (${Array.from(recentlyViewed).map(() => '?').join(',')}) THEN 1 ELSE 0 END` : '0';
  const followingPlaceholders = userData.following.map(() => '?').join(',');
  
  const [posts] = await promisePool.execute(`
    SELECT p.* FROM posts p WHERE p.username IN (${followingPlaceholders}) 
    ORDER BY ${viewedCase}, p.timestamp DESC LIMIT ?
  `, [...userData.following, ...Array.from(recentlyViewed), count]);

  return posts.map(post => ({ ...post, feedType: 'following' }));
}

async function getFriendsPosts(userData, recentlyViewed, count) {
  if (count <= 0 || !userData.friends.length) return await getRandomPosts(userData, recentlyViewed, count);

  const viewedCase = recentlyViewed.size > 0 ? 
    `CASE WHEN p._id IN (${Array.from(recentlyViewed).map(() => '?').join(',')}) THEN 1 ELSE 0 END` : '0';
  const friendsPlaceholders = userData.friends.map(() => '?').join(',');
  
  const [posts] = await promisePool.execute(`
    SELECT p.* FROM posts p WHERE p.username IN (${friendsPlaceholders}) 
    ORDER BY ${viewedCase}, (p.likes + p.hearts + CHAR_LENGTH(p.comments)) DESC, p.timestamp DESC LIMIT ?
  `, [...userData.friends, ...Array.from(recentlyViewed), count]);

  return posts.map(post => ({ ...post, feedType: 'friends' }));
}

async function getRegionalPosts(userData, recentlyViewed, count) {
  if (count <= 0) return [];

  const viewedCase = recentlyViewed.size > 0 ? 
    `CASE WHEN p._id IN (${Array.from(recentlyViewed).map(() => '?').join(',')}) THEN 1 ELSE 0 END` : '0';
  let posts = [];
  
  if (userData.city && posts.length < count) {
    const [cityPosts] = await promisePool.execute(`
      SELECT p.* FROM posts p JOIN users u ON p.username = u.username
      WHERE u.city = ? AND p.username != ? AND p.timestamp > DATE_SUB(NOW(), INTERVAL 3 DAY)
      ORDER BY ${viewedCase}, (p.likes + p.hearts) DESC, p.timestamp DESC LIMIT ?
    `, [userData.city, userData.username, ...Array.from(recentlyViewed), count]);
    posts.push(...cityPosts.map(post => ({ ...post, feedType: 'regional-city' })));
  }

  if (userData.country && posts.length < count) {
    const remaining = count - posts.length;
    const excludePosts = posts.map(() => '?').join(',') || "''";
    const [countryPosts] = await promisePool.execute(`
      SELECT p.* FROM posts p JOIN users u ON p.username = u.username
      WHERE u.country = ? AND p.username != ? AND p._id NOT IN (${excludePosts})
      AND p.timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY) 
      ORDER BY ${viewedCase}, (p.likes + p.hearts) DESC, p.timestamp DESC LIMIT ?
    `, [userData.country, userData.username, ...posts.map(p => p._id), ...Array.from(recentlyViewed), remaining]);
    posts.push(...countryPosts.map(post => ({ ...post, feedType: 'regional-country' })));
  }

  if (posts.length < count) {
    const additionalRandom = await getRandomPosts(
      userData, 
      new Set([...recentlyViewed, ...posts.map(p => p._id)]), 
      count - posts.length
    );
    posts.push(...additionalRandom.map(post => ({ ...post, feedType: 'regional-fallback' })));
  }

  return posts.slice(0, count);
}

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

async function handleUserProfile(username, res) {
  const [rows] = await promisePool.execute(
    'SELECT username, profile_picture, verified, Music, description, created_at FROM users WHERE username = ?',
    [username]
  );
  if (!rows.length) return res.status(404).json({ message: 'User not found' });
  
  const user = rows[0];
  return res.status(200).json({
    username: user.username,
    profilePicture: user.profile_picture,
    verified: Boolean(user.verified),
    Music: user.Music || 'Music not available',
    description: user.description || 'No description available',
    created_at: user.created_at || 'created_at not available'
  });
}

async function handleRegularPostsFetch(query, res, defaultPfp) {
  const { username_like, start_timestamp, end_timestamp, page = 1, limit = 10, sort } = query;
  
  let sql = 'SELECT * FROM posts';
  const params = [];
  const conditions = [];
  const offset = (parseInt(page) - 1) * parseInt(limit);

  if (username_like) { conditions.push('username LIKE ?'); params.push(`%${username_like}%`); }
  
  if (start_timestamp && end_timestamp) {
    conditions.push('timestamp BETWEEN ? AND ?');
    params.push(start_timestamp, end_timestamp);
  }

  if (sort && ['story_rant', 'sports', 'entertainment', 'news'].includes(sort)) {
    const categoryMap = { story_rant: 'Story/Rant', sports: 'Sports', entertainment: 'Entertainment', news: 'News' };
    conditions.push('categories = ?');
    params.push(categoryMap[sort]);
  }

  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');

  const sortOptions = {
    trending: '(likes + comments_count + IFNULL(hearts, 0)) DESC, timestamp DESC',
    newest: 'timestamp DESC',
    general: 'timestamp DESC',
    story_rant: 'timestamp DESC',
    sports: 'timestamp DESC',
    entertainment: 'timestamp DESC',
    news: 'timestamp DESC',
  };

  sql += ` ORDER BY ${sortOptions[sort] || 'timestamp DESC'} LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), offset);

  const [posts] = await promisePool.execute(sql, params);
  const enrichedPosts = await enrichPostsWithUserData(posts, defaultPfp);

  let countQuery = 'SELECT COUNT(*) AS count FROM posts';
  if (conditions.length) countQuery += ' WHERE ' + conditions.join(' AND ');
  const countParams = params.slice(0, params.length - 2);
  const [countResult] = await promisePool.execute(countQuery, countParams);

  return res.status(200).json({
    posts: enrichedPosts,
    hasMorePosts: (page * limit) < countResult[0].count,
    filterType: sort || 'general',
  });
}

async function enrichPostsWithUserData(posts, defaultPfp) {
  if (!posts.length) return [];
  
  const usernames = [...new Set(posts.map(p => p.username))];
  const replyToUsernames = posts.map(p => {
    try { return p.replyTo ? JSON.parse(p.replyTo)?.username : null; } catch { return null; }
  }).filter(Boolean);
  const allUsernames = [...new Set([...usernames, ...replyToUsernames])];
  const usersMap = {};
  
  if (allUsernames.length) {
    const userSql = `SELECT username, profile_picture, verified FROM users WHERE username IN (${allUsernames.map(() => '?').join(',')})`;
    const [users] = await promisePool.execute(userSql, allUsernames);
    
    users.forEach(u => {
      usersMap[u.username.toLowerCase()] = {
        profilePicture: u.profile_picture?.startsWith('data:image') ? u.profile_picture : 
          u.profile_picture ? `data:image/jpeg;base64,${u.profile_picture}` : defaultPfp,
        verified: Boolean(u.verified)
      };
    });
  }
  
  return posts.map(p => {
    let replyToData = null;
    try {
      replyToData = p.replyTo ? JSON.parse(p.replyTo) : null;
      if (replyToData) {
        const replyToUserData = usersMap[replyToData.username?.toLowerCase()];
        replyToData.profilePicture = replyToUserData?.profilePicture || defaultPfp;
        replyToData.verified = replyToUserData?.verified || false;
      }
    } catch { replyToData = null; }
    
    const userData = usersMap[p.username.toLowerCase()];
    
    return {
      _id: p._id,
      message: p.message,
      timestamp: p.timestamp,
      username: p.username,
      likes: p.likes,
      likedBy: (p.likedBy && typeof p.likedBy === 'string') ? JSON.parse(p.likedBy) : (p.likedBy || []),
      commentCount: p.comments_count || 0,
      photo: p.photo?.startsWith('http') || p.photo?.startsWith('data:image') ? p.photo : 
        p.photo ? `data:image/jpeg;base64,${p.photo.toString('base64')}` : null,
      profilePicture: userData?.profilePicture || defaultPfp,
      verified: userData?.verified || false,
      tags: p.tags ? (typeof p.tags === 'string' ? JSON.parse(p.tags) : p.tags) || [] : [],
      feedType: p.feedType || 'regular',
      views_count: p.views_count || 0,
      replyTo: replyToData
    };
  });
}







