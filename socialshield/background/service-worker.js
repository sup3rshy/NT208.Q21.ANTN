/**
 * SocialShield Background Service Worker
 * Xử lý logic nền: auto-capture, notifications, Instagram API calls,
 * footprint monitor.
 */

// Load SocialShieldStorage để cache + lưu alerts từ background
try {
  importScripts('../lib/storage.js');
} catch (err) {
  console.error('[SocialShield BG] Failed to importScripts storage.js:', err);
}

// ==================== Instagram API (Background) ====================

const InstagramAPI = {
  /**
   * Lấy cookies Instagram từ chrome.cookies API
   */
  async getCookies() {
    const cookies = await chrome.cookies.getAll({ domain: '.instagram.com' });
    const cookieMap = {};
    for (const c of cookies) {
      cookieMap[c.name] = c.value;
    }
    return cookieMap;
  },

  /**
   * Lấy CSRF token từ cookies
   */
  async getCsrfToken() {
    const cookie = await chrome.cookies.get({
      url: 'https://www.instagram.com',
      name: 'csrftoken'
    });
    return cookie?.value || '';
  },

  /**
   * Kiểm tra user đã login Instagram chưa
   */
  async isLoggedIn() {
    const sessionId = await chrome.cookies.get({
      url: 'https://www.instagram.com',
      name: 'sessionid'
    });
    return !!sessionId?.value;
  },

  /**
   * Build Cookie header string từ cookies
   */
  async buildCookieHeader() {
    const cookies = await this.getCookies();
    return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  },

  // Shared headers cho Instagram API
  _igHeaders(csrfToken, cookieHeader) {
    return {
      'x-csrftoken': csrfToken,
      'x-ig-app-id': '936619743392459',
      'x-requested-with': 'XMLHttpRequest',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Cookie': cookieHeader,
    };
  },

  /**
   * Lấy raw profile data (shared between fetchUserId and fetchProfileInfo)
   * Cached 15 phút
   */
  async _fetchRawProfile(username) {
    const cacheKey = `_cache_ig_profile_${username}`;
    const TTL = 15 * 60 * 1000; // 15 minutes

    // Check cache
    const cached = await SocialShieldStorage.cacheGet(cacheKey, TTL);
    if (cached) {
      console.log(`[SocialShield BG] Cache hit for ${username}`);
      return cached;
    }

    const csrfToken = await this.getCsrfToken();
    const cookieHeader = await this.buildCookieHeader();

    const res = await fetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      { headers: this._igHeaders(csrfToken, cookieHeader) }
    );

    if (!res.ok) {
      console.error(`[SocialShield BG] fetchRawProfile failed: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const user = data?.data?.user;
    if (!user) return null;

    // Save to cache
    await SocialShieldStorage.cacheSet(cacheKey, user);
    return user;
  },

  /**
   * Lấy User ID từ username (cached via _fetchRawProfile)
   */
  async fetchUserId(username) {
    try {
      const user = await this._fetchRawProfile(username);
      return user?.id || null;
    } catch (err) {
      console.error('[SocialShield BG] fetchUserId error:', err);
      return null;
    }
  },

  /**
   * Lấy profile info (cached via _fetchRawProfile)
   */
  async fetchProfileInfo(username) {
    try {
      const user = await this._fetchRawProfile(username);
      if (!user) return null;

      // Trích captions của recent posts để phục vụ deep PII scan
      const recentCaptions = [];
      const recentPosts = [];
      const edges = user.edge_owner_to_timeline_media?.edges || [];
      for (const e of edges.slice(0, 12)) {
        const node = e?.node;
        if (!node) continue;
        const captionText = node?.edge_media_to_caption?.edges?.[0]?.node?.text || '';
        if (captionText) recentCaptions.push(captionText);
        recentPosts.push({
          id: node.id,
          shortcode: node.shortcode,
          caption: captionText,
          likes: node.edge_liked_by?.count || node.edge_media_preview_like?.count || 0,
          comments: node.edge_media_to_comment?.count || 0,
          isVideo: !!node.is_video,
          location: node.location?.name || null,
          takenAt: node.taken_at_timestamp ? new Date(node.taken_at_timestamp * 1000).toISOString() : null,
        });
      }

      return {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        isPrivate: user.is_private,
        isVerified: user.is_verified,
        followerCount: user.edge_followed_by?.count || 0,
        followingCount: user.edge_follow?.count || 0,
        postCount: user.edge_owner_to_timeline_media?.count || 0,
        profilePicUrl: user.profile_pic_url_hd || user.profile_pic_url,
        bio: user.biography || '',
        externalUrl: user.external_url || null,
        recentCaptions,
        recentPosts,
      };
    } catch (err) {
      console.error('[SocialShield BG] fetchProfileInfo error:', err);
      return null;
    }
  },

  /**
   * Fetch following/followers list qua API với pagination + verification
   * Retry nếu count chưa khớp expected count
   */
  async fetchConnections(userId, type, expectedCount = 0) {
    const MAX_ATTEMPTS = 3;
    const userMap = new Map();

    const csrfToken = await this.getCsrfToken();
    const cookieHeader = await this.buildCookieHeader();
    const headers = this._igHeaders(csrfToken, cookieHeader);
    const isFollowers = type === 'followers';
    const perPage = isFollowers ? 25 : 200;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        // Exponential backoff between attempts
        const backoff = Math.min(Math.pow(2, attempt) * 1000, 30000) + Math.random() * 2000;
        console.log(`[SocialShield BG] Backoff ${Math.round(backoff)}ms before attempt ${attempt}`);
        await new Promise(r => setTimeout(r, backoff));
      }

      let maxId = null;
      let hasMore = true;
      let page = 0;

      while (hasMore) {
        page++;
        try {
          let url;
          if (isFollowers) {
            url = `https://www.instagram.com/api/v1/friendships/${userId}/followers/?count=${perPage}&search_surface=follow_list_page`;
          } else {
            url = `https://www.instagram.com/api/v1/friendships/${userId}/following/?count=${perPage}`;
          }
          if (maxId) {
            url += `&max_id=${maxId}`;
          }

          const res = await fetch(url, { headers });

          // Phát hiện redirect đến login/challenge page
          if (res.redirected) {
            console.warn(`[SocialShield BG] Redirected to: ${res.url}`);
            if (res.url.includes('/accounts/login') || res.url.includes('/challenge')) {
              console.error('[SocialShield BG] Session expired - redirected to login');
              hasMore = false;
              break;
            }
          }

          // Exponential backoff cho 429
          if (res.status === 429) {
            const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10);
            const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(Math.pow(2, page) * 2000, 60000);
            console.warn(`[SocialShield BG] Rate limited (429), waiting ${Math.round(waitMs / 1000)}s`);
            await new Promise(r => setTimeout(r, waitMs));
            continue; // retry same page
          }

          if (!res.ok) {
            console.error(`[SocialShield BG] API error: ${res.status}`);
            if (res.status === 401 || res.status === 403) break; // auth error, stop
            break;
          }

          const contentType = res.headers.get('content-type');
          if (!contentType || !contentType.includes('json')) {
            console.error(`[SocialShield BG] Unexpected response type: ${contentType}`);
            hasMore = false;
            break;
          }

          const data = await res.json();

          if (data.users && data.users.length > 0) {
            for (const u of data.users) {
              const key = String(u.pk || u.pk_id || '');
              if (key && !userMap.has(key)) {
                userMap.set(key, {
                  username: u.username,
                  displayName: u.full_name || '',
                  isVerified: u.is_verified || false,
                  profileUrl: `https://www.instagram.com/${u.username}/`,
                  profilePic: u.profile_pic_url || '',
                  hasAnonymousProfilePic: !!u.has_anonymous_profile_picture,
                  isPrivate: !!u.is_private,
                  latestReelMedia: u.latest_reel_media || 0,
                  userId: key,
                });
              }
            }
          }

          if (data.next_max_id && data.big_list !== false) {
            maxId = data.next_max_id;
          } else {
            hasMore = false;
          }

          if (hasMore) {
            // Inter-page delay: 3-5s with random jitter
            await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
          }
        } catch (err) {
          console.error(`[SocialShield BG] fetchConnections page ${page} error:`, err);
          break;
        }
      }

      console.log(`[SocialShield BG] Attempt ${attempt}: fetched ${userMap.size}/${expectedCount} ${type}`);
      if (expectedCount > 0 && userMap.size >= expectedCount) break;
      if (attempt < MAX_ATTEMPTS && expectedCount > 0 && userMap.size < expectedCount) {
        console.log(`[SocialShield BG] Count mismatch, retrying...`);
      }
    }

    const users = Array.from(userMap.values());
    console.log(`[SocialShield BG] Final ${type} count: ${users.length} (expected: ${expectedCount})`);
    return users;
  }
};

