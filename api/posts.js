const { promisePool } = require('../utils/db');

const setCorsHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

// Enhanced feed algorithm with discovery-first approach
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

    // Handle user profile fetch
    if (username && !username_like && !start_timestamp && !end_timestamp && !userId) {
      return await handleUserProfile(username, res);
    }

    // Handle personalized feed (only for 'general' sort or no sort specified)
    if (userId && (sort === 'general' || !sort)) {
      return await handlePersonalizedFeed(userId, page, limit, res, defaultPfp);
    }

    // Handle regular posts fetching with category filtering
    return await handleRegularPostsFetch(req.query, res, defaultPfp);
  }
};

// === PERSONALIZED FEED ALGORITHM ===
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
    const feedPosts = await generateFeedComposition(userData, recentlyViewed, limit);
    
    // Enrich posts with user data
    const enrichedPosts = await enrichPostsWithUserData(feedPosts, defaultPfp);
    
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

// === USER DATA AND RELATIONSHIPS ===
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

// === RECENTLY VIEWED POSTS ===
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
    return new Set(); // Return empty set on error
  }
}

// === FEED COMPOSITION GENERATOR ===
async function generateFeedComposition(userData, recentlyViewed, limit) {
  const posts = [];
  
  // Target composition for 10 posts:
  const composition = {
    random: 4,    // Increased from 3
    following: 3, 
    friends: 2,   // Increased from 1
    regional: 1
  };

  try {
    // 1. Get Random/Discovery posts (4 posts)
    const randomPosts = await getRandomPosts(userData, recentlyViewed, composition.random);
    posts.push(...randomPosts);

    // 2. Get Following posts (3 posts)  
    const followingPosts = await getFollowingPosts(userData, recentlyViewed, composition.following);
    posts.push(...followingPosts);

    // 3. Get Friends posts (2 posts)
    const friendsPosts = await getFriendsPosts(userData, recentlyViewed, composition.friends);
    posts.push(...friendsPosts);

    // 4. Get Regional posts (1 post)
    const regionalPosts = await getRegionalPosts(userData, recentlyViewed, composition.regional);
    posts.push(...regionalPosts);

    // 5. Fill remaining slots with random if needed
    if (posts.length < limit) {
      const additionalRandom = await getRandomPosts(
        userData, 
        new Set([...recentlyViewed, ...posts.map(p => p._id)]), 
        limit - posts.length
      );
      posts.push(...additionalRandom);
    }

    // 6. Shuffle to avoid predictable patterns
    return shuffleArray(posts).slice(0, limit);

  } catch (error) {
    console.error('Error in feed composition:', error);
    // Fallback to random posts
    return await getRandomPosts(userData, recentlyViewed, limit);
  }
}

