/**
 * SocialShield Popup Script
 * Quản lý giao diện popup khi click icon extension
 */
(function () {
  'use strict';

  const Popup = {
    currentTab: null,
    pageInfo: null,

    async init() {
      await this.getCurrentTab();
      await this.getPageInfo();
      await this.updateStatus();
      await this.loadStats();
      await this.loadAlerts();
      this.bindEvents();
    },

    // ==================== Tab & Page Info ====================

    async getCurrentTab() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      this.currentTab = tab;
      return tab;
    },

    async getPageInfo() {
      if (!this.currentTab) return;

      try {
        const response = await chrome.tabs.sendMessage(this.currentTab.id, {
          type: 'GET_PAGE_INFO'
        });
        this.pageInfo = response;
      } catch (e) {
        this.pageInfo = null;
      }
    },

    // ==================== UI Updates ====================

    async updateStatus() {
      const statusDot = document.querySelector('.ss-status-dot');
      const statusText = document.getElementById('ss-status-text');
      const profileSection = document.getElementById('ss-profile-section');
      const buttons = {
        following: document.getElementById('btn-capture-following'),
        followers: document.getElementById('btn-capture-followers'),
        privacy: document.getElementById('btn-privacy-scan'),
        links: document.getElementById('btn-link-scan')
      };

      const url = this.currentTab?.url || '';
      const isInstagram = url.includes('instagram.com');
      const isTwitter = url.includes('x.com') || url.includes('twitter.com');
      const isSupportedPlatform = isInstagram || isTwitter;
      const platformName = isTwitter ? 'Twitter/X' : 'Instagram';

      // Privacy + Link scan luôn enable (chạy được trên mọi page có DOM)
      // Capture following/followers chỉ enable trên IG/X
      buttons.privacy.disabled = false;
      buttons.links.disabled = false;
      buttons.following.disabled = !isSupportedPlatform;
      buttons.followers.disabled = !isSupportedPlatform;

      if (!isSupportedPlatform) {
        statusDot.className = 'ss-status-dot ss-dot-warning';
        statusText.textContent = 'Generic mode — Privacy/Link scan available';
        profileSection.style.display = 'none';
        return;
      }

      if (this.pageInfo?.isProfilePage) {
        statusDot.className = 'ss-status-dot ss-dot-active';
        statusText.textContent = `Active on ${platformName} profile`;
        profileSection.style.display = 'block';
        document.getElementById('ss-profile-username').textContent = `@${this.pageInfo.profile}`;

        if (this.pageInfo.isCapturing) {
          statusDot.className = 'ss-status-dot ss-dot-warning';
          statusText.textContent = 'Capture in progress...';
          buttons.following.disabled = true;
          buttons.followers.disabled = true;
        }
      } else {
        statusDot.className = 'ss-status-dot ss-dot-active';
        statusText.textContent = `Active on ${platformName} (not on a profile page)`;
        profileSection.style.display = 'none';
        buttons.following.disabled = true;
        buttons.followers.disabled = true;
      }
    },

    async loadStats() {
      try {
        const stats = await SocialShieldStorage.getStats();
        document.getElementById('stat-snapshots').textContent = stats.totalSnapshots;
        document.getElementById('stat-profiles').textContent = stats.totalProfiles;
        document.getElementById('stat-alerts').textContent = stats.unreadAlerts;

        // Highlight alerts nếu có unread
        if (stats.unreadAlerts > 0) {
          document.getElementById('stat-alerts').style.color = '#f59e0b';
        }
      } catch (e) {
        console.error('Error loading stats:', e);
      }
    },

    async loadAlerts() {
      try {
        const alerts = await SocialShieldStorage.getAlerts(5);
        const container = document.getElementById('ss-alert-list');
        const section = document.getElementById('ss-recent');

        if (alerts.length === 0) {
          section.style.display = 'none';
          return;
        }

        section.style.display = 'block';
        container.innerHTML = alerts.map(alert => `
          <div class="ss-alert-item">
            <div class="ss-alert-severity ss-severity-${alert.severity}"></div>
            <div class="ss-alert-message">${this.escapeHtml(alert.message || alert.title)}</div>
            <div class="ss-alert-time">${this.timeAgo(alert.timestamp)}</div>
          </div>
        `).join('');
      } catch (e) {
        console.error('Error loading alerts:', e);
      }
    },

    // ==================== Event Binding ====================

    bindEvents() {
      // Capture actions
      document.getElementById('btn-capture-following').addEventListener('click', () => {
        this.sendAction('capture-following');
      });

      document.getElementById('btn-capture-followers').addEventListener('click', () => {
        this.sendAction('capture-followers');
      });

      document.getElementById('btn-privacy-scan').addEventListener('click', () => {
        const url = this.currentTab?.url || '';
        const supported = url.includes('instagram.com') || url.includes('x.com') || url.includes('twitter.com');
        if (supported) this.sendAction('scan-privacy');
        else this.runGenericPrivacyScan();
      });

      document.getElementById('btn-link-scan').addEventListener('click', () => {
        const url = this.currentTab?.url || '';
        const supported = url.includes('instagram.com') || url.includes('x.com') || url.includes('twitter.com');
        if (supported) this.sendAction('scan-links');
        else this.runGenericLinkScan();
      });

      // Dashboard button
      document.getElementById('btn-dashboard').addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
        window.close();
      });
    },

    async sendAction(action) {
      if (!this.currentTab) return;

      try {
        await chrome.tabs.sendMessage(this.currentTab.id, {
          type: 'START_CAPTURE',
          action
        });
        // Close popup to let content script work
        window.close();
      } catch (e) {
        console.error('Error sending action:', e);
      }
    },

    // ==================== Generic Scans (any site) ====================

    /**
     * Privacy scan trên page bất kỳ:
     * dùng chrome.scripting.executeScript để bóc text từ active tab,
     * rồi chạy SocialShieldScanner.scanPrivacy ngay trong popup.
     */
    async runGenericPrivacyScan() {
      const out = document.getElementById('ss-inline-result');
      out.style.display = 'block';
      out.innerHTML = '<div style="color:#9ca3af;">⏳ Scanning page text...</div>';

      try {
        const [{ result: pageText } = {}] = await chrome.scripting.executeScript({
          target: { tabId: this.currentTab.id },
          func: () => (document.body?.innerText || '').slice(0, 50000),
        });

        if (!pageText) {
          out.innerHTML = '<div style="color:#fbbf24;">No text on this page.</div>';
          return;
        }

        const findings = [
          ...SocialShieldScanner.scanPrivacy(pageText),
          ...SocialShieldScanner.checkPasswordExposure(pageText),
        ];

        if (findings.length === 0) {
          out.innerHTML = '<div style="color:#00d4aa; font-weight:600;">✓ No PII detected on this page.</div>';
          return;
        }

        let html = `<div style="font-weight:600; margin-bottom:8px;">Found ${findings.length} issue(s) on this page:</div>`;
        for (const f of findings) {
          const sevColor = f.severity === 'critical' ? '#ef4444'
                        : f.severity === 'high' ? '#f97316'
                        : f.severity === 'medium' ? '#fbbf24' : '#9ca3af';
          html += `<div style="padding:6px 8px; margin-bottom:4px; border-left:3px solid ${sevColor}; background:rgba(255,255,255,0.03); border-radius:3px;">`;
          html += `<div style="font-weight:600;">${f.icon || '⚠'} ${this.escapeHtml(f.title)} <span style="font-size:10px; color:${sevColor};">[${f.severity}]</span></div>`;
          if (f.values && f.values.length) {
            html += `<div style="font-size:11px; font-family:monospace; color:#00d4aa; margin-top:2px;">${f.values.slice(0, 3).map(v => this.escapeHtml(String(v))).join(', ')}${f.values.length > 3 ? ` +${f.values.length - 3} more` : ''}</div>`;
          }
          html += `</div>`;
        }
        out.innerHTML = html;
      } catch (err) {
        out.innerHTML = `<div style="color:#ef4444;">Error: ${this.escapeHtml(err.message)}<br><span style="font-size:10px; color:#9ca3af;">Note: doesn't work on chrome:// or extension pages.</span></div>`;
      }
    },

    /**
     * Link scan trên page bất kỳ:
     * bóc tất cả href, chạy heuristic + (nếu có API key) Safe Browsing/VT/URLhaus.
     */
    async runGenericLinkScan() {
      const out = document.getElementById('ss-inline-result');
      out.style.display = 'block';
      out.innerHTML = '<div style="color:#9ca3af;">⏳ Collecting links...</div>';

      try {
        const [{ result: links } = {}] = await chrome.scripting.executeScript({
          target: { tabId: this.currentTab.id },
          func: () => {
            const set = new Set();
            document.querySelectorAll('a[href]').forEach(a => {
              const h = a.href;
              if (h && /^https?:/i.test(h)) set.add(h);
            });
            return [...set].slice(0, 100); // safety cap
          },
        });

        if (!links || links.length === 0) {
          out.innerHTML = '<div style="color:#fbbf24;">No links found on this page.</div>';
          return;
        }

        const settings = await SocialShieldStorage.getSettings();
        const opts = {};
        if (settings.safeBrowsingEnabled && settings.safeBrowsingApiKey) opts.safeBrowsingApiKey = settings.safeBrowsingApiKey;
        if (settings.virusTotalEnabled && settings.virusTotalApiKey) opts.virusTotalApiKey = settings.virusTotalApiKey;
        if (settings.urlhausEnabled && settings.urlhausAuthKey) opts.urlhausAuthKey = settings.urlhausAuthKey;
        const useFull = Object.keys(opts).length > 0;

        out.innerHTML = `<div style="color:#9ca3af;">⏳ Checking ${links.length} link(s)${useFull ? ' with threat intel' : ' (heuristic only)'}...</div>`;

        const results = [];
        // Heuristic-only nhanh, có API key thì chạy nối tiếp tránh rate limit
        if (!useFull) {
          for (const url of links) results.push({ ...SocialShieldScanner.checkLink(url), url });
        } else {
          for (const url of links) {
            const r = await SocialShieldScanner.checkLinkFull(url, opts);
            results.push({ ...r, url });
          }
        }

        const unsafe = results.filter(r => !r.safe);
        const warnings = results.filter(r => r.safe && r.warnings?.length > 0);

        let html = `<div style="margin-bottom:8px;"><b>${results.length}</b> link(s) checked — <span style="color:#ef4444;">${unsafe.length} unsafe</span>, <span style="color:#fbbf24;">${warnings.length} suspicious</span>, <span style="color:#00d4aa;">${results.length - unsafe.length - warnings.length} safe</span>.</div>`;

        if (unsafe.length > 0) {
          html += '<div style="font-weight:600; margin:6px 0;">Unsafe:</div>';
          for (const r of unsafe.slice(0, 8)) {
            html += `<div style="padding:6px; margin-bottom:4px; border-left:3px solid #ef4444; background:rgba(239,68,68,0.08); border-radius:3px;">`;
            html += `<div style="word-break:break-all; font-family:monospace; font-size:11px;">${this.escapeHtml(r.url.substring(0, 80))}</div>`;
            html += `<div style="font-size:11px; color:#ef4444;">${(r.warnings || []).map(w => this.escapeHtml(w.message)).join('; ')}</div>`;
            html += `</div>`;
          }
        }
        if (warnings.length > 0 && unsafe.length < 3) {
          html += '<div style="font-weight:600; margin:6px 0;">Suspicious:</div>';
          for (const r of warnings.slice(0, 5)) {
            html += `<div style="padding:6px; margin-bottom:4px; border-left:3px solid #fbbf24; background:rgba(251,191,36,0.06); border-radius:3px;">`;
            html += `<div style="word-break:break-all; font-family:monospace; font-size:11px;">${this.escapeHtml(r.url.substring(0, 80))}</div>`;
            html += `<div style="font-size:11px; color:#fbbf24;">${(r.warnings || []).map(w => this.escapeHtml(w.message)).slice(0, 2).join('; ')}</div>`;
            html += `</div>`;
          }
        }
        out.innerHTML = html;
      } catch (err) {
        out.innerHTML = `<div style="color:#ef4444;">Error: ${this.escapeHtml(err.message)}<br><span style="font-size:10px; color:#9ca3af;">Note: doesn't work on chrome:// or extension pages.</span></div>`;
      }
    },

    // ==================== Utilities ====================

    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    },

    timeAgo(timestamp) {
      const seconds = Math.floor((Date.now() - new Date(timestamp)) / 1000);
      if (seconds < 60) return 'now';
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `${minutes}m`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours}h`;
      const days = Math.floor(hours / 24);
      return `${days}d`;
    }
  };

  // Init khi DOM ready
  document.addEventListener('DOMContentLoaded', () => Popup.init());
})();