// ==================== Twitter/X API (Background) ====================

const TWITTER_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

const TwitterAPI = {
  async getCookies() {
    const cookies = await chrome.cookies.getAll({ domain: '.x.com' });
    const cookieMap = {};
    for (const c of cookies) {
      cookieMap[c.name] = c.value;
    }
    return cookieMap;
  },

  async getCsrfToken() {
    const cookie = await chrome.cookies.get({ url: 'https://x.com', name: 'ct0' });
    return cookie?.value || '';
  },

  async isLoggedIn() {
    const authToken = await chrome.cookies.get({ url: 'https://x.com', name: 'auth_token' });
    return !!authToken?.value;
  },

  async buildCookieHeader() {
    const cookies = await this.getCookies();
    return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  },

  getHeaders(csrfToken, cookieHeader) {
    return {
      'authorization': `Bearer ${TWITTER_BEARER}`,
      'x-csrf-token': csrfToken,
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Cookie': cookieHeader,
    };
  },

  async fetchUserInfo(screenName) {
    // Cache 15 phút
    const cacheKey = `_cache_tw_user_${screenName}`;
    const TTL = 15 * 60 * 1000;
    try {
      const cached = await SocialShieldStorage.cacheGet(cacheKey, TTL);
      if (cached) {
        console.log(`[SocialShield BG] Cache hit for Twitter @${screenName}`);
        return cached;
      }

      const csrfToken = await this.getCsrfToken();
      const cookieHeader = await this.buildCookieHeader();

      const res = await fetch(
        `https://x.com/i/api/1.1/users/show.json?screen_name=${encodeURIComponent(screenName)}`,
        { headers: this.getHeaders(csrfToken, cookieHeader) }
      );

      if (!res.ok) {
        console.error(`[SocialShield BG] Twitter fetchUserInfo failed: ${res.status}`);
        return null;
      }

      const data = await res.json();
      await SocialShieldStorage.cacheSet(cacheKey, data);
      return data;
    } catch (err) {
      console.error('[SocialShield BG] Twitter fetchUserInfo error:', err);
      return null;
    }
  },

  async fetchConnections(screenName, type, expectedCount = 0) {
    const MAX_ATTEMPTS = 3;
    const userMap = new Map();
    const endpoint = type === 'followers' ? 'followers' : 'friends';

    const csrfToken = await this.getCsrfToken();
    const cookieHeader = await this.buildCookieHeader();
    const headers = this.getHeaders(csrfToken, cookieHeader);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        const backoff = Math.min(Math.pow(2, attempt) * 1000, 30000) + Math.random() * 2000;
        console.log(`[SocialShield BG] Twitter backoff ${Math.round(backoff)}ms before attempt ${attempt}`);
        await new Promise(r => setTimeout(r, backoff));
      }

      let cursor = '-1';
      let page = 0;

      while (cursor !== '0') {
        page++;
        try {
          const url = `https://x.com/i/api/1.1/${endpoint}/list.json?screen_name=${encodeURIComponent(screenName)}&count=200&cursor=${cursor}&skip_status=true&include_user_entities=false`;

          const res = await fetch(url, { headers });

          // Exponential backoff cho 429
          if (res.status === 429) {
            const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10);
            const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(Math.pow(2, page) * 2000, 60000);
            console.warn(`[SocialShield BG] Twitter rate limited (429), waiting ${Math.round(waitMs / 1000)}s`);
            await new Promise(r => setTimeout(r, waitMs));
            continue; // retry same page
          }

          if (!res.ok) {
            console.error(`[SocialShield BG] Twitter API error: ${res.status}`);
            if (res.status === 401 || res.status === 403) break;
            break;
          }

          const contentType = res.headers.get('content-type');
          if (!contentType || !contentType.includes('json')) {
            console.error(`[SocialShield BG] Unexpected response type: ${contentType}`);
            break;
          }

          const data = await res.json();

          if (data.users && data.users.length > 0) {
            for (const u of data.users) {
              const key = String(u.id_str || u.id || '');
              if (key && !userMap.has(key)) {
                userMap.set(key, {
                  username: u.screen_name,
                  displayName: u.name || '',
                  isVerified: u.verified || u.is_blue_verified || false,
                  profileUrl: `https://x.com/${u.screen_name}`,
                  profilePic: u.profile_image_url_https || '',
                  hasAnonymousProfilePic: !!u.default_profile_image,
                  isPrivate: !!u.protected,
                  followersCount: u.followers_count || 0,
                  followingCount: u.friends_count || 0,
                  statusesCount: u.statuses_count || 0,
                  userId: key,
                });
              }
            }
          }

          cursor = data.next_cursor_str || '0';

          if (cursor !== '0') {
            // Inter-page delay: 2.5-4.5s with random jitter
            await new Promise(r => setTimeout(r, 2500 + Math.random() * 2000));
          }
        } catch (err) {
          console.error(`[SocialShield BG] Twitter fetchConnections page ${page} error:`, err);
          break;
        }
      }

      console.log(`[SocialShield BG] Twitter attempt ${attempt}: fetched ${userMap.size}/${expectedCount} ${type}`);
      if (expectedCount > 0 && userMap.size >= expectedCount) break;
    }

    const users = Array.from(userMap.values());
    console.log(`[SocialShield BG] Twitter final ${type} count: ${users.length} (expected: ${expectedCount})`);
    return users;
  }
};

