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
      limit = 10, // Changed to 10 for lazy loading
      sort,
      userId // New parameter for personalized feed
    } = req.query;

    // Handle user profile fetch (unchanged)
    if (username && !username_like && !start_timestamp && !end_timestamp && !userId) {
      return await handleUserProfile(username, res);
    }

    // Handle personalized feed
    if (userId) {
      return await handlePersonalizedFeed(userId, page, limit, res, defaultPfp);
    }

    // Handle regular posts fetching (existing logic)
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
    // 1. Get Random/Discovery posts (3 posts)
    const randomPosts = await getRandomPosts(userData, recentlyViewed, composition.random);
    posts.push(...randomPosts);

    // 2. Get Following posts (3 posts)  
    const followingPosts = await getFollowingPosts(userData, recentlyViewed, composition.following);
    posts.push(...followingPosts);

    // 3. Get Friends posts (1 post)
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
    limit = 10, // Updated to 10
    sort
  } = query;

  let sql = 'SELECT * FROM posts';
  const params = [];
  const offset = (parseInt(page) - 1) * parseInt(limit);

  if (username_like) {
    sql += ' WHERE username LIKE ?';
    params.push(`%${username_like}%`);
  }

  if (start_timestamp && end_timestamp) {
    sql += params.length ? ' AND' : ' WHERE';
    sql += ' timestamp BETWEEN ? AND ?';
    params.push(start_timestamp, end_timestamp);
  }

  const sortOptions = {
    'most-liked': 'likes DESC',
    'most-comments': 'CHAR_LENGTH(comments) DESC',
    'newest': 'timestamp DESC'
  };

  sql += ` ORDER BY ${sortOptions[sort] || 'timestamp DESC'} LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), offset);

  const [posts] = await promisePool.execute(sql, params);
  const enrichedPosts = await enrichPostsWithUserData(posts, defaultPfp);

  const countQuery = `SELECT COUNT(*) AS count FROM posts${username_like || start_timestamp ? ' WHERE' : ''} ${username_like ? 'username LIKE ?' : ''}${username_like && start_timestamp ? ' AND ' : ''}${start_timestamp ? 'timestamp BETWEEN ? AND ?' : ''}`;
  const countParams = params.slice(0, params.length - 2);
  const [countResult] = await promisePool.execute(countQuery, countParams);

  return res.status(200).json({
    posts: enrichedPosts,
    hasMorePosts: (page * limit) < countResult[0].count
  });
}

// === POST ENRICHMENT (optimized for feed view) ===
async function enrichPostsWithUserData(posts, defaultPfp) {
  if (posts.length === 0) return [];

  // Get unique usernames from posts only (no comment processing for feed)
  const usernames = [...new Set(posts.map(p => p.username))];
  const usersMap = {};
  
  if (usernames.length) {
    const userSql = `SELECT username, profile_picture FROM users WHERE username IN (${usernames.map(() => '?').join(',')})`;
    const [users] = await promisePool.execute(userSql, usernames);

    users.forEach(u => {
      usersMap[u.username.toLowerCase()] = u.profile_picture?.startsWith('data:image')
        ? u.profile_picture
        : `data:image/jpeg;base64,${u.profile_picture}` || defaultPfp;
    });
  }

  // Return lightweight post objects for feed view
  return posts.map(p => {
    // Calculate comment count efficiently without parsing full comment data
    let commentCount = 0;
    
    // Debug: Log the raw comment data
    if (p._id === posts[0]?._id) { // Only log first post to avoid spam
      console.log(`🔍 Debug post ${p._id}:`);
      console.log('- Raw comments:', p.comments);
      console.log('- Comments type:', typeof p.comments);
      console.log('- Comments truthy:', !!p.comments);
      console.log('- Comments length:', p.comments?.length);
    }
    
    if (p.comments && p.comments.trim() !== '' && p.comments !== '[]') {
      try {
        // Handle both string and already parsed comments
        const comments = typeof p.comments === 'string' ? JSON.parse(p.comments) : p.comments;
        
        if (Array.isArray(comments) && comments.length > 0) {
          // Count main comments
          commentCount = comments.length;
          
          // Also count replies within comments for total engagement
          comments.forEach((comment, index) => {
            if (comment && comment.replies && Array.isArray(comment.replies)) {
              commentCount += comment.replies.length;
              
              // Debug first post's comments
              if (p._id === posts[0]?._id) {
                console.log(`  - Comment ${index + 1}: "${comment.comment}" + ${comment.replies.length} replies`);
              }
            }
          });
          
          // Debug log for posts with comments
          if (p._id === posts[0]?._id) {
            console.log(`✅ Post ${p._id}: ${commentCount} total comments/replies`);
          }
        } else {
          if (p._id === posts[0]?._id) {
            console.log(`ℹ️ Post ${p._id}: Comments array is empty or invalid`);
          }
        }
      } catch (e) {
        console.error(`❌ Error parsing comments for post ${p._id}:`, e);
        console.error('Raw comment data that failed:', p.comments);
        commentCount = 0;
      }
    } else {
      if (p._id === posts[0]?._id) {
        console.log(`ℹ️ Post ${p._id}: No comments or empty comments field`);
      }
    }

    return {
      _id: p._id,
      message: p.message,
      timestamp: p.timestamp,
      username: p.username,
      likes: p.likes,
      likedBy: (p.likedBy && typeof p.likedBy === 'string') ? JSON.parse(p.likedBy) : (p.likedBy || []),

      commentCount, // ✅ Include total comment + reply count for engagement
      photo: p.photo?.startsWith('http') || p.photo?.startsWith('data:image')
        ? p.photo
        : p.photo ? `data:image/jpeg;base64,${p.photo.toString('base64')}` : null,
      profilePicture: usersMap[p.username.toLowerCase()] || defaultPfp,
      tags: p.tags ? (typeof p.tags === 'string' ? JSON.parse(p.tags) : p.tags) || [] : [],
      feedType: p.feedType || 'regular',
      views_count: p.views_count || 0
    };
  });
}



