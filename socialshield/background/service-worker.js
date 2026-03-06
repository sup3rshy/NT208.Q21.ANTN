/**
 * SocialShield Background Service Worker
 * Xử lý logic nền: auto-capture, notifications, Instagram API calls
 */

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

  /**
   * Lấy User ID từ username
   */
  async fetchUserId(username) {
    try {
      const csrfToken = await this.getCsrfToken();
      const cookieHeader = await this.buildCookieHeader();

      const res = await fetch(
        `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
        {
          headers: {
            'x-csrftoken': csrfToken,
            'x-ig-app-id': '936619743392459',
            'x-requested-with': 'XMLHttpRequest',
            'Cookie': cookieHeader,
          },
        }
      );

      if (!res.ok) {
        console.error(`[SocialShield BG] fetchUserId failed: ${res.status}`);
        return null;
      }

      const data = await res.json();
      return data?.data?.user?.id || null;
    } catch (err) {
      console.error('[SocialShield BG] fetchUserId error:', err);
      return null;
    }
  },

  /**
   * Lấy profile info (follower count, following count, etc.)
   */
  async fetchProfileInfo(username) {
    try {
      const csrfToken = await this.getCsrfToken();
      const cookieHeader = await this.buildCookieHeader();

      const res = await fetch(
        `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
        {
          headers: {
            'x-csrftoken': csrfToken,
            'x-ig-app-id': '936619743392459',
            'x-requested-with': 'XMLHttpRequest',
            'Cookie': cookieHeader,
          },
        }
      );

      if (!res.ok) return null;

      const data = await res.json();
      const user = data?.data?.user;
      if (!user) return null;

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
    const isFollowers = type === 'followers';
    const perPage = isFollowers ? 25 : 200;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        await new Promise(r => setTimeout(r, 1500 + Math.random() * 500));
      }

      let maxId = null;
      let hasMore = true;
      let page = 0;

      while (hasMore) {
        page++;
        try {
          // Cả followers và following đều dùng cursor-based (next_max_id từ response)
          let url;
          if (isFollowers) {
            url = `https://www.instagram.com/api/v1/friendships/${userId}/followers/?count=${perPage}&search_surface=follow_list_page`;
          } else {
            url = `https://www.instagram.com/api/v1/friendships/${userId}/following/?count=${perPage}`;
          }
          if (maxId) {
            url += `&max_id=${maxId}`;
          }

          const res = await fetch(url, {
            headers: {
              'x-csrftoken': csrfToken,
              'x-ig-app-id': '936619743392459',
              'x-requested-with': 'XMLHttpRequest',
              'Cookie': cookieHeader,
            },
          });

          // Phát hiện redirect đến login/challenge page
          if (res.redirected) {
            console.warn(`[SocialShield BG] Redirected to: ${res.url}`);
            if (res.url.includes('/accounts/login') || res.url.includes('/challenge')) {
              console.error('[SocialShield BG] Session expired - redirected to login');
              hasMore = false;
              break;
            }
          }

          if (!res.ok) {
            console.error(`[SocialShield BG] API error: ${res.status}`);
            break;
          }

          // Kiểm tra response có phải JSON không
          const contentType = res.headers.get('content-type');
          if (!contentType || !contentType.includes('json')) {
            console.error(`[SocialShield BG] Unexpected response type: ${contentType}`);
            hasMore = false;
            break;
          }

          const data = await res.json();

          if (data.users && data.users.length > 0) {
            for (const u of data.users) {
              // Dedup theo userId (pk) thay vì username
              const key = String(u.pk || u.pk_id || '');
              if (key && !userMap.has(key)) {
                userMap.set(key, {
                  username: u.username,
                  displayName: u.full_name || '',
                  isVerified: u.is_verified || false,
                  profileUrl: `https://www.instagram.com/${u.username}/`,
                  profilePic: u.profile_pic_url || '',
                  userId: key,
                });
              }
            }
          }

          // Cursor-based: dừng khi không còn next_max_id hoặc big_list = false
          if (data.next_max_id && data.big_list !== false) {
            maxId = data.next_max_id;
          } else {
            hasMore = false;
          }

          if (hasMore) {
            await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
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

// ==================== Auto Capture ====================

async function runAutoCapture() {
  console.log('[SocialShield] Auto-capture triggered');

  // Kiểm tra đã login chưa
  const loggedIn = await InstagramAPI.isLoggedIn();
  if (!loggedIn) {
    console.log('[SocialShield] Not logged into Instagram, skipping auto-capture');
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

        if (users.length > 0) {
          // Lưu snapshot - replicate SocialShieldStorage.saveSnapshot logic
          const snapshot = {
            id: `snap_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
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

          // Auto-compare với snapshot trước
          if (existing.length >= 2) {
            const prevSnap = existing[existing.length - 2];
            const diffResult = computeDiff(prevSnap, snapshot);

            if (diffResult.addedCount > 0 || diffResult.removedCount > 0) {
              // Lưu alert nếu có thay đổi đáng kể
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

              // Notification
              chrome.notifications.create(`auto-${snapshot.id}`, {
                type: 'basic',
                iconUrl: 'icons/icon128.png',
                title: `SocialShield - @${profile.username}`,
                message: `Auto-capture: +${diffResult.addedCount} / -${diffResult.removedCount} ${type}`,
                priority: 1,
              });
            }
          }

          capturedCount++;
        }

        // Delay giữa các captures
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (err) {
      console.error(`[SocialShield] Auto-capture error for @${profile.username}:`, err);
    }
  }

  console.log(`[SocialShield] Auto-capture complete: ${capturedCount} snapshots saved`);
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

// ==================== Message Handling ====================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'SNAPSHOT_SAVED':
      handleSnapshotSaved(message.data);
      break;

    case 'PRIVACY_SCAN_COMPLETE':
      handlePrivacyScanComplete(message.data);
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

    case 'UPDATE_AUTO_CAPTURE':
      setupAutoCaptureAlarm().then(() => {
        sendResponse({ ok: true });
      }).catch(err => {
        console.error('[SocialShield] UPDATE_AUTO_CAPTURE error:', err);
        sendResponse({ ok: false });
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
  }
});

// ==================== Tab Events ====================

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('instagram.com')) {
    chrome.action.setBadgeText({ text: '', tabId });
  }
});