// ==================== Auto Capture ====================

async function runAutoCapture() {
  console.log('[SocialShield] Auto-capture triggered');

  // Kiểm tra login status cho cả hai nền tảng
  const igLoggedIn = await InstagramAPI.isLoggedIn();
  const twLoggedIn = await TwitterAPI.isLoggedIn();
  if (!igLoggedIn && !twLoggedIn) {
    console.log('[SocialShield] Not logged into any platform, skipping auto-capture');
    return;
  }

  // Lấy settings
  const result = await chrome.storage.local.get('settings');
  const settings = result.settings || {};
  if (!settings.autoCapture) {
    console.log('[SocialShield] Auto-capture disabled in settings');
    return;
  }

  // Lấy danh sách profiles đã tracked
  const indexResult = await chrome.storage.local.get('snapshot_index');
  const index = indexResult.snapshot_index || {};

  if (Object.keys(index).length === 0) {
    console.log('[SocialShield] No tracked profiles found');
    return;
  }

  // Group by username để tránh fetch userId nhiều lần
  const profileMap = {};
  for (const [key, info] of Object.entries(index)) {
    const profileKey = `${info.platform}_${info.username}`;
    if (!profileMap[profileKey]) {
      profileMap[profileKey] = { ...info, types: [] };
    }
    profileMap[profileKey].types.push(info.type);
  }

  let capturedCount = 0;

  for (const [, profile] of Object.entries(profileMap)) {
    try {
      // Xác định API phù hợp theo platform
      if (profile.platform === 'twitter') {
        if (!twLoggedIn) continue;
        const twInfo = await TwitterAPI.fetchUserInfo(profile.username);
        if (!twInfo) {
          console.warn(`[SocialShield] Could not get Twitter info for @${profile.username}`);
          continue;
        }

        for (const type of profile.types) {
          console.log(`[SocialShield] Auto-capturing ${type} for @${profile.username} (twitter)...`);
          const expectedCount = type === 'following' ? twInfo.friends_count : twInfo.followers_count;
          const users = await TwitterAPI.fetchConnections(profile.username, type, expectedCount);
          capturedCount += await saveAutoCaptureSnapshot(profile, type, users, settings);
          await new Promise(r => setTimeout(r, 2000));
        }
      } else {
        // Instagram auto-capture (default)
        if (!igLoggedIn) continue;
        const profileInfo = await InstagramAPI.fetchProfileInfo(profile.username);
        if (!profileInfo) {
          console.warn(`[SocialShield] Could not get profile info for @${profile.username}`);
          continue;
        }
        const userId = profileInfo.id;

        for (const type of profile.types) {
          console.log(`[SocialShield] Auto-capturing ${type} for @${profile.username}...`);
          const expectedCount = type === 'following' ? profileInfo.followingCount : profileInfo.followerCount;
          const users = await InstagramAPI.fetchConnections(userId, type, expectedCount);
          capturedCount += await saveAutoCaptureSnapshot(profile, type, users, settings);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    } catch (err) {
      console.error(`[SocialShield] Auto-capture error for @${profile.username}:`, err);
    }
  }

  console.log(`[SocialShield] Auto-capture complete: ${capturedCount} snapshots saved`);
}

/**
 * Lưu snapshot từ auto-capture, so sánh và tạo alerts
 * @returns {number} 1 nếu lưu thành công, 0 nếu không
 */
async function saveAutoCaptureSnapshot(profile, type, users, settings) {
  if (users.length === 0) return 0;

  const snapshot = {
    id: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    platform: profile.platform,
    username: profile.username,
    type,
    data: users,
    count: users.length,
    timestamp: new Date().toISOString(),
    createdAt: Date.now(),
    isAutoCapture: true,
  };

  const storageKey = `snapshots_${profile.platform}_${profile.username}_${type}`;
  const existing = (await chrome.storage.local.get(storageKey))[storageKey] || [];
  existing.push(snapshot);
  await chrome.storage.local.set({ [storageKey]: existing });

  // Cập nhật snapshot_index để dashboard thấy snapshot mới
  const indexResult = await chrome.storage.local.get('snapshot_index');
  const snapshotIndex = indexResult.snapshot_index || {};
  snapshotIndex[storageKey] = {
    platform: profile.platform,
    username: profile.username,
    type,
    lastUpdated: Date.now()
  };
  await chrome.storage.local.set({ snapshot_index: snapshotIndex });

  // Auto-compare với snapshot trước
  if (existing.length >= 2) {
    const prevSnap = existing[existing.length - 2];
    const diffResult = computeDiff(prevSnap, snapshot);

    if (diffResult.addedCount > 0 || diffResult.removedCount > 0) {
      const alerts = (await chrome.storage.local.get('alerts')).alerts || [];

      if (diffResult.addedCount >= (settings.suspiciousThreshold?.massFollow || 20)) {
        alerts.unshift({
          id: `alert_${Date.now()}`,
          type: 'mass_follow',
          severity: 'warning',
          title: 'Mass Follow Detected (Auto)',
          message: `${diffResult.addedCount} new ${type} for @${profile.username}`,
          platform: profile.platform,
          username: profile.username,
          snapshotType: type,
          read: false,
          timestamp: new Date().toISOString(),
        });
      }

      if (diffResult.removedCount >= (settings.suspiciousThreshold?.massUnfollow || 10)) {
        alerts.unshift({
          id: `alert_${Date.now()}_unfollow`,
          type: 'mass_unfollow',
          severity: 'danger',
          title: 'Mass Unfollow Detected (Auto)',
          message: `${diffResult.removedCount} ${type} removed for @${profile.username}`,
          platform: profile.platform,
          username: profile.username,
          snapshotType: type,
          read: false,
          timestamp: new Date().toISOString(),
        });
      }

      if (alerts.length > 100) alerts.length = 100;
      await chrome.storage.local.set({ alerts });

      chrome.notifications.create(`auto-${snapshot.id}`, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: `SocialShield - @${profile.username}`,
        message: `Auto-capture: +${diffResult.addedCount} / -${diffResult.removedCount} ${type}`,
        priority: 1,
      });
    }
  }

  return 1;
}

/**
 * Simple diff computation cho auto-capture (không cần import diff.js)
 */
function computeDiff(oldSnap, newSnap) {
  const getKey = (u) => u.userId ? String(u.userId) : (u.username || '').trim().toLowerCase();
  const oldSet = new Set(oldSnap.data.map(u => getKey(u)));
  const newSet = new Set(newSnap.data.map(u => getKey(u)));

  let addedCount = 0;
  let removedCount = 0;

  for (const u of newSet) {
    if (!oldSet.has(u)) addedCount++;
  }
  for (const u of oldSet) {
    if (!newSet.has(u)) removedCount++;
  }

  return { addedCount, removedCount };
}

// ==================== Installation ====================

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[SocialShield] Extension installed:', details.reason);

  if (details.reason === 'install') {
    chrome.tabs.create({
      url: chrome.runtime.getURL('dashboard/dashboard.html')
    });

    // Default settings với autoCapture
    chrome.storage.local.get('settings', (result) => {
      if (!result.settings) {
        chrome.storage.local.set({
          settings: {
            autoCapture: false,
            captureInterval: 360, // 6 giờ (phút)
            notifications: true,
            suspiciousThreshold: {
              massFollow: 20,
              massUnfollow: 10,
              changeRate: 30,
            }
          }
        });
      }
    });
  }

  // Setup auto-capture alarm
  setupAutoCaptureAlarm();
  setupFootprintMonitorAlarm();
});

