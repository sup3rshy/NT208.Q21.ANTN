/**
 * SocialShield - Twitter/X Content Script
 * Chạy trên x.com và twitter.com, cung cấp chức năng:
 * - Capture following/followers list
 * - Privacy scanning
 * - Link checking
 */
(function () {
  'use strict';

  // Tránh inject nhiều lần
  if (window.__socialshield_twitter_loaded) return;
  window.__socialshield_twitter_loaded = true;

  // Twitter public bearer token: embed trong web app JS của Twitter (không phải secret).
  // User có thể override qua Dashboard → Settings nếu Twitter rotate token.
  const TWITTER_BEARER_FALLBACK = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  let TWITTER_BEARER = TWITTER_BEARER_FALLBACK;
  // Load override (nếu có) từ settings, async
  try {
    chrome.storage.local.get('settings').then(({ settings }) => {
      if (settings?.twitterBearerToken && settings.twitterBearerToken.length > 40) {
        TWITTER_BEARER = settings.twitterBearerToken;
      }
    });
  } catch {}

  const SS_Twitter = {
    isCapturing: false,
    capturedUsers: [],
    captureType: null,
    captureProfile: null,
    fabElement: null,
    progressElement: null,

    // ==================== Context Check ====================

    isContextValid() {
      try {
        return !!chrome.runtime?.id;
      } catch {
        return false;
      }
    },

    showRefreshNotice() {
      const fab = document.getElementById('ss-fab');
      if (fab) fab.remove();
      const progress = document.getElementById('ss-progress');
      if (progress) progress.remove();

      const notice = document.createElement('div');
      notice.id = 'ss-refresh-notice';
      notice.style.cssText = `
        position: fixed; bottom: 24px; right: 24px; z-index: 999999;
        background: #1a1a2e; border: 1px solid #ef4444; border-radius: 12px;
        padding: 16px 20px; max-width: 320px; font-family: -apple-system, sans-serif;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      `;
      const title = document.createElement('div');
      title.style.cssText = 'color: #ef4444; font-weight: 600; margin-bottom: 8px;';
      title.textContent = 'SocialShield - Extension Reloaded';
      const desc = document.createElement('div');
      desc.style.cssText = 'color: #ccc; font-size: 13px; margin-bottom: 12px;';
      desc.textContent = 'Extension was updated/reloaded. Please refresh this page to reconnect.';
      const btn = document.createElement('button');
      btn.style.cssText = 'background: #ef4444; color: white; border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer; font-size: 13px; font-weight: 500;';
      btn.textContent = 'Refresh Page';
      btn.addEventListener('click', () => location.reload());
      notice.appendChild(title);
      notice.appendChild(desc);
      notice.appendChild(btn);
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
      console.log('[SocialShield] Twitter/X content script loaded');
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
        </div>
      `;
      document.body.appendChild(fab);
      this.fabElement = fab;

      document.getElementById('ss-fab-toggle').addEventListener('click', () => {
        document.getElementById('ss-fab-menu').classList.toggle('ss-show');
      });

      fab.querySelectorAll('.ss-fab-action').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const action = e.currentTarget.dataset.action;
          document.getElementById('ss-fab-menu').classList.remove('ss-show');
          this.handleAction(action);
        });
      });

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
        // Bước 1: Fetch user info để lấy expected count
        this.updateProgress('Fetching user info...');
        const userInfo = await this.fetchUserInfo(profile);
        const expectedCount = userInfo
          ? (type === 'following' ? userInfo.friends_count : userInfo.followers_count)
          : 0;

        if (userInfo) {
          console.log(`[SocialShield] @${profile}: ${expectedCount} expected ${type}`);
        }

        // Bước 2: Fetch connections qua API
        this.updateProgress(`Fetching ${type} via API...`);
        const users = await this.fetchConnectionsAPI(profile, type, expectedCount);

        this.capturedUsers = users;

        // Bước 3: Lưu snapshot
        if (this.capturedUsers.length > 0) {
          const snapshot = await SocialShieldStorage.saveSnapshot(
            'twitter',
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

          // Profile Change Tracking
          try {
            const userInfo = await this.fetchUserInfo(profile);
            if (userInfo) {
              const { entry, changes } = await SocialShieldStorage.saveProfileSnapshot('twitter', profile, {
                displayName: userInfo.name || '',
                bio: userInfo.description || '',
                profilePicUrl: userInfo.profile_image_url_https || '',
                externalUrl: userInfo.url || userInfo.entities?.url?.urls?.[0]?.expanded_url || '',
                isPrivate: !!userInfo.protected,
                isVerified: !!userInfo.verified || !!userInfo.is_blue_verified,
                followerCount: userInfo.followers_count || 0,
                followingCount: userInfo.friends_count || 0,
                postCount: userInfo.statuses_count || 0,
              });
              if (changes.length > 0) {
                const changeList = changes.map(c => c.label).join(', ');
                this.notify(`Profile changes detected: ${changeList}`, 'warning');
                await SocialShieldStorage.saveAlert({
                  type: 'profile_change',
                  severity: 'warning',
                  title: 'Profile Changes Detected',
                  message: `@${profile}: ${changeList} changed since last capture`,
                  platform: 'twitter',
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

    // ==================== Twitter API Methods ====================

    /**
     * Lấy CSRF token từ cookie ct0
     */
    getCsrfToken() {
      const match = document.cookie.match(/ct0=([^;]+)/);
      return match ? match[1] : '';
    },

    /**
     * Build common headers cho Twitter API requests
     */
    getApiHeaders() {
      return {
        'authorization': `Bearer ${TWITTER_BEARER}`,
        'x-csrf-token': this.getCsrfToken(),
        'x-twitter-active-user': 'yes',
        'x-twitter-auth-type': 'OAuth2Session',
        'Accept': 'application/json',
        'Accept-Language': navigator.language || 'en-US',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      };
    },

    /**
     * Lấy thông tin user từ screen_name qua Twitter internal API
     */
    async fetchUserInfo(screenName) {
      try {
        const res = await fetch(
          `https://x.com/i/api/1.1/users/show.json?screen_name=${screenName}`,
          {
            headers: this.getApiHeaders(),
            credentials: 'include',
          }
        );

        if (!res.ok) {
          console.error(`[SocialShield] Twitter user info failed: ${res.status}`);
          return null;
        }

        return await res.json();
      } catch (err) {
        console.error('[SocialShield] fetchUserInfo error:', err);
        return null;
      }
    },

    /**
     * Fetch following/followers list qua Twitter API v1.1 với cursor pagination
     * API endpoint: followers/list.json hoặc friends/list.json
     */
    async fetchConnectionsAPI(screenName, type, expectedCount) {
      const MAX_ATTEMPTS = 3;
      const userMap = new Map();
      // followers/list.json cho followers, friends/list.json cho following
      const endpoint = type === 'followers' ? 'followers' : 'friends';

      for (let attempt = 1; attempt <= MAX_ATTEMPTS && this.isCapturing; attempt++) {
        if (attempt > 1) {
          const backoff = Math.min(Math.pow(2, attempt) * 2000, 30000) + Math.random() * 2000;
          this.updateProgress(`Verifying ${type}... attempt ${attempt}/${MAX_ATTEMPTS} (waiting ${Math.round(backoff / 1000)}s)`);
          await this.wait(backoff);
        }

        let cursor = '-1';
        let page = 0;

        while (cursor !== '0' && this.isCapturing) {
          page++;
          this.updateProgress(
            attempt === 1
              ? `Fetching ${type}... page ${page} (${userMap.size} users)`
              : `Verifying ${type}... attempt ${attempt} page ${page} (${userMap.size} users)`
          );

          try {
            const url = `https://x.com/i/api/1.1/${endpoint}/list.json?screen_name=${screenName}&count=200&cursor=${cursor}&skip_status=true&include_user_entities=false`;

            const res = await fetch(url, {
              headers: this.getApiHeaders(),
              credentials: 'include',
            });

            // Exponential backoff cho 429 rate limit
            if (res.status === 429) {
              const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10);
              const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(Math.pow(2, page) * 2000, 60000);
              this.updateProgress(`Rate limited, waiting ${Math.round(waitMs / 1000)}s...`);
              console.warn(`[SocialShield] Twitter rate limited (429), waiting ${Math.round(waitMs / 1000)}s`);
              await this.wait(waitMs);
              continue; // retry same page
            }

            if (!res.ok) {
              console.error(`[SocialShield] Twitter API error: ${res.status}`);
              if (res.status === 401 || res.status === 403) {
                this.notify('Authentication error. Make sure you are logged into Twitter/X.', 'error');
              }
              break;
            }

            const contentType = res.headers.get('content-type');
            if (!contentType || !contentType.includes('json')) {
              console.error(`[SocialShield] Unexpected response type: ${contentType}`);
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

            // Cursor-based pagination: dừng khi next_cursor_str = "0"
            cursor = data.next_cursor_str || '0';

            if (cursor !== '0') {
              await this.wait(2000 + Math.random() * 1000);
            }
          } catch (err) {
            console.error(`[SocialShield] fetchConnectionsAPI error on page ${page}:`, err);
            break;
          }
        }

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
      const snapshots = await SocialShieldStorage.getSnapshots('twitter', profile, type);
      if (snapshots.length < 2) return;

      const prevSnapshot = snapshots[snapshots.length - 2];
      const diff = SocialShieldDiff.compare(prevSnapshot, newSnapshot);
      const alerts = SocialShieldDiff.detectSuspicious(diff);

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
            platform: 'twitter',
            username: profile,
            snapshotType: type
          });
        }
        this.notify(
          `${alerts.length} suspicious activity alert(s) detected! Check dashboard for details.`,
          'warning'
        );
      }

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

      // Lấy bio text từ DOM - Twitter dùng data-testid attributes
      let bioText = '';

      // Try data-testid selectors (Twitter/X React app)
      const bioEl = document.querySelector('[data-testid="UserDescription"]');
      if (bioEl) {
        bioText = bioEl.innerText || bioEl.textContent || '';
      }

      // Fallback: lấy text từ profile header area
      if (!bioText) {
        const headerEl = document.querySelector('[data-testid="UserProfileHeader_Items"]') ||
          document.querySelector('[data-testid="UserName"]')?.closest('div[class]');
        if (headerEl) {
          bioText = headerEl.innerText || '';
        }
      }

      // Thêm info từ profile header items (location, website, join date)
      const headerItems = document.querySelector('[data-testid="UserProfileHeader_Items"]');
      if (headerItems) {
        bioText += '\n' + (headerItems.innerText || '');
      }

      if (!bioText) {
        const main = document.querySelector('main') || document.body;
        bioText = main.innerText.substring(0, 5000);
      }

      const findings = SocialShieldScanner.scanPrivacy(bioText);

      // AI Text Analysis - phân tích bio có dấu hiệu scam/phishing không
      try {
        const aiResult = await SocialShieldTextAnalyzer.analyzeText(bioText, 'twitter bio');
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
        const pwdPatterns = [
          /(?:password|pass|mật khẩu|mk|pw)[:\s=]+['"]?([^\s'"]{4,30})['"]?/gi,
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

      // Lấy thêm thông tin profile qua API
      let profileData = {
        externalUrl: null, isPrivate: false,
        followerCount: 0, followingCount: 0, postCount: 0
      };

      if (profile) {
        try {
          const info = await this.fetchUserInfo(profile);
          if (info) {
            profileData = {
              externalUrl: info.url || info.entities?.url?.urls?.[0]?.expanded_url || null,
              isPrivate: !!info.protected,
              followerCount: info.followers_count || 0,
              followingCount: info.friends_count || 0,
              postCount: info.statuses_count || 0,
            };
          }
        } catch (err) {
          console.error('[SocialShield] extractProfileData error:', err);
        }
      }

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

      if (profile) {
        await SocialShieldStorage.savePrivacyScan('twitter', profile, analysis.privacyFindings);
      }

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

      chrome.runtime.sendMessage({
        type: 'PRIVACY_SCAN_COMPLETE',
        data: analysis
      });
    },

    // ==================== Engagement Rate ====================

    async runEngagementRate(profile) {
      this.notify('Calculating engagement rate...', 'info');
      try {
        const userInfo = await this.fetchUserInfo(profile);
        if (!userInfo) {
          this.notify('Could not fetch user info.', 'error');
          return;
        }

        const engagement = SocialShieldScanner.calculateEngagement({
          followerCount: userInfo.followers_count,
          followingCount: userInfo.friends_count,
          postCount: userInfo.statuses_count,
          totalLikes: userInfo.favourites_count || 0,
        });

        const qualityLabels = {
          excellent: '🟢 Excellent', good: '🟢 Good', average: '🟡 Average',
          low: '🔴 Low', suspicious_high: '🔴 Suspiciously High',
          no_data: '⚪ No Data', no_followers: '⚪ No Followers'
        };

        const lines = [
          `Engagement: ${qualityLabels[engagement.quality] || engagement.quality}`,
          `Follower/Following Ratio: ${engagement.followerFollowingRatio}`,
          `Tweets: ${userInfo.statuses_count} | Followers: ${userInfo.followers_count} | Following: ${userInfo.friends_count}`,
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
        const userInfo = await this.fetchUserInfo(profile);
        const displayName = userInfo?.name || '';

        const followers = await SocialShieldStorage.getSnapshots('twitter', profile, 'followers');
        const following = await SocialShieldStorage.getSnapshots('twitter', profile, 'following');
        const latestFollowers = followers.length > 0 ? followers[followers.length - 1].data : [];
        const latestFollowing = following.length > 0 ? following[following.length - 1].data : [];
        const allUsers = [...latestFollowers, ...latestFollowing];

        if (allUsers.length === 0) {
          this.notify('No captured data. Capture followers/following first!', 'warning');
          return;
        }

        const whitelist = await SocialShieldStorage.getImpersonationWhitelist('twitter', profile);
        const suspects = SocialShieldScanner.detectImpersonation(profile, displayName, allUsers, whitelist);

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
            platform: 'twitter',
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

      let sbApiKey = null;
      try {
        const settings = await SocialShieldStorage.getSettings();
        if (settings.safeBrowsingEnabled && settings.safeBrowsingApiKey) {
          sbApiKey = settings.safeBrowsingApiKey;
        }
      } catch (e) { /* ignore */ }

      let results;
      if (sbApiKey) {
        this.notify('Checking links with Google Safe Browsing...', 'info');
        const links = SocialShieldScanner.scanAllLinks(document);
        results = [];
        for (const linkResult of links) {
          const fullResult = await SocialShieldScanner.checkLinkFull(linkResult.url, sbApiKey);
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

    // ==================== Comment/Reply Scam Scanner ====================

    startCommentScanner() {
      const scannedElements = new WeakSet();

      const scanTweet = (el) => {
        if (scannedElements.has(el)) return;
        scannedElements.add(el);

        const text = el.innerText || el.textContent || '';
        if (text.length < 15) return;

        const result = SocialShieldTextAnalyzer.analyzeTextRuleBased(text);
        if (result.classification === 'safe') return;

        const tweetArticle = el.closest('article') || el.closest('[data-testid="tweet"]') || el;
        if (tweetArticle.querySelector('.ss-scam-badge')) return;

        tweetArticle.style.position = 'relative';
        const badge = document.createElement('div');
        badge.className = 'ss-scam-badge';
        badge.title = result.reasoning || '';
        const icon = document.createTextNode(result.classification === 'scam' ? '🚨 ' : '⚠️ ');
        const label = document.createElement('span');
        label.textContent = result.classification === 'scam' ? 'Scam' : 'Suspicious';
        label.style.cssText = 'font-size: 10px;';
        badge.appendChild(icon);
        badge.appendChild(label);
        badge.style.cssText = `
          position: absolute; top: 4px; right: 4px; z-index: 9999;
          background: ${result.classification === 'scam' ? '#ef4444' : '#f59e0b'};
          color: white; font-size: 10px; font-weight: 600; padding: 2px 6px;
          border-radius: 4px; cursor: help; display: flex; align-items: center; gap: 3px;
          font-family: -apple-system, sans-serif; line-height: 1.2;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        `;
        tweetArticle.style.outline = `1px solid ${result.classification === 'scam' ? '#ef4444' : '#f59e0b'}`;
        tweetArticle.style.outlineOffset = '1px';
        tweetArticle.style.borderRadius = '12px';
        tweetArticle.appendChild(badge);
      };

      const scanAllTweets = () => {
        if (!this.isContextValid()) { this.teardownObservers(); return; }
        document.querySelectorAll('[data-testid="tweetText"]').forEach(el => scanTweet(el));
      };

      if (this.commentObserver) { try { this.commentObserver.disconnect(); } catch {} }

      setTimeout(scanAllTweets, 3000);

      let debounceTimer = null;
      const observer = new MutationObserver((mutations) => {
        if (!this.isContextValid()) { this.teardownObservers(); return; }
        const hasAddedNodes = mutations.some(m => m.addedNodes && m.addedNodes.length > 0);
        if (!hasAddedNodes) return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(scanAllTweets, 1500);
      });
      const target = document.querySelector('main') || document.body;
      observer.observe(target, { childList: true, subtree: true });
      this.commentObserver = observer;
    },

    teardownObservers() {
      if (this.commentObserver) {
        try { this.commentObserver.disconnect(); } catch {}
        this.commentObserver = null;
      }
      if (this.urlObserver) {
        try { this.urlObserver.disconnect(); } catch {}
        this.urlObserver = null;
      }
    },

    // ==================== URL Observer ====================

    getCurrentProfile() {
      const match = window.location.pathname.match(/^\/([a-zA-Z0-9_]{1,15})\/?$/);
      if (match) {
        const nonProfilePaths = new Set([
          'home', 'explore', 'search', 'notifications', 'messages',
          'i', 'settings', 'compose', 'hashtag', 'lists', 'login',
          'signup', 'tos', 'privacy', 'jobs', 'about'
        ]);
        if (!nonProfilePaths.has(match[1])) return match[1];
      }
      return null;
    },

    observeUrlChanges() {
      if (this.urlObserver) { try { this.urlObserver.disconnect(); } catch {} }
      let lastUrl = location.href;
      const observer = new MutationObserver(() => {
        if (!this.isContextValid()) { this.teardownObservers(); return; }
        if (location.href !== lastUrl) {
          lastUrl = location.href;
          this.onUrlChange();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      this.urlObserver = observer;
      window.addEventListener('pagehide', () => this.teardownObservers(), { once: true });
    },

    onUrlChange() {
      const profile = this.getCurrentProfile();
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
              isCapturing: this.isCapturing,
              platform: 'twitter'
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

      setTimeout(() => {
        if (notification.parentElement) {
          notification.classList.add('ss-notification-exit');
          setTimeout(() => notification.remove(), 300);
        }
      }, 6000);
    },

    showProgress(text) {
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
    document.addEventListener('DOMContentLoaded', () => SS_Twitter.init());
  } else {
    SS_Twitter.init();
  }
})();