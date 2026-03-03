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

    // ==================== Initialization ====================

    init() {
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
        // Thử click vào link following/followers để mở modal
        const linkSelector = `a[href="/${profile}/${type}/"]`;
        let link = document.querySelector(linkSelector);

        // Fallback: tìm link chứa text "following" hoặc "followers"
        if (!link) {
          const allLinks = document.querySelectorAll(`a[href*="/${profile}/"]`);
          link = Array.from(allLinks).find(a => a.href.includes(`/${type}`));
        }

        if (link) {
          link.click();
          await this.wait(2000);
        }

        // Tìm dialog
        const modal = await this.waitForModal(5000);
        if (!modal) {
          this.notify(`Could not find ${type} dialog. Please open it manually and try again.`, 'error');
          this.isCapturing = false;
          this.hideProgress();
          return;
        }

        // Tìm scrollable container
        const scrollable = this.findScrollable(modal);
        if (!scrollable) {
          this.notify('Could not find scrollable list in dialog.', 'error');
          this.isCapturing = false;
          this.hideProgress();
          return;
        }

        // Bắt đầu scroll và thu thập
        await this.scrollAndCollect(scrollable, modal);

        // Lưu snapshot
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

          // Thông báo cho background
          chrome.runtime.sendMessage({
            type: 'SNAPSHOT_SAVED',
            data: snapshot
          });

          // Tự động detect suspicious activity nếu có snapshot cũ
          await this.autoCompare(profile, type, snapshot);
        } else {
          this.notify('No users captured. The list might be empty or the page structure changed.', 'warning');
        }

      } catch (err) {
        console.error('[SocialShield] Capture error:', err);
        this.notify(`Error during capture: ${err.message}`, 'error');
      } finally {
        this.isCapturing = false;
        this.hideProgress();
      }
    },

    async waitForModal(timeout = 5000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const modal = document.querySelector('div[role="dialog"]');
        if (modal) return modal;
        await this.wait(300);
      }
      return null;
    },

    findScrollable(modal) {
      // Chiến lược 1: tìm div có overflow scroll/auto
      const allDivs = modal.querySelectorAll('div');
      for (const div of allDivs) {
        const style = window.getComputedStyle(div);
        if (
          (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          div.scrollHeight > div.clientHeight + 10
        ) {
          return div;
        }
      }

      // Chiến lược 2: tìm div lớn nhất bên trong modal
      let largest = null;
      let maxHeight = 0;
      for (const div of allDivs) {
        if (div.scrollHeight > maxHeight && div.children.length > 3) {
          maxHeight = div.scrollHeight;
          largest = div;
        }
      }
      return largest;
    },

    async scrollAndCollect(scrollable, modal) {
      let previousCount = 0;
      let noChangeRounds = 0;
      const maxNoChange = 5;
      let scrollAttempts = 0;
      const maxScrollAttempts = 500; // Safety limit
      let reachedSuggested = false;

      while (noChangeRounds < maxNoChange && scrollAttempts < maxScrollAttempts) {
        // Thu thập users hiện tại
        this.collectUsers(modal);

        // Kiểm tra đã đến phần "Suggested for you" chưa
        if (!reachedSuggested && this.findSuggestedBoundary(modal)) {
          reachedSuggested = true;
          // Thu thập thêm 1 lần nữa rồi dừng
          this.collectUsers(modal);
          this.updateProgress(
            `Done! ${this.capturedUsers.length} users captured (reached suggested section)`,
            null
          );
          break;
        }

        // Cập nhật progress
        this.updateProgress(
          `Capturing... ${this.capturedUsers.length} users found`,
          null
        );

        // Kiểm tra có user mới không
        if (this.capturedUsers.length === previousCount) {
          noChangeRounds++;
        } else {
          noChangeRounds = 0;
        }
        previousCount = this.capturedUsers.length;

        // Scroll xuống
        scrollable.scrollTop += scrollable.clientHeight * 0.8;
        scrollAttempts++;

        // Random delay để tránh bị phát hiện
        await this.wait(600 + Math.random() * 600);
      }
    },

    collectUsers(container) {
      // Tìm ranh giới "Suggested for you" - dừng lại trước phần này
      const suggestedBoundary = this.findSuggestedBoundary(container);

      // Tìm tất cả links có pattern /<username>/
      const links = container.querySelectorAll('a[href]');
      const nonUserPaths = new Set([
        'explore', 'reels', 'direct', 'accounts', 'stories',
        'p', 'tv', 'reel', 'tags', 'locations', 'nametag',
        'directory', 'legal', 'about', 'press', 'api', 'jobs',
        'privacy', 'terms', 'help'
      ]);

      for (const link of links) {
        const href = link.getAttribute('href');
        if (!href) continue;

        // Nếu link nằm SAU "Suggested for you" → bỏ qua
        if (suggestedBoundary) {
          const position = suggestedBoundary.compareDocumentPosition(link);
          if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
            continue; // Link nằm sau phần suggested → skip
          }
        }

        // Match /<username>/ pattern
        const match = href.match(/^\/([a-zA-Z0-9._]{1,30})\/$/);
        if (!match) continue;

        const username = match[1];
        if (nonUserPaths.has(username)) continue;
        if (this.capturedUsers.find(u => u.username === username)) continue;

        // Kiểm tra thêm: bỏ qua nếu row có nút "Follow" (chưa follow = suggested)
        // Chỉ lấy row có nút "Following" hoặc "Requested" hoặc "Remove"
        const row = this.findUserRow(link);
        if (row && this.isSuggestedEntry(row)) {
          continue; // Đây là suggested user, không phải following/follower thật
        }

        // Extract thêm thông tin
        let displayName = '';
        let isVerified = false;

        if (row) {
          // Check verified badge trước
          isVerified = !!row.querySelector('svg[aria-label="Verified"], [title="Verified"]');

          // Tìm display name - cải thiện logic
          displayName = this.extractDisplayName(row, username, isVerified);
        }

        this.capturedUsers.push({
          username,
          displayName,
          isVerified,
          profileUrl: `https://www.instagram.com/${username}/`
        });
      }
    },

    /**
     * Tìm phần tử "Suggested for you" trong modal
     */
    findSuggestedBoundary(container) {
      // Tìm text "Suggested for you" hoặc tương đương
      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        null
      );

      while (walker.nextNode()) {
        const text = walker.currentNode.textContent.trim().toLowerCase();
        if (
          text === 'suggested for you' ||
          text === 'suggestions for you' ||
          text === 'suggested' ||
          text === 'gợi ý cho bạn' // Vietnamese Instagram
        ) {
          return walker.currentNode.parentElement;
        }
      }
      return null;
    },

    /**
     * Tìm row container chứa thông tin user
     */
    findUserRow(link) {
      // Đi lên DOM tree tìm row chứa cả username + button
      let el = link.parentElement;
      let depth = 0;
      while (el && depth < 6) {
        // Row thường chứa cả link username + button Follow/Following
        const buttons = el.querySelectorAll('button');
        const links = el.querySelectorAll('a[href]');
        if (buttons.length > 0 && links.length > 0) {
          return el;
        }
        el = el.parentElement;
        depth++;
      }
      return link.closest('div[class]') || link.parentElement;
    },

    /**
     * Kiểm tra xem entry này là "Suggested" hay là following/follower thật
     */
    isSuggestedEntry(row) {
      const buttons = row.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent.trim().toLowerCase();
        // Nút "Follow" (chưa follow) = suggested entry
        // Nút "Following", "Requested", "Remove" = real entry
        if (text === 'follow') {
          // Kiểm tra thêm: nếu có text "Suggested for you" trong row
          const rowText = row.textContent.toLowerCase();
          if (rowText.includes('suggested for you') || rowText.includes('gợi ý cho bạn')) {
            return true;
          }
          // Nút "Follow" đơn thuần có thể là follower chưa follow lại
          // Chỉ đánh dấu suggested nếu KHÔNG có "Remove" button
          const hasRemove = Array.from(buttons).some(b =>
            b.textContent.trim().toLowerCase() === 'remove'
          );
          if (!hasRemove && rowText.includes('suggested')) {
            return true;
          }
        }
      }
      return false;
    },

    /**
     * Extract display name chính xác hơn
     */
    extractDisplayName(row, username, isVerified) {
      // Tìm tất cả span elements
      const spans = row.querySelectorAll('span');
      const skipTexts = new Set([
        'follow', 'following', 'requested', 'remove',
        'verified', 'suggested for you', 'close friends',
        username, // Bỏ qua username
        '' // Bỏ qua empty
      ]);

      for (const span of spans) {
        // Chỉ lấy span lá (không chứa child elements phức tạp)
        if (span.querySelector('a, button, svg, img')) continue;

        const text = span.textContent.trim();
        const textLower = text.toLowerCase();

        // Bỏ qua nếu text trùng username hoặc là button text
        if (skipTexts.has(textLower)) continue;
        if (text.length === 0 || text.length > 60) continue;

        // Bỏ qua nếu text chứa username (e.g., "usernameVerified")
        if (textLower.includes(username.toLowerCase()) && text.length > username.length) continue;

        // Bỏ qua nếu chỉ là "Verified" text
        if (textLower === 'verified') continue;

        // Bỏ qua nếu text là số (e.g., follower count)
        if (/^\d+[,.\d]*[KkMm]?$/.test(text)) continue;

        // Đây có khả năng là display name
        return text;
      }
      return '';
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
      const profileData = this.extractProfileData();
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

    extractProfileData() {
      const data = {
        externalUrl: null,
        isPrivate: false,
        followerCount: 0,
        followingCount: 0,
        postCount: 0
      };

      // External URL
      const extLink = document.querySelector('a[rel="me nofollow noopener noreferrer"]') ||
        document.querySelector('header a[target="_blank"]');
      if (extLink) data.externalUrl = extLink.href;

      // Private account check
      const pageText = document.body.innerText;
      if (pageText.includes('This account is private') || pageText.includes('This Account is Private')) {
        data.isPrivate = true;
      }

      // Stats (followers, following, posts)
      const statLinks = document.querySelectorAll('header section ul li, header section a[href*="/"]');
      for (const el of statLinks) {
        const text = el.textContent.trim().toLowerCase();
        const numMatch = text.match(/([\d,.]+[kmb]?)/);
        if (numMatch) {
          const num = this.parseCount(numMatch[1]);
          if (text.includes('follower') && !text.includes('following')) data.followerCount = num;
          else if (text.includes('following')) data.followingCount = num;
          else if (text.includes('post')) data.postCount = num;
        }
      }

      return data;
    },

    parseCount(str) {
      str = str.replace(/,/g, '');
      const multipliers = { k: 1000, m: 1000000, b: 1000000000 };
      const match = str.match(/([\d.]+)([kmb])?/i);
      if (!match) return 0;
      const num = parseFloat(match[1]);
      const mult = match[2] ? multipliers[match[2].toLowerCase()] : 1;
      return Math.round(num * mult);
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
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

      notification.innerHTML = `
        <span class="ss-notification-icon">${icons[type] || icons.info}</span>
        <span class="ss-notification-text">${message}</span>
        <button class="ss-notification-close" onclick="this.parentElement.remove()">✕</button>
      `;

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