async function setupAutoCaptureAlarm() {
  // Xóa alarm cũ
  await chrome.alarms.clear('auto-capture');

  const result = await chrome.storage.local.get('settings');
  const settings = result.settings || {};

  if (settings.autoCapture) {
    const interval = settings.captureInterval || 360; // default 6 giờ
    chrome.alarms.create('auto-capture', {
      delayInMinutes: 1, // Chạy lần đầu sau 1 phút
      periodInMinutes: interval,
    });
    console.log(`[SocialShield] Auto-capture alarm set: every ${interval} minutes`);
  } else {
    console.log('[SocialShield] Auto-capture disabled');
  }
}

// ==================== Footprint Monitor (background) ====================
// Quét username trên N site định kỳ. Khi có account mới xuất hiện trên site
// mà lần trước không có → alert. Hữu ích để phát hiện ai đó tạo account mạo
// danh hoặc service mới user vô tình đăng ký.

async function setupFootprintMonitorAlarm() {
  await chrome.alarms.clear('footprint-monitor');
  const result = await chrome.storage.local.get('settings');
  const settings = result.settings || {};
  if (settings.footprintMonitorEnabled && Array.isArray(settings.footprintMonitorUsernames)
      && settings.footprintMonitorUsernames.length > 0) {
    const interval = settings.footprintMonitorInterval || 1440; // default 1 ngày
    chrome.alarms.create('footprint-monitor', {
      delayInMinutes: 5,
      periodInMinutes: interval,
    });
    console.log(`[SocialShield] Footprint monitor alarm set: every ${interval} minutes`);
  } else {
    console.log('[SocialShield] Footprint monitor disabled');
  }
}

