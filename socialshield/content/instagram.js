/**
 * SocialShield - Instagram Content Script
 * Chạy trên instagram.com, cung cấp chức năng:
 * - Capture following/followers list
 * - Privacy scanning
 * - Link checking
 */
(function () {
  'use strict';

  // Tránh inject nhiều lần
  if (window.__socialshield_loaded) return;
  window.__socialshield_loaded = true;

  const SS_Instagram = {
    isCapturing: false,
    capturedUsers: [],
    captureType: null,
    captureProfile: null,
    fabElement: null,
    progressElement: null,
    notificationTimeout: null,

    // ==================== Context Check ====================

    /**
     * Kiểm tra extension context còn hợp lệ không.
     * Sau khi reload extension, content script cũ bị mất kết nối.
     */
    isContextValid() {
      try {
        return !!chrome.runtime?.id;
      } catch {
        return false;
      }
    },

    /**
     * Hiện thông báo yêu cầu refresh page khi context bị invalidated
     */
    showRefreshNotice() {
      // Xóa FAB cũ
      const fab = document.getElementById('ss-fab');
      if (fab) fab.remove();
      const progress = document.getElementById('ss-progress');
      if (progress) progress.remove();

      // Hiện notice
      const notice = document.createElement('div');
      notice.id = 'ss-refresh-notice';
      notice.style.cssText = `
        position: fixed; bottom: 24px; right: 24px; z-index: 999999;
        background: #1a1a2e; border: 1px solid #ef4444; border-radius: 12px;
        padding: 16px 20px; max-width: 320px; font-family: -apple-system, sans-serif;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      `;
      notice.innerHTML = `
        <div style="color: #ef4444; font-weight: 600; margin-bottom: 8px;">SocialShield - Extension Reloaded</div>
        <div style="color: #ccc; font-size: 13px; margin-bottom: 12px;">
          Extension was updated/reloaded. Please refresh this page to reconnect.
        </div>
        <button style="
          background: #ef4444; color: white; border: none; border-radius: 6px;
          padding: 8px 16px; cursor: pointer; font-size: 13px; font-weight: 500;
        " onclick="location.reload()">Refresh Page</button>
      `;
      document.body.appendChild(notice);
    },

    // ==================== Initialization ====================

    init() {
      if (!this.isContextValid()) {
        this.showRefreshNotice();
        return;
      }
      this.injectFAB();
      this.injectNotificationArea();
      this.listenForMessages();
      this.observeUrlChanges();
      console.log('[SocialShield] Instagram content script loaded');
    },

    // ==================== UI Injection ====================

    injectFAB() {
      if (document.getElementById('ss-fab')) return;

      const fab = document.createElement('div');
      fab.id = 'ss-fab';
      fab.innerHTML = `
        <button class="ss-fab-button" id="ss-fab-toggle" title="SocialShield">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L3 7V17L12 22L21 17V7L12 2Z" stroke="currentColor" stroke-width="2" fill="none"/>
            <path d="M12 8V12M12 16H12.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
        <div class="ss-fab-menu" id="ss-fab-menu">
          <div class="ss-fab-menu-header">SocialShield</div>
          <button class="ss-fab-action" data-action="capture-following">
            <span class="ss-fab-action-icon">📸</span>
            <span>Capture Following</span>
          </button>
          <button class="ss-fab-action" data-action="capture-followers">
            <span class="ss-fab-action-icon">📸</span>
            <span>Capture Followers</span>
          </button>
          <div class="ss-fab-divider"></div>
          <button class="ss-fab-action" data-action="scan-privacy">
            <span class="ss-fab-action-icon">🔍</span>
            <span>Privacy Scan</span>
          </button>
          <button class="ss-fab-action" data-action="scan-links">
            <span class="ss-fab-action-icon">🔗</span>
            <span>Check Links</span>
          </button>
        </div>
      `;
      document.body.appendChild(fab);
      this.fabElement = fab;

      // Toggle menu
      document.getElementById('ss-fab-toggle').addEventListener('click', () => {
        const menu = document.getElementById('ss-fab-menu');
        menu.classList.toggle('ss-show');
      });

      // Action handlers
      fab.querySelectorAll('.ss-fab-action').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const action = e.currentTarget.dataset.action;
          document.getElementById('ss-fab-menu').classList.remove('ss-show');
          this.handleAction(action);
        });
      });

      // Close menu khi click bên ngoài
      document.addEventListener('click', (e) => {
        if (!fab.contains(e.target)) {
          document.getElementById('ss-fab-menu').classList.remove('ss-show');
        }
      });
    },

    injectNotificationArea() {
      if (document.getElementById('ss-notifications')) return;
      const area = document.createElement('div');
      area.id = 'ss-notifications';
      document.body.appendChild(area);
    },

    // ==================== Action Handlers ====================

    async handleAction(action) {
      if (!this.isContextValid()) {
        this.showRefreshNotice();
        return;
      }
      const profile = this.getCurrentProfile();

      switch (action) {
        case 'capture-following':
          if (!profile) return this.notify('Navigate to a profile page first!', 'error');
          await this.startCapture(profile, 'following');
          break;

        case 'capture-followers':
          if (!profile) return this.notify('Navigate to a profile page first!', 'error');
          await this.startCapture(profile, 'followers');
          break;

        case 'scan-privacy':
          await this.runPrivacyScan();
          break;

        case 'scan-links':
          await this.runLinkScan();
          break;
      }
    },

    // ==================== Capture Logic ====================

    async startCapture(profile, type) {
      if (!this.isContextValid()) {
        this.showRefreshNotice();
        return;
      }

      if (this.isCapturing) {
        return this.notify('A capture is already in progress!', 'warning');
      }

      this.isCapturing = true;
      this.capturedUsers = [];
      this.captureType = type;
      this.captureProfile = profile;

      this.notify(`Starting ${type} capture for @${profile}...`, 'info');
      this.showProgress(`Capturing ${type}...`, 0);

      try {
        // Bước 1: Lấy User ID từ API
        this.updateProgress('Fetching user info...');
        const userId = await this.fetchUserId(profile);
        if (!userId) {
          this.notify(`Could not find user ID for @${profile}. Make sure you're logged in.`, 'error');
          this.isCapturing = false;
          this.hideProgress();
          return;
        }
        console.log(`[SocialShield] User ID for @${profile}: ${userId}`);

        // Bước 2: Fetch following/followers qua API (có pagination)
        this.updateProgress(`Fetching ${type} via API...`);
        const users = await this.fetchConnectionsAPI(userId, type);

        this.capturedUsers = users;

        // Bước 3: Lưu snapshot
        if (this.capturedUsers.length > 0) {
          const snapshot = await SocialShieldStorage.saveSnapshot(
            'instagram',
            profile,
            type,
            this.capturedUsers
          );

          this.notify(
            `Captured ${this.capturedUsers.length} ${type} for @${profile}`,
            'success'
          );

          chrome.runtime.sendMessage({
            type: 'SNAPSHOT_SAVED',
            data: snapshot
          });

          await this.autoCompare(profile, type, snapshot);
        } else {
          this.notify('No users captured. The list might be empty or private.', 'warning');
        }

      } catch (err) {
        console.error('[SocialShield] Capture error:', err);
        // Kiểm tra nếu context bị invalidated giữa chừng
        if (!this.isContextValid() || (err.message && err.message.includes('context invalidated'))) {
          this.showRefreshNotice();
          return;
        }
        this.notify(`Error during capture: ${err.message}`, 'error');
      } finally {
        this.isCapturing = false;
        this.hideProgress();
      }
    },

    // ==================== Instagram API Methods ====================

    /**
     * Lấy CSRF token từ cookie (cần cho API requests)
     */
    getCsrfToken() {
      const match = document.cookie.match(/csrftoken=([^;]+)/);
      return match ? match[1] : '';
    },

    /**
     * Lấy User ID từ username qua API
     */
    async fetchUserId(username) {
      try {
        const res = await fetch(
          `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
          {
            headers: {
              'x-csrftoken': this.getCsrfToken(),
              'x-ig-app-id': '936619743392459',
              'x-requested-with': 'XMLHttpRequest',
            },
            credentials: 'include',
          }
        );

        if (!res.ok) {
          console.error(`[SocialShield] Failed to fetch user ID: ${res.status}`);
          return null;
        }

        const data = await res.json();
        return data?.data?.user?.id || null;
      } catch (err) {
        console.error('[SocialShield] fetchUserId error:', err);
        return null;
      }
    },

    /**
     * Fetch following/followers list qua Instagram API với pagination + verification
     * Retry nếu count chưa khớp expected count từ profile info
     */
    async fetchConnectionsAPI(userId, type) {
      // Lấy expected count từ profile info trước
      let expectedCount = 0;
      try {
        const profileInfo = await chrome.runtime.sendMessage({
          type: 'FETCH_PROFILE_INFO',
          username: this.captureProfile
        });
        if (profileInfo) {
          expectedCount = type === 'following' ? profileInfo.followingCount : profileInfo.followerCount;
          console.log(`[SocialShield] Expected ${type} count: ${expectedCount}`);
        }
      } catch (err) {
        console.warn('[SocialShield] Could not get expected count:', err);
      }

      const MAX_ATTEMPTS = 5;
      // Map username → user object để merge kết quả giữa các attempts
      const userMap = new Map();
      const isFollowers = type === 'followers';
      const perPage = isFollowers ? 25 : 200;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS && this.isCapturing; attempt++) {
        if (attempt > 1) {
          this.updateProgress(`Verifying ${type}... attempt ${attempt}/${MAX_ATTEMPTS} (${userMap.size} users)`);
          await this.wait(4500 + Math.random() * 500);
        }

        let maxId = null;
        let hasMore = true;
        let page = 0;

        while (hasMore && this.isCapturing) {
          page++;
          this.updateProgress(
            attempt === 1
              ? `Fetching ${type}... page ${page} (${userMap.size} users)`
              : `Verifying ${type}... attempt ${attempt} page ${page} (${userMap.size} users)`
          );

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
                'x-csrftoken': this.getCsrfToken(),
                'x-ig-app-id': '936619743392459',
                'x-requested-with': 'XMLHttpRequest',
              },
              credentials: 'include',
            });

            // Phát hiện redirect đến login/challenge page
            if (res.redirected) {
              console.warn(`[SocialShield] Redirected to: ${res.url}`);
              if (res.url.includes('/accounts/login') || res.url.includes('/challenge')) {
                this.notify('Session expired. Please refresh the page and try again.', 'error');
                hasMore = false;
                break;
              }
            }

            if (!res.ok) {
              console.error(`[SocialShield] API error: ${res.status}`);
              if (res.status === 401 || res.status === 403) {
                this.notify('Authentication error. Please make sure you are logged into Instagram.', 'error');
              }
              break;
            }

            // Kiểm tra response có phải JSON không (tránh parse HTML từ redirect)
            const contentType = res.headers.get('content-type');
            if (!contentType || !contentType.includes('json')) {
              console.error(`[SocialShield] Unexpected response type: ${contentType}`);
              this.notify('Instagram returned unexpected response. Please refresh and try again.', 'error');
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
              await this.wait(4000 + Math.random() * 1000);
            }
          } catch (err) {
            console.error(`[SocialShield] fetchConnectionsAPI error on page ${page}:`, err);
            break;
          }
        }

        // Kiểm tra count đã khớp expected chưa
        console.log(`[SocialShield] Attempt ${attempt}: fetched ${userMap.size}/${expectedCount} ${type}`);
        if (expectedCount > 0 && userMap.size >= expectedCount) {
          console.log(`[SocialShield] Count verified: ${userMap.size} >= ${expectedCount}`);
          break;
        }
        if (attempt < MAX_ATTEMPTS && expectedCount > 0 && userMap.size < expectedCount) {
          console.log(`[SocialShield] Count mismatch (${userMap.size} < ${expectedCount}), retrying...`);
        }
      }

      const users = Array.from(userMap.values());
      console.log(`[SocialShield] Final ${type} count: ${users.length} (expected: ${expectedCount})`);
      return users;
    },

    async autoCompare(profile, type, newSnapshot) {
      const snapshots = await SocialShieldStorage.getSnapshots('instagram', profile, type);
      if (snapshots.length < 2) return;

      const prevSnapshot = snapshots[snapshots.length - 2];
      const diff = SocialShieldDiff.compare(prevSnapshot, newSnapshot);
      const alerts = SocialShieldDiff.detectSuspicious(diff);

      if (alerts.length > 0) {
        for (const alert of alerts) {
          await SocialShieldStorage.saveAlert({
            ...alert,
            platform: 'instagram',
            username: profile,
            snapshotType: type
          });
        }
        this.notify(
          `${alerts.length} suspicious activity alert(s) detected! Check dashboard for details.`,
          'warning'
        );
      }

      // Hiện quick diff summary
      if (diff.summary.addedCount > 0 || diff.summary.removedCount > 0) {
        const parts = [];
        if (diff.summary.addedCount > 0) parts.push(`+${diff.summary.addedCount} new`);
        if (diff.summary.removedCount > 0) parts.push(`-${diff.summary.removedCount} removed`);
        this.notify(`Changes since last capture: ${parts.join(', ')}`, 'info');
      }
    },

    // ==================== Privacy Scan ====================

    async runPrivacyScan() {
      const profile = this.getCurrentProfile();
      this.notify('Scanning profile for privacy risks...', 'info');

      // Thu thập text từ trang profile
      const bioSection = document.querySelector('header section') ||
        document.querySelector('[class*="Header"]') ||
        document.querySelector('main header');

      let bioText = '';
      if (bioSection) {
        bioText = bioSection.innerText || bioSection.textContent || '';
      }

      // Fallback: lấy tất cả text trong main area
      if (!bioText) {
        const main = document.querySelector('main') || document.body;
        bioText = main.innerText.substring(0, 5000);
      }

      const findings = SocialShieldScanner.scanPrivacy(bioText);

      // Thu thập thêm thông tin profile cho phân tích tổng hợp
      const profileData = await this.extractProfileData();
      const analysis = SocialShieldScanner.analyzeProfile({
        bio: bioText,
        externalUrl: profileData.externalUrl,
        isPrivate: profileData.isPrivate,
        followerCount: profileData.followerCount,
        followingCount: profileData.followingCount,
        postCount: profileData.postCount
      });

      // Lưu kết quả
      if (profile) {
        await SocialShieldStorage.savePrivacyScan('instagram', profile, analysis.privacyFindings);
      }

      // Hiển thị kết quả
      if (analysis.privacyFindings.length === 0) {
        this.notify('No privacy risks detected on this profile.', 'success');
      } else {
        const count = analysis.privacyFindings.length;
        const severity = analysis.riskLevel;
        this.notify(
          `Found ${count} privacy issue(s) - Risk: ${severity.toUpperCase()}. Open dashboard for details.`,
          severity === 'low' ? 'warning' : 'error'
        );
      }

      // Gửi kết quả đến popup/background
      chrome.runtime.sendMessage({
        type: 'PRIVACY_SCAN_COMPLETE',
        data: analysis
      });
    },

    /**
     * Lấy profile data qua Background API (stable, không phụ thuộc DOM)
     */
    async extractProfileData() {
      const profile = this.getCurrentProfile();
      if (!profile) {
        return {
          externalUrl: null, isPrivate: false,
          followerCount: 0, followingCount: 0, postCount: 0
        };
      }

      try {
        // Gọi background service worker để fetch profile info qua API
        const info = await chrome.runtime.sendMessage({
          type: 'FETCH_PROFILE_INFO',
          username: profile
        });

        if (info) {
          return {
            externalUrl: info.externalUrl,
            isPrivate: info.isPrivate,
            followerCount: info.followerCount,
            followingCount: info.followingCount,
            postCount: info.postCount,
          };
        }
      } catch (err) {
        console.error('[SocialShield] extractProfileData API error:', err);
      }

      // Fallback: return zeros nếu API fail
      return {
        externalUrl: null, isPrivate: false,
        followerCount: 0, followingCount: 0, postCount: 0
      };
    },

    // ==================== Link Scan ====================

    async runLinkScan() {
      this.notify('Scanning links on this page...', 'info');

      const results = SocialShieldScanner.scanAllLinks(document);
      const unsafe = results.filter(r => !r.safe);
      const warnings = results.filter(r => r.warnings.length > 0 && r.safe);

      if (results.length === 0) {
        this.notify('No external links found on this page.', 'info');
      } else if (unsafe.length === 0 && warnings.length === 0) {
        this.notify(`Scanned ${results.length} external links - all appear safe.`, 'success');
      } else {
        this.notify(
          `Found ${unsafe.length} unsafe and ${warnings.length} suspicious links out of ${results.length} total.`,
          unsafe.length > 0 ? 'error' : 'warning'
        );

        // Highlight unsafe links trên trang
        for (const result of unsafe) {
          if (result.element) {
            result.element.style.outline = '2px solid #ef4444';
            result.element.style.outlineOffset = '2px';
            result.element.title = `[SocialShield] UNSAFE: ${result.warnings.map(w => w.message).join('; ')}`;
          }
        }
      }

      chrome.runtime.sendMessage({
        type: 'LINK_SCAN_COMPLETE',
        data: { total: results.length, unsafe: unsafe.length, results }
      });
    },

    // ==================== URL Observer ====================

    getCurrentProfile() {
      const match = window.location.pathname.match(/^\/([a-zA-Z0-9._]{1,30})\/?$/);
      if (match) {
        const nonProfilePaths = new Set([
          'explore', 'reels', 'direct', 'accounts', 'stories',
          'p', 'tv', 'reel', 'tags', 'locations', 'nametag'
        ]);
        if (!nonProfilePaths.has(match[1])) return match[1];
      }
      return null;
    },

    observeUrlChanges() {
      let lastUrl = location.href;
      const observer = new MutationObserver(() => {
        if (location.href !== lastUrl) {
          lastUrl = location.href;
          this.onUrlChange();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    },

    onUrlChange() {
      const profile = this.getCurrentProfile();
      // Update FAB visibility
      chrome.runtime.sendMessage({
        type: 'URL_CHANGED',
        data: {
          url: location.href,
          profile,
          isProfilePage: !!profile
        }
      });
    },

    // ==================== Message Listener ====================

    listenForMessages() {
      if (!this.isContextValid()) return;
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!this.isContextValid()) return;
        switch (message.type) {
          case 'GET_PAGE_INFO':
            sendResponse({
              url: location.href,
              profile: this.getCurrentProfile(),
              isProfilePage: !!this.getCurrentProfile(),
              isCapturing: this.isCapturing
            });
            return true;

          case 'START_CAPTURE':
            this.handleAction(message.action);
            sendResponse({ ok: true });
            return true;

          case 'RUN_PRIVACY_SCAN':
            this.runPrivacyScan();
            sendResponse({ ok: true });
            return true;

          case 'RUN_LINK_SCAN':
            this.runLinkScan();
            sendResponse({ ok: true });
            return true;
        }
      });
    },

    // ==================== UI Helpers ====================

    notify(message, type = 'info') {
      const area = document.getElementById('ss-notifications');
      if (!area) return;

      const notification = document.createElement('div');
      notification.className = `ss-notification ss-notification-${type}`;

      const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
      };

      const iconSpan = document.createElement('span');
      iconSpan.className = 'ss-notification-icon';
      iconSpan.textContent = icons[type] || icons.info;

      const textSpan = document.createElement('span');
      textSpan.className = 'ss-notification-text';
      textSpan.textContent = message;

      const closeBtn = document.createElement('button');
      closeBtn.className = 'ss-notification-close';
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', () => notification.remove());

      notification.appendChild(iconSpan);
      notification.appendChild(textSpan);
      notification.appendChild(closeBtn);

      area.appendChild(notification);

      // Auto-remove after 6 seconds
      setTimeout(() => {
        if (notification.parentElement) {
          notification.classList.add('ss-notification-exit');
          setTimeout(() => notification.remove(), 300);
        }
      }, 6000);
    },

    showProgress(text, percentage) {
      let progress = document.getElementById('ss-progress');
      if (!progress) {
        progress = document.createElement('div');
        progress.id = 'ss-progress';
        progress.innerHTML = `
          <div class="ss-progress-spinner"></div>
          <span class="ss-progress-text">${text}</span>
          <button class="ss-progress-cancel" title="Cancel">
            ✕
          </button>
        `;
        progress.querySelector('.ss-progress-cancel').addEventListener('click', () => {
          this.isCapturing = false;
          this.hideProgress();
          this.notify('Capture cancelled', 'warning');
        });
        document.body.appendChild(progress);
      }
      this.progressElement = progress;
    },

    updateProgress(text) {
      const el = document.getElementById('ss-progress');
      if (el) {
        el.querySelector('.ss-progress-text').textContent = text;
      }
    },

    hideProgress() {
      const el = document.getElementById('ss-progress');
      if (el) el.remove();
      this.progressElement = null;
    },

    // ==================== Utilities ====================

    wait(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
  };

  // ==================== Initialize ====================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => SS_Instagram.init());
  } else {
    SS_Instagram.init();
  }
})();