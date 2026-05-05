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
      this.startCommentScanner();
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
          <button class="ss-fab-action" data-action="engagement-rate">
            <span class="ss-fab-action-icon">📊</span>
            <span>Engagement Rate</span>
          </button>
          <button class="ss-fab-action" data-action="check-impersonation">
            <span class="ss-fab-action-icon">🎭</span>
            <span>Impersonation Check</span>
          </button>
          <button class="ss-fab-action" data-action="audit-privacy-settings">
            <span class="ss-fab-action-icon">⚙️</span>
            <span>Audit Privacy Settings</span>
          </button>
          <button class="ss-fab-action" data-action="parse-apps-page">
            <span class="ss-fab-action-icon">🚪</span>
            <span>Parse Connected Apps</span>
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

        case 'engagement-rate':
          if (!profile) return this.notify('Navigate to a profile page first!', 'error');
          await this.runEngagementRate(profile);
          break;

        case 'check-impersonation':
          if (!profile) return this.notify('Navigate to a profile page first!', 'error');
          await this.runImpersonationCheck(profile);
          break;

        case 'audit-privacy-settings':
          await this.runPrivacyAudit();
          break;

        case 'parse-apps-page':
          await this.runAppsParse();
          break;
      }
    },

    async runAppsParse() {
      if (!location.pathname.includes('manage_access') && !location.pathname.includes('apps_and_websites')) {
        this.notify('Open IG Settings → Apps and Websites first (/accounts/manage_access/).', 'warning');
        return;
      }
      const apps = SocialShieldPrivacyAuditor.parseAppsPage();
      const assess = SocialShieldPrivacyAuditor.assessApps(apps);
      const data = { platform: 'instagram', apps, assessment: assess, capturedAt: new Date().toISOString(), url: location.href };
      await SocialShieldStorage.set('connected_apps_instagram', data);
      this.notify(`Found ${apps.length} connected app(s) — risk: ${assess.risk}. Open dashboard for details.`,
        assess.risk === 'high' ? 'warning' : 'success');
      chrome.runtime.sendMessage({ type: 'APPS_PARSED', data });
    },

    async runPrivacyAudit() {
      if (!location.pathname.includes('/accounts/') &&
          !location.pathname.includes('privacy') &&
          !location.pathname.includes('login_activity') &&
          !location.pathname.includes('apps_and_websites') &&
          !location.pathname.includes('two_factor') &&
          !location.pathname.includes('security')) {
        this.notify('Open Instagram Settings page first (Settings → Privacy / Security / Login activity / Apps).', 'warning');
        return;
      }
      const audit = SocialShieldPrivacyAuditor.auditInstagram();
      await SocialShieldStorage.set(`privacy_audit_instagram`, audit);
      const sum = SocialShieldPrivacyAuditor.summarize(audit);
      this.notify(`${sum} Open dashboard for details.`, audit.findings.length > 0 ? 'warning' : 'success');
      chrome.runtime.sendMessage({ type: 'PRIVACY_AUDIT_COMPLETE', data: audit });
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

          // Bot/real count analysis
          const botAnalysis = SocialShieldDiff.analyzeBots(this.capturedUsers);
          const realCount = botAnalysis.realCount || (this.capturedUsers.length - botAnalysis.botCount);
          this.notify(
            `Captured ${this.capturedUsers.length} ${type} for @${profile} (${realCount} real, ${botAnalysis.botCount} bot)`,
            'success'
          );

          chrome.runtime.sendMessage({
            type: 'SNAPSHOT_SAVED',
            data: snapshot
          });

          await this.autoCompare(profile, type, snapshot);

          // Profile Change Tracking: lưu metadata profile mỗi lần capture
          try {
            const profileData = await this.extractProfileData();
            const profileInfo = await chrome.runtime.sendMessage({
              type: 'FETCH_PROFILE_INFO', username: profile
            });
            if (profileInfo) {
              // Compute aHash + pHash của profile pic để cross-platform linkage so sánh
              let profilePicHash = null, profilePicPHash = null;
              if (profileInfo.profilePicUrl) {
                try {
                  const both = await SocialShieldImageAnalyzer.computeBothHashes(profileInfo.profilePicUrl);
                  profilePicHash = both.aHash;
                  profilePicPHash = both.pHash;
                } catch (e) { /* CORS hoặc image load fail — ignore */ }
              }

              const { entry, changes } = await SocialShieldStorage.saveProfileSnapshot('instagram', profile, {
                displayName: profileInfo.fullName || '',
                bio: profileInfo.bio || '',
                profilePicUrl: profileInfo.profilePicUrl || '',
                profilePicHash,
                profilePicPHash,
                externalUrl: profileInfo.externalUrl || '',
                isPrivate: !!profileInfo.isPrivate,
                isVerified: !!profileInfo.isVerified,
                followerCount: profileInfo.followerCount || 0,
                followingCount: profileInfo.followingCount || 0,
                postCount: profileInfo.postCount || 0,
              });
              if (changes.length > 0) {
                const changeList = changes.map(c => c.label).join(', ');
                this.notify(`Profile changes detected: ${changeList}`, 'warning');
                await SocialShieldStorage.saveAlert({
                  type: 'profile_change',
                  severity: 'warning',
                  title: 'Profile Changes Detected',
                  message: `@${profile}: ${changeList} changed since last capture`,
                  platform: 'instagram',
                  username: profile,
                  details: changes
                });
              }
            }
          } catch (e) {
            console.warn('[SocialShield] Profile tracking error:', e);
          }
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
    _igHeaders() {
      return {
        'x-csrftoken': this.getCsrfToken(),
        'x-ig-app-id': '936619743392459',
        'x-requested-with': 'XMLHttpRequest',
        'Accept': 'application/json',
        'Accept-Language': navigator.language || 'en-US',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      };
    },

    async fetchUserId(username) {
      try {
        const res = await fetch(
          `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
          { headers: this._igHeaders(), credentials: 'include' }
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
          const backoff = Math.min(Math.pow(2, attempt) * 2000, 30000) + Math.random() * 2000;
          this.updateProgress(`Verifying ${type}... attempt ${attempt}/${MAX_ATTEMPTS} (waiting ${Math.round(backoff / 1000)}s)`);
          await this.wait(backoff);
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
              headers: this._igHeaders(),
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

            // Exponential backoff cho 429 rate limit
            if (res.status === 429) {
              const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10);
              const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(Math.pow(2, page) * 2000, 60000);
              this.updateProgress(`Rate limited, waiting ${Math.round(waitMs / 1000)}s...`);
              console.warn(`[SocialShield] Rate limited (429), waiting ${Math.round(waitMs / 1000)}s`);
              await this.wait(waitMs);
              continue; // retry same page
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
                    hasAnonymousProfilePic: !!u.has_anonymous_profile_picture,
                    isPrivate: !!u.is_private,
                    latestReelMedia: u.latest_reel_media || 0,
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

      // Bot detection on new followers/following
      if (diff.added.length > 0) {
        const botAnalysis = SocialShieldDiff.analyzeBots(diff.added);
        if (botAnalysis.botRatio > 30) {
          alerts.push({
            type: 'bot_detected',
            severity: 'warning',
            title: 'Potential Bot Accounts',
            message: `${botAnalysis.botCount} of ${diff.added.length} new ${type} show bot-like patterns (${botAnalysis.botRatio}%)`,
            count: botAnalysis.botCount
          });
        }
      }

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

      // Lấy captions của recent posts từ background API → scan sâu hơn bio
      let recentCaptions = [];
      let recentPosts = [];
      let displayName = '';
      try {
        const info = await chrome.runtime.sendMessage({
          type: 'FETCH_PROFILE_INFO', username: profile
        });
        if (info) {
          recentCaptions = info.recentCaptions || [];
          recentPosts = info.recentPosts || [];
          displayName = info.fullName || '';
        }
      } catch { /* ignore */ }

      // Deep scan: bio + displayName + tất cả captions (recon tools không thấy được)
      const findings = SocialShieldScanner.scanFullProfile({
        bio: bioText,
        displayName,
        captions: recentCaptions,
      });

      // AI Text Analysis - phân tích bio có dấu hiệu scam/phishing không
      try {
        const aiResult = await SocialShieldTextAnalyzer.analyzeText(bioText, 'instagram bio');
        if (aiResult && aiResult.classification !== 'safe') {
          findings.push({
            type: 'ai_text_analysis',
            severity: aiResult.classification === 'scam' ? 'high' : 'medium',
            icon: '🤖',
            title: `AI Analysis: ${aiResult.classification.toUpperCase()} content detected`,
            message: aiResult.reasoning || 'Suspicious text patterns found in profile',
            values: [`Confidence: ${Math.round(aiResult.confidence * 100)}%`, `Source: ${aiResult.source}`]
          });
        }
      } catch (err) {
        console.warn('[SocialShield] AI text analysis skipped:', err.message);
      }

      // Check email breach - kiểm tra email lộ lọt qua HIBP
      const emailFindings = findings.filter(f => f.type === 'email');
      if (emailFindings.length > 0) {
        for (const ef of emailFindings) {
          for (const email of (ef.values || [])) {
            try {
              const breachResult = await chrome.runtime.sendMessage({
                type: 'CHECK_EMAIL_BREACH',
                email
              });
              if (breachResult && breachResult.breached) {
                const src = breachResult.source ? ` (via ${breachResult.source})` : '';
                const breachNames = (breachResult.breaches || []).filter(b => b && !b.startsWith('Domain'));
                const detail = breachNames.length > 0
                  ? `Breaches: ${breachNames.slice(0, 10).join(', ')}${breachNames.length > 10 ? ` +${breachNames.length - 10} more` : ''}`
                  : '';
                findings.push({
                  type: 'email_breach',
                  severity: 'critical',
                  icon: '💀',
                  title: 'Email Found in Data Breach',
                  message: `${email} appeared in ${breachResult.breachCount > 0 ? breachResult.breachCount : 'multiple'} known data breach(es)${src}${detail ? '. ' + detail : ''}`,
                  values: breachResult.breaches || []
                });
              } else if (breachResult && breachResult.note) {
                findings.push({
                  type: 'email_breach',
                  severity: 'medium',
                  icon: '⚠️',
                  title: 'Email Breach Status Unknown',
                  message: `${email}: ${breachResult.note}`,
                  values: []
                });
              }
            } catch (err) {
              console.warn('[SocialShield] Breach check skipped:', err.message);
            }
          }
        }
      }

      // Check password exposure + Pwned Passwords DB
      const pwdFindings = SocialShieldScanner.checkPasswordExposure(bioText);
      if (pwdFindings.length > 0) {
        findings.push(...pwdFindings);
        // Check mỗi password phát hiện được trong Pwned Passwords DB (HIBP, free k-anonymity)
        const pwdPatterns = [
          /\b(?:password|passwd|mật\s*khẩu)\s*[:=]\s*['"]?([A-Za-z0-9!@#$%^&*()_+\-={}\[\]|:;<>,.?/~`]{6,30})['"]?/gi,
          /(?:pin|mã pin)[:\s=]+(\d{4,8})/gi,
        ];
        for (const pattern of pwdPatterns) {
          let m;
          while ((m = pattern.exec(bioText)) !== null) {
            try {
              const pwnedResult = await chrome.runtime.sendMessage({
                type: 'CHECK_PASSWORD_PWNED',
                password: m[1]
              });
              if (pwnedResult && pwnedResult.pwned) {
                findings.push({
                  type: 'password_pwned',
                  severity: 'critical',
                  icon: '💀',
                  title: 'Password Found in Breach Database',
                  message: `Exposed password appeared in ${pwnedResult.count.toLocaleString()} known data breach(es) (HIBP Pwned Passwords)`,
                  values: []
                });
                break;
              }
            } catch {}
          }
        }
      }

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

      // Merge thêm findings từ AI/breach/password vào analysis
      analysis.privacyFindings = [...analysis.privacyFindings, ...findings.filter(f =>
        ['ai_text_analysis', 'email_breach', 'password_exposed', 'password_pwned'].includes(f.type)
      )];

      // Generate security recommendations
      const recommendations = SocialShieldScanner.generateSecurityRecommendations(
        analysis.privacyFindings, profileData
      );
      analysis.recommendations = recommendations;

      // Cross-platform linkage: pull twitter profile if exists để compare
      let linkage = null;
      try {
        const twHistory = await SocialShieldStorage.getProfileHistory('twitter', profile);
        if (twHistory && twHistory.length > 0) {
          const twLatest = twHistory[twHistory.length - 1];
          // Compute IG aHash+pHash on-the-fly từ profile pic hiện tại
          let igHash = null, igPHash = null;
          try {
            if (profileData.profilePicUrl) {
              const both = await SocialShieldImageAnalyzer.computeBothHashes(profileData.profilePicUrl);
              igHash = both.aHash; igPHash = both.pHash;
            }
          } catch {}
          linkage = SocialShieldScanner.detectCrossPlatformLinkage([
            { platform: 'instagram', username: profile, displayName,
              bio: bioText, profilePicUrl: profileData.profilePicUrl,
              profilePicHash: igHash, profilePicPHash: igPHash,
              externalUrl: profileData.externalUrl },
            { platform: 'twitter', username: profile, displayName: twLatest.displayName,
              bio: twLatest.bio, profilePicUrl: twLatest.profilePicUrl,
              profilePicHash: twLatest.profilePicHash,
              profilePicPHash: twLatest.profilePicPHash,
              externalUrl: twLatest.externalUrl },
          ]);
        }
      } catch { /* ignore */ }

      // Doxxing Report - composite narrative from all signals
      const breachData = findings.filter(f => f.type === 'email_breach');
      const doxxing = SocialShieldScanner.generateDoxxingReport({
        profile: { username: profile, fullName: displayName, displayName },
        privacyFindings: analysis.privacyFindings,
        breachData,
        linkage,
        recentPosts,
      });
      analysis.doxxingReport = doxxing;
      analysis.recentCaptions = recentCaptions;

      // Lưu kết quả
      if (profile) {
        await SocialShieldStorage.savePrivacyScan('instagram', profile, analysis.privacyFindings);
        // Lưu doxxing report riêng để dashboard render
        await SocialShieldStorage.set(`doxxing_instagram_${profile}`, {
          ...doxxing,
          username: profile,
          platform: 'instagram',
        });
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

    // ==================== Engagement Rate ====================

    async runEngagementRate(profile) {
      this.notify('Calculating engagement rate...', 'info');
      try {
        const profileInfo = await chrome.runtime.sendMessage({
          type: 'FETCH_PROFILE_INFO', username: profile
        });
        if (!profileInfo) {
          this.notify('Could not fetch profile info.', 'error');
          return;
        }

        const engagement = SocialShieldScanner.calculateEngagement({
          followerCount: profileInfo.followerCount,
          followingCount: profileInfo.followingCount,
          postCount: profileInfo.postCount,
        });

        const qualityLabels = {
          excellent: '🟢 Excellent', good: '🟢 Good', average: '🟡 Average',
          low: '🔴 Low', suspicious_high: '🔴 Suspiciously High',
          no_data: '⚪ No Data', no_followers: '⚪ No Followers'
        };

        const lines = [
          `Engagement: ${qualityLabels[engagement.quality] || engagement.quality}`,
          `Follower/Following Ratio: ${engagement.followerFollowingRatio}`,
          `Posts: ${profileInfo.postCount} | Followers: ${profileInfo.followerCount} | Following: ${profileInfo.followingCount}`,
        ];
        if (engagement.flags.length > 0) {
          lines.push(`Flags: ${engagement.flags.join('; ')}`);
        }
        this.notify(lines.join('\n'), engagement.flags.length > 0 ? 'warning' : 'success');
      } catch (err) {
        console.error('[SocialShield] Engagement rate error:', err);
        this.notify('Error calculating engagement rate.', 'error');
      }
    },

    // ==================== Impersonation Check ====================

    async runImpersonationCheck(profile) {
      this.notify('Checking for impersonation accounts...', 'info');
      try {
        const profileInfo = await chrome.runtime.sendMessage({
          type: 'FETCH_PROFILE_INFO', username: profile
        });
        const displayName = profileInfo?.fullName || '';

        // Lấy followers gần nhất từ storage
        const followers = await SocialShieldStorage.getSnapshots('instagram', profile, 'followers');
        const following = await SocialShieldStorage.getSnapshots('instagram', profile, 'following');
        const latestFollowers = followers.length > 0 ? followers[followers.length - 1].data : [];
        const latestFollowing = following.length > 0 ? following[following.length - 1].data : [];
        const allUsers = [...latestFollowers, ...latestFollowing];

        if (allUsers.length === 0) {
          this.notify('No captured data. Capture followers/following first!', 'warning');
          return;
        }

        const suspects = SocialShieldScanner.detectImpersonation(profile, displayName, allUsers);

        if (suspects.length === 0) {
          this.notify(`No impersonation accounts found among ${allUsers.length} users.`, 'success');
        } else {
          const top3 = suspects.slice(0, 3).map(s =>
            `@${s.username} (${s.impersonationScore}%)`
          ).join(', ');
          this.notify(
            `Found ${suspects.length} suspected impersonation account(s): ${top3}. Check dashboard for details.`,
            'warning'
          );
          await SocialShieldStorage.saveAlert({
            type: 'impersonation',
            severity: 'danger',
            title: 'Impersonation Accounts Detected',
            message: `${suspects.length} account(s) may be impersonating @${profile}`,
            platform: 'instagram',
            username: profile,
            details: suspects.slice(0, 10).map(s => ({
              username: s.username, score: s.impersonationScore, reasons: s.impersonationReasons
            }))
          });
        }
      } catch (err) {
        console.error('[SocialShield] Impersonation check error:', err);
        this.notify('Error checking for impersonation.', 'error');
      }
    },

    // ==================== Link Scan ====================

    async runLinkScan() {
      this.notify('Scanning links on this page...', 'info');

      // Build threat-intel options từ settings
      const opts = {};
      try {
        const settings = await SocialShieldStorage.getSettings();
        if (settings.safeBrowsingEnabled && settings.safeBrowsingApiKey) {
          opts.safeBrowsingApiKey = settings.safeBrowsingApiKey;
        }
        if (settings.virusTotalEnabled && settings.virusTotalApiKey) {
          opts.virusTotalApiKey = settings.virusTotalApiKey;
        }
        if (settings.urlhausEnabled && settings.urlhausAuthKey) {
          opts.urlhausAuthKey = settings.urlhausAuthKey;
        }
      } catch (e) { /* ignore */ }

      const useFullCheck = Object.keys(opts).length > 0;

      let results;
      if (useFullCheck) {
        const engines = [];
        if (opts.safeBrowsingApiKey) engines.push('Safe Browsing');
        if (opts.virusTotalApiKey) engines.push('VirusTotal');
        if (opts.urlhausAuthKey) engines.push('URLhaus');
        this.notify(`Checking links with ${engines.join(' + ')}...`, 'info');
        const links = SocialShieldScanner.scanAllLinks(document);
        results = [];
        for (const linkResult of links) {
          const fullResult = await SocialShieldScanner.checkLinkFull(linkResult.url, opts);
          fullResult.element = linkResult.element;
          fullResult.text = linkResult.text;
          results.push(fullResult);
        }
      } else {
        results = SocialShieldScanner.scanAllLinks(document);
      }

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

    // ==================== Comment/DM Scam Scanner ====================

    /**
     * Tự động quét comments visible trên trang, overlay cảnh báo scam
     * Dùng MutationObserver để quét comments mới load
     */
    startCommentScanner() {
      const scannedElements = new WeakSet();

      const scanComment = (el) => {
        if (scannedElements.has(el)) return;
        scannedElements.add(el);

        const text = el.innerText || el.textContent || '';
        if (text.length < 10) return;

        const result = SocialShieldTextAnalyzer.analyzeTextRuleBased(text);
        if (result.classification === 'safe') return;

        // Overlay warning badge
        el.style.position = 'relative';
        const badge = document.createElement('div');
        badge.className = 'ss-scam-badge';
        badge.title = result.reasoning;
        badge.innerHTML = result.classification === 'scam'
          ? '🚨 <span>Scam</span>'
          : '⚠️ <span>Suspicious</span>';
        badge.style.cssText = `
          position: absolute; top: -2px; right: -2px; z-index: 9999;
          background: ${result.classification === 'scam' ? '#ef4444' : '#f59e0b'};
          color: white; font-size: 10px; font-weight: 600; padding: 2px 6px;
          border-radius: 4px; cursor: help; display: flex; align-items: center; gap: 3px;
          font-family: -apple-system, sans-serif; line-height: 1.2;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        `;
        badge.querySelector('span').style.cssText = 'font-size: 10px;';
        el.style.outline = `1px solid ${result.classification === 'scam' ? '#ef4444' : '#f59e0b'}`;
        el.style.outlineOffset = '2px';
        el.style.borderRadius = '4px';
        el.appendChild(badge);
      };

      const scanAllComments = () => {
        // Instagram comments sử dụng nhiều selectors
        const commentSelectors = [
          'ul li span[dir]',                        // Comment text
          '[class*="Comment"] span',                 // Comment spans
          'div[role="button"] + span',               // Reply text
        ];
        for (const sel of commentSelectors) {
          document.querySelectorAll(sel).forEach(el => {
            if (el.closest('.ss-scam-badge')) return; // skip badge elements
            if (el.innerText && el.innerText.length > 15) scanComment(el);
          });
        }
      };

      // Scan khi page load
      setTimeout(scanAllComments, 3000);

      // Observe DOM changes cho comments mới (debounced)
      let debounceTimer = null;
      const observer = new MutationObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(scanAllComments, 500);
      });
      observer.observe(document.body, { childList: true, subtree: true });
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
              platform: 'instagram',
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