const FOOTPRINT_SITES_BG = [
  { name: 'GitHub',     url: u => `https://api.github.com/users/${u}`,
    existIf: d => d && d.login && !d.message },
  { name: 'GitLab',     url: u => `https://gitlab.com/api/v4/users?username=${u}`,
    existIf: d => Array.isArray(d) && d.length > 0 },
  { name: 'Codeberg',   url: u => `https://codeberg.org/api/v1/users/${u}`,
    existIf: d => d && d.login && !d.message },
  { name: 'DEV.to',     url: u => `https://dev.to/api/users/by_username?url=${u}`,
    existIf: d => d && d.username },
  { name: 'Reddit',     url: u => `https://www.reddit.com/user/${u}/about.json`,
    existIf: d => d?.data?.name && !d.data.is_suspended },
  { name: 'Hacker News',url: u => `https://hacker-news.firebaseio.com/v0/user/${u}.json`,
    existIf: d => d && d.id },
  { name: 'Mastodon',   url: u => `https://mastodon.social/api/v1/accounts/lookup?acct=${u}`,
    existIf: d => d && d.id },
  { name: 'Bluesky',    url: u => `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${u}.bsky.social`,
    existIf: d => d && d.did },
  { name: 'Lichess',    url: u => `https://lichess.org/api/user/${u}`,
    existIf: d => d && d.id && !d.error },
  { name: 'Codeforces', url: u => `https://codeforces.com/profile/${u}`, kind: 'text',
    existIf: text => /class=["'][^"']*userbox|data-handle=|<title>[^<]*\b\S+\s+-\s+Codeforces/i.test(text) },
];

async function probeFootprintBG(username) {
  const results = await Promise.all(FOOTPRINT_SITES_BG.map(async site => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const isText = site.kind === 'text';
      const res = await fetch(site.url(username), {
        signal: ctrl.signal,
        headers: { 'Accept': isText ? 'text/html,*/*' : 'application/json' }
      });
      clearTimeout(t);
      if ([401, 403, 404, 410, 429, 451].includes(res.status)) return { site: site.name, exists: false };
      if (!res.ok) return { site: site.name, exists: false };
      const parsed = isText ? await res.text().catch(() => '') : await res.json().catch(() => null);
      return { site: site.name, exists: !!site.existIf(parsed) };
    } catch {
      return { site: site.name, exists: false };
    }
  }));
  return results.reduce((acc, r) => { acc[r.site] = r.exists; return acc; }, {});
}