// === CONTENT FETCHING FUNCTIONS ===
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
    ORDER BY (p.likes + p.hearts + CHAR_LENGTH(p.comments)) DESC, p.timestamp DESC
    LIMIT ?
  `, [...userData.friends, ...Array.from(recentlyViewed), count]);

  return posts.map(post => ({ ...post, feedType: 'friends' }));
}

async function getRegionalPosts(userData, recentlyViewed, count) {
  if (count <= 0) return [];

  const viewedFilter = recentlyViewed.size > 0 
    ? `AND p._id NOT IN (${Array.from(recentlyViewed).map(() => '?').join(',')})` 
    : '';

  // Try city first, then region, then country
  let posts = [];
  
  // City-level posts
  if (userData.city && posts.length < count) {
    const [cityPosts] = await promisePool.execute(`
      SELECT p.* FROM posts p
      JOIN users u ON p.username = u.username
      WHERE u.city = ? AND p.username != ?
      ${viewedFilter}
      AND p.timestamp > DATE_SUB(NOW(), INTERVAL 3 DAY)
      ORDER BY (p.likes + p.hearts) DESC, p.timestamp DESC
      LIMIT ?
    `, [userData.city, userData.username, ...Array.from(recentlyViewed), count]);
    
    posts.push(...cityPosts.map(post => ({ ...post, feedType: 'regional-city' })));
  }

  // Region-level posts if not enough city posts
  if (userData.region && posts.length < count) {
    const remaining = count - posts.length;
    const [regionPosts] = await promisePool.execute(`
      SELECT p.* FROM posts p
      JOIN users u ON p.username = u.username
      WHERE u.region = ? AND p.username != ?
      ${viewedFilter}
      AND p._id NOT IN (${posts.map(() => '?').join(',') || "''"})
      AND p.timestamp > DATE_SUB(NOW(), INTERVAL 5 DAY)
      ORDER BY (p.likes + p.hearts) DESC, p.timestamp DESC
      LIMIT ?
    `, [userData.region, userData.username, ...Array.from(recentlyViewed), ...posts.map(p => p._id), remaining]);
    
    posts.push(...regionPosts.map(post => ({ ...post, feedType: 'regional-region' })));
  }

  // Country-level posts if still not enough
  if (userData.country && posts.length < count) {
    const remaining = count - posts.length;
    const [countryPosts] = await promisePool.execute(`
      SELECT p.* FROM posts p
      JOIN users u ON p.username = u.username
      WHERE u.country = ? AND p.username != ?
      ${viewedFilter}
      AND p._id NOT IN (${posts.map(() => '?').join(',') || "''"})
      AND p.timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
      ORDER BY (p.likes + p.hearts) DESC, p.timestamp DESC
      LIMIT ?
    `, [userData.country, userData.username, ...Array.from(recentlyViewed), ...posts.map(p => p._id), remaining]);
    
    posts.push(...countryPosts.map(post => ({ ...post, feedType: 'regional-country' })));
  }

  // Fill with random if still not enough
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

// === EXISTING FUNCTIONS (keeping your original logic) ===
async function handleUserProfile(username, res) {
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
    profilePicture: user.profile_picture,
    Music: user.Music || 'Music not available',
    description: user.description || 'No description available',
    created_at: user.created_at || 'created_at not available'
  });
}

async function handleRegularPostsFetch(query, res, defaultPfp) {
  const {
    username_like,
    start_timestamp,
    end_timestamp,
    page = 1,
    limit = 10,
    sort,
  } = query;

  let sql = 'SELECT * FROM posts';
  const params = [];
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const conditions = [];

  if (username_like) {
    conditions.push('username LIKE ?');
    params.push(`%${username_like}%`);
  }

  if (start_timestamp && end_timestamp) {
    conditions.push('timestamp BETWEEN ? AND ?');
    params.push(start_timestamp, end_timestamp);
  }

  if (sort && ['story_rant', 'sports', 'entertainment', 'news'].includes(sort)) {
    const categoryMap = {
      story_rant: 'Story/Rant',
      sports: 'Sports',
      entertainment: 'Entertainment',
      news: 'News',
    };
    conditions.push('categories = ?');
    params.push(categoryMap[sort]);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

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

  // Count total posts matching the filters
  let countQuery = 'SELECT COUNT(*) AS count FROM posts';
  if (conditions.length > 0) {
    countQuery += ' WHERE ' + conditions.join(' AND ');
  }
  const countParams = params.slice(0, params.length - 2);
  const [countResult] = await promisePool.execute(countQuery, countParams);

  return res.status(200).json({
    posts: enrichedPosts,
    hasMorePosts: (page * limit) < countResult[0].count,
    filterType: sort === 'general' ? 'general' : (sort || 'general'),
  });
}

// === POST ENRICHMENT INCLUDING replyTo ===
async function enrichPostsWithUserData(posts, defaultPfp) {
  if (posts.length === 0) return [];

  // Collect usernames from posts
  const usernames = [...new Set(posts.map(p => p.username))];

  // Also collect usernames from replyTo fields in posts
  const replyToUsernames = posts
    .map(post => {
      try {
        const replyTo = post.replyTo ? JSON.parse(post.replyTo) : null;
        return replyTo?.username;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  // Combine all usernames
  const allUsernames = [...new Set([...usernames, ...replyToUsernames])];

  const usersMap = {};
  if (allUsernames.length) {
    const placeholders = allUsernames.map(() => '?').join(',');
    const [users] = await promisePool.execute(
      `SELECT username, profile_picture FROM users WHERE username IN (${placeholders})`,
      allUsernames
    );
    users.forEach(u => {
      usersMap[u.username.toLowerCase()] = u.profile_picture?.startsWith('data:image')
        ? u.profile_picture
        : u.profile_picture
        ? `data:image/jpeg;base64,${u.profile_picture}`
        : defaultPfp;
    });
  }

  return posts.map(post => {
    // Parse comments safely
    let comments = [];
    try {
      comments = post.comments ? JSON.parse(post.comments) : [];
    } catch {
      comments = [];
    }

    // Enrich comments with profile pictures, including nested replies
    const enrichedComments = comments.map(comment => ({
      ...comment,
      profilePicture: usersMap[comment.username?.toLowerCase()] || defaultPfp,
      replies: (comment.replies || []).map(reply => ({
        ...reply,
        profilePicture: usersMap[reply.username?.toLowerCase()] || defaultPfp,
      })),
    }));

    // Enrich replyTo data with profile picture
    let replyToData = null;
    try {
      replyToData = post.replyTo ? JSON.parse(post.replyTo) : null;
      if (replyToData) {
        replyToData.profilePicture = usersMap[replyToData.username?.toLowerCase()] || defaultPfp;
      }
    } catch {
      replyToData = null;
    }

    return {
      _id: post._id,
      message: post.message,
      timestamp: post.timestamp,
      username: post.username,
      sessionId: post.sessionId,
      likes: post.likes,
      dislikes: post.dislikes,
      likedBy: post.likedBy ? JSON.parse(post.likedBy) : [],
      dislikedBy: post.dislikedBy ? JSON.parse(post.dislikedBy) : [],
      hearts: post.hearts,
      comments: enrichedComments,
      photo: post.photo && (post.photo.startsWith('http') || post.photo.startsWith('data:image/'))
        ? post.photo
        : post.photo
        ? `data:image/jpeg;base64,${post.photo.toString('base64')}`
        : null,
      profilePicture: usersMap[post.username.toLowerCase()] || defaultPfp,
      tags: post.tags ? JSON.parse(post.tags) : [],
      replyTo: replyToData,
    };
  });
}











