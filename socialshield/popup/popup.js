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

      if (!isSupportedPlatform) {
        statusDot.className = 'ss-status-dot ss-dot-inactive';
        statusText.textContent = 'Navigate to Instagram or Twitter/X to use SocialShield';
        profileSection.style.display = 'none';
        Object.values(buttons).forEach(btn => btn.disabled = true);
        return;
      }

      if (this.pageInfo?.isProfilePage) {
        statusDot.className = 'ss-status-dot ss-dot-active';
        statusText.textContent = `Active on ${platformName} profile`;
        profileSection.style.display = 'block';
        document.getElementById('ss-profile-username').textContent = `@${this.pageInfo.profile}`;

        // Enable tất cả buttons
        Object.values(buttons).forEach(btn => btn.disabled = false);

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

        // Chỉ enable link scan (hoạt động trên mọi trang)
        buttons.following.disabled = true;
        buttons.followers.disabled = true;
        buttons.privacy.disabled = true;
        buttons.links.disabled = false;
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
        this.sendAction('scan-privacy');
      });

      document.getElementById('btn-link-scan').addEventListener('click', () => {
        this.sendAction('scan-links');
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