async function runFootprintMonitor() {
  const result = await chrome.storage.local.get(['settings']);
  const settings = result.settings || {};
  const usernames = settings.footprintMonitorUsernames || [];
  if (usernames.length === 0) return;

  for (const username of usernames) {
    try {
      const current = await probeFootprintBG(username);
      const prevKey = `footprint_baseline_${username}`;
      const prev = (await chrome.storage.local.get(prevKey))[prevKey];

      // Lần đầu chạy → chỉ baseline, không alert
      if (!prev) {
        await chrome.storage.local.set({ [prevKey]: { snapshot: current, ts: Date.now() } });
        continue;
      }

      // So sánh: site nào xuất hiện mới?
      const newSites = [];
      for (const [site, exists] of Object.entries(current)) {
        if (exists && !prev.snapshot[site]) newSites.push(site);
      }

      if (newSites.length > 0) {
        // Lưu alert
        await SocialShieldStorage.saveAlert({
          type: 'footprint_new_account',
          severity: 'high',
          title: 'New account(s) detected with your username',
          message: `Username "${username}" vừa xuất hiện trên: ${newSites.join(', ')}. Có thể là bạn tạo account mới — hoặc ai đó đang impersonate.`,
          platform: 'footprint',
          username,
        });

        if (settings.notifications !== false && self.chrome?.notifications) {
          try {
            chrome.notifications.create({
              type: 'basic',
              iconUrl: chrome.runtime.getURL('icons/icon128.png'),
              title: 'SocialShield — New footprint detected',
              message: `"${username}" appeared on ${newSites.join(', ')}`,
              priority: 2,
            });
          } catch { /* ignore */ }
        }
      }

      // Update baseline
      await chrome.storage.local.set({ [prevKey]: { snapshot: current, ts: Date.now() } });
    } catch (err) {
      console.error('[SocialShield] Footprint monitor error for', username, err);
    }
  }
}

// ==================== Cross-Profile pHash Diff (Impersonation/Reuse Detection) ====================

function _hashDist(h1, h2) {
  if (!h1 || !h2 || h1.length !== h2.length) return -1;
  let d = 0;
  for (let i = 0; i < h1.length; i++) if (h1[i] !== h2[i]) d++;
  return d;
}

/**
 * So sánh profile pic pHash giữa tất cả profile đã track.
 * Pair (platformA, userA) vs (platformB, userB) coi là match nếu:
 *   - pHash distance <= 10 (perceptually similar)
 *   - cùng platform + khác username → IMPERSONATION strong signal
 *   - khác platform → có thể là cross-platform reuse (không phải lo, nhưng vẫn note)
 *
 * Alert được de-dupe theo pair key trong storage.
 */
async function runCrossProfilePHashScan() {
  try {
    const all = await chrome.storage.local.get(null);
    const profiles = [];
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith('profile_')) continue;
      if (!Array.isArray(value) || value.length === 0) continue;
      const parts = key.split('_'); // profile_<platform>_<username>
      if (parts.length < 3) continue;
      const platform = parts[1];
      const username = parts.slice(2).join('_');
      const latest = value[value.length - 1];
      if (!latest || !latest.profilePicPHash) continue;
      profiles.push({ platform, username, pHash: latest.profilePicPHash, profilePicUrl: latest.profilePicUrl });
    }

    if (profiles.length < 2) return { compared: 0, matches: [] };

    const seenKey = 'phash_diff_seen_pairs';
    const seen = (await chrome.storage.local.get(seenKey))[seenKey] || {};
    const matches = [];

    for (let i = 0; i < profiles.length; i++) {
      for (let j = i + 1; j < profiles.length; j++) {
        const a = profiles[i], b = profiles[j];
        // Skip same profile (cùng platform + cùng username)
        if (a.platform === b.platform && a.username === b.username) continue;

        const dist = _hashDist(a.pHash, b.pHash);
        if (dist < 0 || dist > 10) continue;

        const sameUsername = a.username.toLowerCase() === b.username.toLowerCase();
        const samePlatform = a.platform === b.platform;
        let severity = 'low';
        let label = '';

        if (samePlatform && !sameUsername) {
          severity = 'high';
          label = `Possible impersonation: 2 ${a.platform} accounts dùng cùng/giống profile pic`;
        } else if (!samePlatform && sameUsername) {
          severity = 'low';
          label = `Cross-platform reuse: cùng username + cùng profile pic (likely you)`;
        } else if (!samePlatform && !sameUsername) {
          severity = 'medium';
          label = `Khác platform + khác username nhưng giống profile pic → đáng nghi`;
        } else continue;

        const pairKey = [a.platform + ':' + a.username, b.platform + ':' + b.username].sort().join('|');
        const match = {
          pairKey, severity, label, distance: dist,
          a: { platform: a.platform, username: a.username },
          b: { platform: b.platform, username: b.username },
          detectedAt: new Date().toISOString(),
        };
        matches.push(match);

        if (!seen[pairKey] && severity !== 'low') {
          // Raise alert
          if (typeof SocialShieldStorage !== 'undefined') {
            try {
              await SocialShieldStorage.saveAlert({
                type: 'cross_profile_phash_match',
                severity,
                title: severity === 'high'
                  ? '⚠ Possible impersonation detected'
                  : 'Suspicious profile-pic similarity',
                message: `${label}. ${a.platform}/@${a.username} ↔ ${b.platform}/@${b.username} (pHash distance ${dist}/64).`,
                platform: a.platform,
                username: a.username,
                metadata: match,
              });
            } catch (err) { /* ignore */ }
          }

          if (chrome.notifications && severity === 'high') {
            try {
              chrome.notifications.create({
                type: 'basic',
                iconUrl: chrome.runtime.getURL('icons/icon128.png'),
                title: 'SocialShield — Possible impersonation',
                message: `${a.platform}/@${a.username} & ${b.platform}/@${b.username} share same profile pic`,
                priority: 2,
              });
            } catch {}
          }
          seen[pairKey] = match.detectedAt;
        }
      }
    }

    await chrome.storage.local.set({ [seenKey]: seen });
    return { compared: (profiles.length * (profiles.length - 1)) / 2, matches };
  } catch (err) {
    console.error('[SocialShield] Cross-profile pHash scan error:', err);
    return { error: err.message };
  }
}

