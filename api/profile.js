const { promisePool } = require('../utils/db');

const setCorsHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

// Unified handler for user profiles and all feed types
module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const defaultPfp = 'https://latestnewsandaffairs.site/public/pfp.jpg';

  if (req.method === 'GET') {
    const {
      username,
      username_like,
      start_timestamp,
      end_timestamp,
      page = 1,
      limit = 10,
      sort,
      userId
    } = req.query;

    try {
      // Handle user profile fetch
      if (username && !username_like && !start_timestamp && !end_timestamp && !userId) {
        return await handleUserProfile(username, res, defaultPfp);
      }

      // Handle personalized feed (when userId is provided and sort is 'general' or not specified)
      if (userId && (sort === 'general' || !sort)) {
        return await handlePersonalizedFeed(userId, page, limit, res, defaultPfp);
      }

      // Handle regular posts fetching (categories, trending, etc.)
      return await handleRegularPostsFetch(req.query, res, defaultPfp);

    } catch (error) {
      console.error('Error in main handler:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};

// === USER PROFILE HANDLER ===
async function handleUserProfile(username, res, defaultPfp) {
  try {
    const [rows] = await promisePool.execute(
      'SELECT username, profile_picture, Music, description, created_at FROM users WHERE username = ?',
      [username]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const user = rows[0];
    return res.status(200).json({
      username: user.username,
      profilePicture: user.profile_picture || defaultPfp,
      Music: user.Music || 'Music not available',
      description: user.description || 'No description available',
      created_at: user.created_at || 'created_at not available'
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

// === PERSONALIZED FEED HANDLER ===
async function handlePersonalizedFeed(userId, page, limit, res, defaultPfp) {
  try {
    console.log(`🎯 Generating personalized feed for user: ${userId}, page: ${page}`);
    
    // Get user data and relationships
    const userData = await getUserDataAndRelationships(userId);
    if (!userData) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get recently viewed posts (last 30 days for performance)
    const recentlyViewed = await getRecentlyViewedPosts(userId);
    
    // Generate feed composition
    const feedPosts = await generateFeedComposition(userData, recentlyViewed, parseInt(limit));
    
    // Enrich posts with user data (lightweight for feed)
    const enrichedPosts = await enrichPostsForFeed(feedPosts, defaultPfp);
    
    console.log(`✅ Generated ${enrichedPosts.length} posts for user ${userId}`);
    
    return res.status(200).json({
      posts: enrichedPosts,
      hasMorePosts: true, // Always true for infinite scroll
      feedType: 'personalized',
      composition: getActualComposition(feedPosts)
    });

  } catch (error) {
    console.error('❌ Error in personalized feed:', error);
    return res.status(500).json({ error: 'Failed to generate personalized feed' });
  }
}

// === REGULAR POSTS HANDLER ===
async function handleRegularPostsFetch(query, res, defaultPfp) {
  const {
    username_like,
    start_timestamp,
    end_timestamp,
    page = 1,
    limit = 10,
    sort
  } = query;

  try {
    let sql = 'SELECT * FROM posts';
    const params = [];
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Handle filtering conditions
    const conditions = [];

    if (username_like) {
      conditions.push('username LIKE ?');
      params.push(`%${username_like}%`);
    }

    if (start_timestamp && end_timestamp) {
      conditions.push('timestamp BETWEEN ? AND ?');
      params.push(start_timestamp, end_timestamp);
    }

    // Add category filtering
    if (sort && ['story_rant', 'sports', 'entertainment', 'news'].includes(sort)) {
      const categoryMap = {
        'story_rant': 'Story/Rant',
        'sports': 'Sports',
        'entertainment': 'Entertainment',
        'news': 'News'
      };
      
      console.log('🔍 Filtering for category:', sort, '-> DB value:', categoryMap[sort]);
      conditions.push('categories = ?');
      params.push(categoryMap[sort]);
    }

    // Add WHERE clause if we have conditions
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    // Handle sorting
    const sortOptions = {
      'trending': '(likes + comments_count + IFNULL(hearts, 0)) DESC, timestamp DESC',
      'newest': 'timestamp DESC',
      'general': 'timestamp DESC',
      'story_rant': 'timestamp DESC',
      'sports': 'timestamp DESC',
      'entertainment': 'timestamp DESC', 
      'news': 'timestamp DESC'
    };

    sql += ` ORDER BY ${sortOptions[sort] || 'timestamp DESC'} LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const [posts] = await promisePool.execute(sql, params);
    const enrichedPosts = await enrichPostsForFeed(posts, defaultPfp);

    // Update count query to match filtering
    let countQuery = 'SELECT COUNT(*) AS count FROM posts';
    if (conditions.length > 0) {
      countQuery += ' WHERE ' + conditions.join(' AND ');
    }
    const countParams = params.slice(0, params.length - 2);
    const [countResult] = await promisePool.execute(countQuery, countParams);

    return res.status(200).json({
      posts: enrichedPosts,
      hasMorePosts: (parseInt(page) * parseInt(limit)) < countResult[0].count,
      filterType: sort === 'general' ? 'general' : (sort || 'general')
    });

  } catch (error) {
    console.error('Error in regular posts fetch:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

// === PERSONALIZED FEED LOGIC ===
async function getUserDataAndRelationships(userId) {
  try {
    // Get user basic info and location
    const [userRows] = await promisePool.execute(
      'SELECT username, city, region, country FROM users WHERE username = ?',
      [userId]
    );

    if (userRows.length === 0) return null;
    const user = userRows[0];

    // Get friends (accepted relationships)
    const [friendsRows] = await promisePool.execute(`
      SELECT CASE 
        WHEN follower = ? THEN following 
        ELSE follower 
      END as friend_username
      FROM follows 
      WHERE (follower = ? OR following = ?) 
      AND relationship_status = 'accepted'
    `, [userId, userId, userId]);

    // Get following (one-way follows)
    const [followingRows] = await promisePool.execute(`
      SELECT following as following_username
      FROM follows 
      WHERE follower = ? AND relationship_status = 'none'
    `, [userId]);

    return {
      ...user,
      friends: friendsRows.map(row => row.friend_username),
      following: followingRows.map(row => row.following_username)
    };

  } catch (error) {
    console.error('Error getting user data:', error);
    throw error;
  }
}

async function getRecentlyViewedPosts(userId) {
  try {
    const [viewedRows] = await promisePool.execute(`
      SELECT post_id 
      FROM post_views 
      WHERE user_id = ? 
      AND viewed_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
      ORDER BY viewed_at DESC
      LIMIT 1000
    `, [userId]);

    return new Set(viewedRows.map(row => row.post_id));
  } catch (error) {
    console.error('Error getting viewed posts:', error);
    return new Set();
  }
}

async function generateFeedComposition(userData, recentlyViewed, limit) {
  const posts = [];
  
  // Target composition
  const composition = {
    random: Math.ceil(limit * 0.4),    // 40%
    following: Math.ceil(limit * 0.3), // 30%
    friends: Math.ceil(limit * 0.2),   // 20%
    regional: Math.ceil(limit * 0.1)   // 10%
  };

  try {
    // Get different types of posts
    const randomPosts = await getRandomPosts(userData, recentlyViewed, composition.random);
    posts.push(...randomPosts);

    const followingPosts = await getFollowingPosts(userData, recentlyViewed, composition.following);
    posts.push(...followingPosts);

    const friendsPosts = await getFriendsPosts(userData, recentlyViewed, composition.friends);
    posts.push(...friendsPosts);

    const regionalPosts = await getRegionalPosts(userData, recentlyViewed, composition.regional);
    posts.push(...regionalPosts);

    // Fill remaining slots with random if needed
    if (posts.length < limit) {
      const additionalRandom = await getRandomPosts(
        userData, 
        new Set([...recentlyViewed, ...posts.map(p => p._id)]), 
        limit - posts.length
      );
      posts.push(...additionalRandom);
    }

    // Shuffle to avoid predictable patterns
    return shuffleArray(posts).slice(0, limit);

  } catch (error) {
    console.error('Error in feed composition:', error);
    return await getRandomPosts(userData, recentlyViewed, limit);
  }
}

async function getRandomPosts(userData, recentlyViewed, count) {
  if (count <= 0) return [];
  
  const viewedFilter = recentlyViewed.size > 0 
    ? `AND p._id NOT IN (${Array.from(recentlyViewed).map(() => '?').join(',')})` 
    : '';
  
  const [posts] = await promisePool.execute(`
    SELECT p.* FROM posts p
    WHERE p.timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
    ${viewedFilter}
    ORDER BY RAND()
    LIMIT ?
  `, [...Array.from(recentlyViewed), count]);

  return posts.map(post => ({ ...post, feedType: 'random' }));
}

async function getFollowingPosts(userData, recentlyViewed, count) {
  if (count <= 0 || userData.following.length === 0) {
    return await getRandomPosts(userData, recentlyViewed, count);
  }

  const viewedFilter = recentlyViewed.size > 0 
    ? `AND p._id NOT IN (${Array.from(recentlyViewed).map(() => '?').join(',')})` 
    : '';

  const followingPlaceholders = userData.following.map(() => '?').join(',');
  
  const [posts] = await promisePool.execute(`
    SELECT p.* FROM posts p
    WHERE p.username IN (${followingPlaceholders})
    ${viewedFilter}
    ORDER BY p.timestamp DESC
    LIMIT ?
  `, [...userData.following, ...Array.from(recentlyViewed), count]);

  return posts.map(post => ({ ...post, feedType: 'following' }));
}

async function getFriendsPosts(userData, recentlyViewed, count) {
  if (count <= 0 || userData.friends.length === 0) {
    return await getRandomPosts(userData, recentlyViewed, count);
  }

  const viewedFilter = recentlyViewed.size > 0 
    ? `AND p._id NOT IN (${Array.from(recentlyViewed).map(() => '?').join(',')})` 
    : '';

  const friendsPlaceholders = userData.friends.map(() => '?').join(',');
  
  const [posts] = await promisePool.execute(`
    SELECT p.* FROM posts p
    WHERE p.username IN (${friendsPlaceholders})
    ${viewedFilter}
    ORDER BY (p.likes + p.hearts + p.comments_count) DESC, p.timestamp DESC
    LIMIT ?
  `, [...userData.friends, ...Array.from(recentlyViewed), count]);

  return posts.map(post => ({ ...post, feedType: 'friends' }));
}

async function getRegionalPosts(userData, recentlyViewed, count) {
  if (count <= 0) return [];

  const viewedFilter = recentlyViewed.size > 0 
    ? `AND p._id NOT IN (${Array.from(recentlyViewed).map(() => '?').join(',')})` 
    : '';

  let posts = [];
  
  // Try city first, then region, then country
  if (userData.city && posts.length < count) {
    const [cityPosts] = await promisePool.execute(`
      SELECT p.* FROM posts p
      JOIN users u ON p.username = u.username
      WHERE u.city = ? AND p.username != ?
      ${viewedFilter}
      AND p.timestamp > DATE_SUB(NOW(), INTERVAL 3 DAY)
      ORDER BY (p.likes + p.hearts + p.comments_count) DESC, p.timestamp DESC
      LIMIT ?
    `, [userData.city, userData.username, ...Array.from(recentlyViewed), count]);
    
    posts.push(...cityPosts.map(post => ({ ...post, feedType: 'regional-city' })));
  }

  // Fill with random if not enough regional posts
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

// === POST ENRICHMENT FOR FEED (LIGHTWEIGHT) ===
async function enrichPostsForFeed(posts, defaultPfp) {
  if (posts.length === 0) return [];

  // Get unique usernames from posts
  const usernames = [...new Set(posts.map(p => p.username))];
  const usersMap = {};
  
  if (usernames.length > 0) {
    const userSql = `SELECT username, profile_picture FROM users WHERE username IN (${usernames.map(() => '?').join(',')})`;
    const [users] = await promisePool.execute(userSql, usernames);

    users.forEach(u => {
      usersMap[u.username.toLowerCase()] = u.profile_picture?.startsWith('data:image') || u.profile_picture?.startsWith('http')
        ? u.profile_picture
        : u.profile_picture ? `data:image/jpeg;base64,${u.profile_picture}` : defaultPfp;
    });
  }

  // Return lightweight post objects for feed view
  return posts.map(p => ({
    _id: p._id,
    message: p.message,
    timestamp: p.timestamp,
    username: p.username,
    likes: p.likes || 0,
    likedBy: p.likedBy ? (() => {
      try {
        return typeof p.likedBy === 'string' ? JSON.parse(p.likedBy) : p.likedBy;
      } catch {
        return [];
      }
    })() : [],
    commentsCount: p.comments_count || 0,
    hearts: p.hearts || 0,
    photo: p.photo?.startsWith('http') || p.photo?.startsWith('data:image')
      ? p.photo
      : p.photo ? `data:image/jpeg;base64,${p.photo.toString('base64')}` : null,
    profilePicture: usersMap[p.username.toLowerCase()] || defaultPfp,
    tags: p.tags ? (() => {
      try {
        return typeof p.tags === 'string' ? JSON.parse(p.tags) : p.tags;
      } catch {
        return [];
      }
    })() : [],
    feedType: p.feedType || 'regular',
    categories: p.categories || null,
    views_count: p.views_count || 0
  }));
}

// === UTILITY FUNCTIONS ===
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function getActualComposition(posts) {
  const composition = {};
  posts.forEach(post => {
    const type = post.feedType || 'unknown';
    composition[type] = (composition[type] || 0) + 1;
  });
  return composition;
}