// ==================== Message Handling ====================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'SNAPSHOT_SAVED':
      handleSnapshotSaved(message.data);
      break;

    case 'PRIVACY_SCAN_COMPLETE':
      handlePrivacyScanComplete(message.data);
      // Sau mỗi privacy scan, profile snapshot mới đã được lưu → check ngay
      // cross-profile pHash để bắt impersonation kịp thời.
      runCrossProfilePHashScan().catch(() => {});
      break;

    case 'RUN_CROSS_PROFILE_PHASH_SCAN':
      runCrossProfilePHashScan().then(result => sendResponse(result || { matches: [] }));
      return true;

    case 'APPS_PARSED':
      // Just relay/log — content script đã lưu vào storage; có thể raise alert
      // nếu apps count tăng đột biến vs lần trước (TODO).
      break;

    case 'LINK_SCAN_COMPLETE':
      handleLinkScanComplete(message.data);
      break;

    case 'URL_CHANGED':
      updateBadge(sender.tab?.id, message.data);
      break;

    case 'GET_TAB_INFO':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        sendResponse(tabs[0] || null);
      });
      return true;

    case 'FETCH_PROFILE_INFO':
      InstagramAPI.fetchProfileInfo(message.username).then(info => {
        sendResponse(info);
      }).catch(err => {
        console.error('[SocialShield] FETCH_PROFILE_INFO error:', err);
        sendResponse(null);
      });
      return true;

    case 'FETCH_TWITTER_USER_INFO':
      TwitterAPI.fetchUserInfo(message.screenName).then(info => {
        sendResponse(info);
      }).catch(err => {
        console.error('[SocialShield] FETCH_TWITTER_USER_INFO error:', err);
        sendResponse(null);
      });
      return true;

    case 'ANALYZE_TEXT_AI':
      (async () => {
        try {
          const result = await chrome.storage.local.get('settings');
          const settings = result.settings || {};
          if (!settings.aiAnalysisEnabled || !settings.aiAnalysisUrl) {
            sendResponse({ available: false });
            return;
          }
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 12000);
          const res = await fetch(`${settings.aiAnalysisUrl}/analyze-text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: message.text, context: message.context || '' }),
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (!res.ok) {
            sendResponse({ available: false, error: `HTTP ${res.status}` });
            return;
          }
          const data = await res.json();
          sendResponse(data);
        } catch (err) {
          console.error('[SocialShield] ANALYZE_TEXT_AI error:', err);
          sendResponse({ available: false, error: err.message });
        }
      })();
      return true;

    case 'CHECK_EMAIL_BREACH':
      (async () => {
        const email = message.email;
        if (!email) { sendResponse(null); return; }
        try {
          // 1. XposedOrNot (free, no API key)
          let result = null;
          try {
            const xonRes = await fetch(
              `https://api.xposedornot.com/v1/check-email/${encodeURIComponent(email)}`,
              { headers: { 'User-Agent': 'SocialShield-Extension' } }
            );
            if (xonRes.status === 404 || xonRes.status === 204) {
              result = { breached: false, breachCount: 0, breaches: [], source: 'XposedOrNot' };
            } else if (xonRes.ok) {
              const data = await xonRes.json();
              if (data.Error) {
                result = { breached: false, breachCount: 0, breaches: [], source: 'XposedOrNot' };
              } else {
                const list = data.breaches || [];
                result = list.length > 0
                  ? { breached: true, breachCount: list.length, breaches: list.slice(0, 20), source: 'XposedOrNot' }
                  : { breached: false, breachCount: 0, breaches: [], source: 'XposedOrNot' };
              }
            }
          } catch { /* fallthrough */ }

          // 2. HackCheck fallback
          if (!result) {
            try {
              const hcRes = await fetch(
                `https://hackcheck.woventeams.com/api/v4/breachedaccount/${encodeURIComponent(email)}`,
                { headers: { 'User-Agent': 'SocialShield-Extension' } }
              );
              if (hcRes.status === 404) {
                result = { breached: false, breachCount: 0, breaches: [], source: 'HackCheck' };
              } else if (hcRes.ok) {
                const breaches = await hcRes.json();
                result = Array.isArray(breaches) && breaches.length > 0
                  ? { breached: true, breachCount: breaches.length, breaches: breaches.slice(0, 20).map(b => b.Name || b.Title || 'Unknown'), source: 'HackCheck' }
                  : { breached: false, breachCount: 0, breaches: [], source: 'HackCheck' };
              }
            } catch { /* fallthrough */ }
          }

          sendResponse(result || { breached: false, breachCount: 0, breaches: [], source: 'none' });
        } catch (err) {
          console.error('[SocialShield] CHECK_EMAIL_BREACH error:', err);
          sendResponse(null);
        }
      })();
      return true;

    case 'CHECK_PASSWORD_PWNED':
      (async () => {
        const password = message.password;
        if (!password || password.length < 4) { sendResponse({ pwned: false, count: 0 }); return; }
        try {
          const encoder = new TextEncoder();
          const data = encoder.encode(password);
          const hashBuffer = await crypto.subtle.digest('SHA-1', data);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
          const prefix = hashHex.substring(0, 5);
          const suffix = hashHex.substring(5);

          const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
            headers: { 'Add-Padding': 'true' }
          });
          if (!res.ok) { sendResponse({ pwned: false, count: 0 }); return; }

          const text = await res.text();
          for (const line of text.split('\n')) {
            const [hs, count] = line.trim().split(':');
            if (hs === suffix) {
              sendResponse({ pwned: true, count: parseInt(count, 10) || 0 });
              return;
            }
          }
          sendResponse({ pwned: false, count: 0 });
        } catch (err) {
          console.error('[SocialShield] CHECK_PASSWORD_PWNED error:', err);
          sendResponse({ pwned: false, count: 0 });
        }
      })();
      return true;

    case 'UPDATE_AUTO_CAPTURE':
      setupAutoCaptureAlarm().then(() => {
        sendResponse({ ok: true });
      }).catch(err => {
        console.error('[SocialShield] UPDATE_AUTO_CAPTURE error:', err);
        sendResponse({ ok: false });
      });
      return true;

    case 'UPDATE_FOOTPRINT_MONITOR':
      setupFootprintMonitorAlarm().then(() => {
        sendResponse({ ok: true });
      }).catch(err => {
        console.error('[SocialShield] UPDATE_FOOTPRINT_MONITOR error:', err);
        sendResponse({ ok: false });
      });
      return true;

    case 'RUN_FOOTPRINT_MONITOR_NOW':
      runFootprintMonitor().then(() => {
        sendResponse({ ok: true });
      }).catch(err => {
        console.error('[SocialShield] RUN_FOOTPRINT_MONITOR_NOW error:', err);
        sendResponse({ ok: false, error: err.message });
      });
      return true;

    case 'RUN_AUTO_CAPTURE_NOW':
      runAutoCapture().then(() => {
        sendResponse({ ok: true });
      }).catch(err => {
        console.error('[SocialShield] RUN_AUTO_CAPTURE_NOW error:', err);
        sendResponse({ ok: false, error: err.message });
      });
      return true;
  }
});

// ==================== Event Handlers ====================

function handleSnapshotSaved(snapshot) {
  if (!snapshot) return;

  chrome.notifications.create(`snapshot-${snapshot.id}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'SocialShield - Snapshot Saved',
    message: `Captured ${snapshot.count} ${snapshot.type} for @${snapshot.username}`,
    priority: 1
  });

  chrome.action.setBadgeText({ text: String(snapshot.count) });
  chrome.action.setBadgeBackgroundColor({ color: '#00d4aa' });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
  }, 5000);
}

function handlePrivacyScanComplete(analysis) {
  if (!analysis) return;
  const count = analysis.privacyFindings?.length || 0;
  if (count > 0) {
    chrome.notifications.create(`privacy-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'SocialShield - Privacy Alert',
      message: `Found ${count} privacy risk(s) - Risk level: ${analysis.riskLevel?.toUpperCase()}`,
      priority: 2
    });
  }
}

function handleLinkScanComplete(data) {
  if (!data) return;
  if (data.unsafe > 0) {
    chrome.notifications.create(`links-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'SocialShield - Unsafe Links',
      message: `Found ${data.unsafe} unsafe link(s) out of ${data.total} scanned`,
      priority: 2
    });
  }
}

function updateBadge(tabId, data) {
  if (!tabId) return;
  if (data?.isProfilePage) {
    chrome.action.setBadgeText({ text: '', tabId });
  }
}

// ==================== Alarms ====================

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'auto-capture') {
    await runAutoCapture();
  } else if (alarm.name === 'footprint-monitor') {
    await runFootprintMonitor();
    // Piggyback: cross-profile pHash diff sau mỗi run footprint monitor
    await runCrossProfilePHashScan();
  }
});

// ==================== Tab Events ====================

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && (
    tab.url?.includes('instagram.com') ||
    tab.url?.includes('x.com') ||
    tab.url?.includes('twitter.com')
  )) {
    chrome.action.setBadgeText({ text: '', tabId });
  }
});