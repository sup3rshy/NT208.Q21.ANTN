/**
 * SocialShield Dashboard
 * Quản lý giao diện dashboard đầy đủ
 */
(function () {
  'use strict';

  const Dashboard = {
    currentPage: 'overview',
    snapshotCache: {},

    // ==================== Initialization ====================

    async init() {
      this.bindNavigation();
      this.bindActions();
      await this.loadOverview();
      await this.loadCompareSelectors();
    },

    // ==================== Navigation ====================

    bindNavigation() {
      document.querySelectorAll('.ss-nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
          e.preventDefault();
          const page = item.dataset.page;
          this.navigateTo(page);
        });
      });
    },

    navigateTo(page) {
      // Update nav
      document.querySelectorAll('.ss-nav-item').forEach(n => n.classList.remove('active'));
      document.querySelector(`[data-page="${page}"]`).classList.add('active');

      // Update page
      document.querySelectorAll('.ss-page').forEach(p => p.classList.remove('active'));
      document.getElementById(`page-${page}`).classList.add('active');

      this.currentPage = page;

      // Load page data
      switch (page) {
        case 'overview': this.loadOverview(); break;
        case 'snapshots': this.loadSnapshots(); break;
        case 'compare': this.loadCompareSelectors(); break;
        case 'privacy': this.loadPrivacyScans(); break;
        case 'alerts': this.loadAlerts(); break;
        case 'settings': this.loadSettings(); break;
      }
    },

    // ==================== Overview Page ====================

    async loadOverview() {
      try {
        const stats = await SocialShieldStorage.getStats();
        document.getElementById('ov-snapshots').textContent = stats.totalSnapshots;
        document.getElementById('ov-profiles').textContent = stats.totalProfiles;
        document.getElementById('ov-scans').textContent = stats.totalPrivacyScans;
        document.getElementById('ov-alerts').textContent = stats.unreadAlerts;

        // Update alert badge
        const badge = document.getElementById('nav-alert-count');
        if (stats.unreadAlerts > 0) {
          badge.style.display = 'inline';
          badge.textContent = stats.unreadAlerts;
        } else {
          badge.style.display = 'none';
        }

        // Load recent activity
        await this.loadRecentActivity();
      } catch (e) {
        console.error('Error loading overview:', e);
      }
    },

    async loadRecentActivity() {
      const container = document.getElementById('ov-activity');
      const groups = await SocialShieldStorage.getAllSnapshotGroups();
      const alerts = await SocialShieldStorage.getAlerts(5);

      // Combine snapshots and alerts into activity feed
      const activities = [];

      for (const group of groups) {
        if (group.latestSnapshot) {
          activities.push({
            type: 'snapshot',
            icon: '📸',
            message: `Captured ${group.latestSnapshot.count} ${group.type} for @${group.username}`,
            timestamp: group.latestSnapshot.timestamp,
            platform: group.platform
          });
        }
      }

      for (const alert of alerts) {
        activities.push({
          type: 'alert',
          icon: '⚠️',
          message: alert.message || alert.title,
          timestamp: alert.timestamp,
          severity: alert.severity
        });
      }

      // Sắp xếp theo thời gian
      activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      if (activities.length === 0) {
        container.innerHTML = `
          <div class="ss-empty-state">
            <div class="ss-empty-icon">🛡️</div>
            <p>No activity yet. Navigate to Instagram and capture your first snapshot!</p>
          </div>
        `;
        return;
      }

      container.innerHTML = activities.slice(0, 10).map(a => `
        <div class="ss-alert-card ss-alert-card-${a.severity || 'info'}">
          <div class="ss-alert-card-icon">${a.icon}</div>
          <div class="ss-alert-card-content">
            <div class="ss-alert-card-message">${this.escapeHtml(a.message)}</div>
            <div class="ss-alert-card-time">${this.formatDate(a.timestamp)}</div>
          </div>
        </div>
      `).join('');
    },

    // ==================== Snapshots Page ====================

    async loadSnapshots() {
      const container = document.getElementById('snapshot-list');
      const groups = await SocialShieldStorage.getAllSnapshotGroups();

      if (groups.length === 0) {
        container.innerHTML = `
          <div class="ss-empty-state">
            <div class="ss-empty-icon">📸</div>
            <p>No snapshots yet. Go to an Instagram profile and click Capture.</p>
          </div>
        `;
        return;
      }

      let html = '';
      for (const group of groups) {
        const snapshots = await SocialShieldStorage.getSnapshots(group.platform, group.username, group.type);
        this.snapshotCache[group.key] = snapshots;

        html += `
          <div class="ss-snapshot-group">
            <div class="ss-snapshot-group-header">
              <span>@${this.escapeHtml(group.username)}</span>
              <span style="color: var(--text-secondary); font-weight: 400; font-size: 12px;">
                ${group.type} &middot; ${group.platform}
              </span>
            </div>
            ${snapshots.map((snap, i) => `
              <div class="ss-snapshot-item" data-snapshot-id="${snap.id}" data-group-key="${group.key}" data-index="${i}">
                <div class="ss-snapshot-info">
                  <div class="ss-snapshot-count">${snap.count} ${group.type}</div>
                  <div class="ss-snapshot-time">${this.formatDate(snap.timestamp)}</div>
                </div>
                <div class="ss-snapshot-actions">
                  <button class="ss-btn ss-btn-sm btn-view-snapshot" data-snapshot-id="${snap.id}" data-group-key="${group.key}" data-index="${i}">View</button>
                  <button class="ss-btn ss-btn-sm ss-btn-danger btn-delete-snapshot"
                    data-platform="${group.platform}" data-username="${group.username}"
                    data-type="${group.type}" data-snapshot-id="${snap.id}">Del</button>
                </div>
              </div>
            `).join('')}
          </div>
        `;
      }

      container.innerHTML = html;

      // Bind view buttons
      container.querySelectorAll('.btn-view-snapshot').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const key = btn.dataset.groupKey;
          const index = parseInt(btn.dataset.index);
          this.showSnapshotDetail(key, index);
        });
      });

      // Bind delete buttons
      container.querySelectorAll('.btn-delete-snapshot').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('Delete this snapshot?')) return;
          await SocialShieldStorage.deleteSnapshot(
            btn.dataset.platform, btn.dataset.username,
            btn.dataset.type, btn.dataset.snapshotId
          );
          this.loadSnapshots();
        });
      });
    },

    showSnapshotDetail(groupKey, index) {
      const snapshots = this.snapshotCache[groupKey];
      if (!snapshots || !snapshots[index]) return;

      const snap = snapshots[index];
      const modal = document.getElementById('snapshot-detail-modal');
      const title = document.getElementById('modal-snapshot-title');
      const body = document.getElementById('modal-snapshot-body');

      title.textContent = `@${snap.username} - ${snap.type} (${snap.count})`;
      body.innerHTML = `
        <div style="margin-bottom: 12px; font-size: 13px; color: var(--text-secondary);">
          Captured: ${this.formatDate(snap.timestamp)}
        </div>
        <div class="ss-user-list">
          ${snap.data.map(user => `
            <div class="ss-user-item">
              <a class="ss-user-link" href="https://www.instagram.com/${user.username}/" target="_blank">
                @${this.escapeHtml(user.username)}
              </a>
              ${user.isVerified ? '<span class="ss-verified-badge">✓</span>' : ''}
              ${user.displayName ? `<span class="ss-user-display-name">${this.escapeHtml(user.displayName)}</span>` : ''}
            </div>
          `).join('')}
        </div>
      `;

      modal.style.display = 'flex';

      // Close handlers
      const closeModal = () => { modal.style.display = 'none'; };
      document.getElementById('modal-close').onclick = closeModal;
      modal.querySelector('.ss-modal-overlay').onclick = closeModal;
    },

    // ==================== Compare Page ====================

    async loadCompareSelectors() {
      const groups = await SocialShieldStorage.getAllSnapshotGroups();
      const oldSelect = document.getElementById('compare-old');
      const newSelect = document.getElementById('compare-new');

      // Clear existing options
      oldSelect.innerHTML = '<option value="">Select snapshot...</option>';
      newSelect.innerHTML = '<option value="">Select snapshot...</option>';

      for (const group of groups) {
        const snapshots = await SocialShieldStorage.getSnapshots(group.platform, group.username, group.type);
        this.snapshotCache[group.key] = snapshots;

        for (const snap of snapshots) {
          const label = `@${snap.username} - ${snap.type} (${snap.count}) - ${this.formatDate(snap.timestamp)}`;
          const optOld = new Option(label, `${group.key}|${snap.id}`);
          const optNew = new Option(label, `${group.key}|${snap.id}`);
          oldSelect.add(optOld);
          newSelect.add(optNew);
        }
      }

      // Enable compare button when both are selected
      const updateBtn = () => {
        document.getElementById('btn-compare').disabled = !(oldSelect.value && newSelect.value);
      };
      oldSelect.addEventListener('change', updateBtn);
      newSelect.addEventListener('change', updateBtn);
    },

    async runCompare() {
      const oldVal = document.getElementById('compare-old').value;
      const newVal = document.getElementById('compare-new').value;
      if (!oldVal || !newVal) return;

      const [oldKey, oldId] = oldVal.split('|');
      const [newKey, newId] = newVal.split('|');

      const oldSnap = this.snapshotCache[oldKey]?.find(s => s.id === oldId);
      const newSnap = this.snapshotCache[newKey]?.find(s => s.id === newId);

      if (!oldSnap || !newSnap) {
        alert('Could not find selected snapshots');
        return;
      }

      const diff = SocialShieldDiff.compare(oldSnap, newSnap);
      const alerts = SocialShieldDiff.detectSuspicious(diff);

      this.renderDiffResults(diff, alerts);
    },

    renderDiffResults(diff, alerts) {
      const container = document.getElementById('diff-results');
      const content = document.getElementById('diff-content');
      container.style.display = 'block';

      let alertsHtml = '';
      if (alerts.length > 0) {
        alertsHtml = `
          <div style="margin-bottom: 16px;">
            ${alerts.map(a => `
              <div class="ss-alert-card ss-alert-card-${a.severity}" style="margin-bottom: 8px;">
                <div class="ss-alert-card-icon">⚠️</div>
                <div class="ss-alert-card-content">
                  <div class="ss-alert-card-title">${this.escapeHtml(a.title)}</div>
                  <div class="ss-alert-card-message">${this.escapeHtml(a.message)}</div>
                </div>
              </div>
            `).join('')}
          </div>
        `;
      }

      content.innerHTML = `
        ${alertsHtml}
        <div class="ss-diff-summary">
          <div class="ss-diff-stat">
            <div class="ss-diff-stat-value ss-diff-added">+${diff.summary.addedCount}</div>
            <div class="ss-diff-stat-label">Added</div>
          </div>
          <div class="ss-diff-stat">
            <div class="ss-diff-stat-value ss-diff-removed">-${diff.summary.removedCount}</div>
            <div class="ss-diff-stat-label">Removed</div>
          </div>
          <div class="ss-diff-stat">
            <div class="ss-diff-stat-value ss-diff-unchanged">${diff.summary.unchangedCount}</div>
            <div class="ss-diff-stat-label">Unchanged</div>
          </div>
        </div>

        <div style="text-align: center; margin-bottom: 16px; font-size: 13px; color: var(--text-secondary);">
          Net change: ${diff.summary.netChange > 0 ? '+' : ''}${diff.summary.netChange}
          &middot; Change rate: ${diff.summary.changeRate}%
          &middot; Time span: ${diff.summary.timeDiff}
        </div>

        ${diff.added.length > 0 ? `
          <div class="ss-diff-section">
            <div class="ss-diff-section-title ss-diff-added">
              ➕ New (${diff.added.length})
            </div>
            <div class="ss-user-list">
              ${diff.added.map(u => `
                <div class="ss-user-item ss-user-item-added">
                  <a class="ss-user-link" href="https://www.instagram.com/${u.username}/" target="_blank">@${this.escapeHtml(u.username)}</a>
                  ${u.displayName ? `<span class="ss-user-display-name">${this.escapeHtml(u.displayName)}</span>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${diff.removed.length > 0 ? `
          <div class="ss-diff-section">
            <div class="ss-diff-section-title ss-diff-removed">
              ➖ Removed (${diff.removed.length})
            </div>
            <div class="ss-user-list">
              ${diff.removed.map(u => `
                <div class="ss-user-item ss-user-item-removed">
                  <a class="ss-user-link" href="https://www.instagram.com/${u.username}/" target="_blank">@${this.escapeHtml(u.username)}</a>
                  ${u.displayName ? `<span class="ss-user-display-name">${this.escapeHtml(u.displayName)}</span>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${diff.added.length === 0 && diff.removed.length === 0 ? `
          <div class="ss-empty-state">
            <div class="ss-empty-icon">✅</div>
            <p>No changes detected between these snapshots.</p>
          </div>
        ` : ''}
      `;

      // Scroll to results
      container.scrollIntoView({ behavior: 'smooth' });
    },

    // ==================== Privacy Scans Page ====================

    async loadPrivacyScans() {
      const container = document.getElementById('privacy-list');
      const allData = await SocialShieldStorage.getAll();
      const privacyKeys = Object.keys(allData).filter(k => k.startsWith('privacy_'));

      if (privacyKeys.length === 0) {
        container.innerHTML = `
          <div class="ss-empty-state">
            <div class="ss-empty-icon">🔍</div>
            <p>No privacy scans yet. Run a scan on an Instagram profile.</p>
          </div>
        `;
        return;
      }

      let html = '';
      for (const key of privacyKeys) {
        const scans = allData[key] || [];
        for (const scan of scans.reverse()) {
          const riskClass = `ss-risk-${scan.riskScore >= 50 ? 'critical' : scan.riskScore >= 30 ? 'high' : scan.riskScore >= 15 ? 'medium' : 'low'}`;
          const riskLabel = scan.riskScore >= 50 ? 'Critical' : scan.riskScore >= 30 ? 'High' : scan.riskScore >= 15 ? 'Medium' : 'Low';

          html += `
            <div class="ss-privacy-card">
              <div class="ss-privacy-header">
                <span class="ss-privacy-profile">@${this.escapeHtml(scan.username)} (${scan.platform})</span>
                <span class="ss-privacy-risk ${riskClass}">${riskLabel} Risk (${scan.riskScore})</span>
              </div>
              <div class="ss-alert-card-time" style="margin-bottom: 10px;">${this.formatDate(scan.timestamp)}</div>
              ${scan.results.length === 0
              ? '<div style="color: var(--text-secondary); font-size: 13px;">No privacy issues found.</div>'
              : scan.results.map(f => `
                  <div class="ss-finding-item">
                    <span class="ss-finding-icon">${f.icon || '⚠️'}</span>
                    <div>
                      <div>${this.escapeHtml(f.title)}</div>
                      <div class="ss-finding-values">${f.values ? f.values.map(v => this.escapeHtml(v)).join(', ') : ''}</div>
                    </div>
                  </div>
                `).join('')
            }
            </div>
          `;
        }
      }

      container.innerHTML = html;
    },

    // ==================== Alerts Page ====================

    async loadAlerts() {
      const container = document.getElementById('alert-list');
      const alerts = await SocialShieldStorage.getAlerts(50);

      if (alerts.length === 0) {
        container.innerHTML = `
          <div class="ss-empty-state">
            <div class="ss-empty-icon">🔔</div>
            <p>No alerts yet. Alerts will appear when suspicious activity is detected.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = alerts.map(alert => `
        <div class="ss-alert-card ss-alert-card-${alert.severity} ${alert.read ? '' : 'unread'}">
          <div class="ss-alert-card-icon">
            ${alert.severity === 'danger' ? '🚨' : alert.severity === 'warning' ? '⚠️' : 'ℹ️'}
          </div>
          <div class="ss-alert-card-content">
            <div class="ss-alert-card-title">${this.escapeHtml(alert.title || alert.type)}</div>
            <div class="ss-alert-card-message">${this.escapeHtml(alert.message)}</div>
            <div class="ss-alert-card-time">${this.formatDate(alert.timestamp)}</div>
          </div>
        </div>
      `).join('');
    },

    // ==================== Settings Page ====================

    async loadSettings() {
      const settings = await SocialShieldStorage.getSettings();
      document.getElementById('setting-mass-follow').value = settings.suspiciousThreshold.massFollow;
      document.getElementById('setting-mass-unfollow').value = settings.suspiciousThreshold.massUnfollow;
      document.getElementById('setting-change-rate').value = settings.suspiciousThreshold.changeRate;
      document.getElementById('setting-notifications').checked = settings.notifications;
    },

    async saveSettings() {
      const settings = {
        notifications: document.getElementById('setting-notifications').checked,
        suspiciousThreshold: {
          massFollow: parseInt(document.getElementById('setting-mass-follow').value) || 20,
          massUnfollow: parseInt(document.getElementById('setting-mass-unfollow').value) || 10,
          changeRate: parseInt(document.getElementById('setting-change-rate').value) || 30
        }
      };
      await SocialShieldStorage.saveSettings(settings);
      alert('Settings saved!');
    },

    async exportData() {
      const allData = await SocialShieldStorage.getAll();
      const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `socialshield-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },

    async clearAllData() {
      if (!confirm('This will permanently delete ALL data (snapshots, scans, alerts, settings). Are you sure?')) return;
      if (!confirm('This action cannot be undone. Continue?')) return;
      await chrome.storage.local.clear();
      alert('All data cleared.');
      this.loadOverview();
    },

    // ==================== Event Binding ====================

    bindActions() {
      // Compare button
      document.getElementById('btn-compare').addEventListener('click', () => this.runCompare());

      // Settings
      document.getElementById('btn-save-settings').addEventListener('click', () => this.saveSettings());
      document.getElementById('btn-export').addEventListener('click', () => this.exportData());
      document.getElementById('btn-clear-all').addEventListener('click', () => this.clearAllData());

      // Clear snapshots
      document.getElementById('btn-clear-snapshots').addEventListener('click', async () => {
        if (!confirm('Delete all snapshots?')) return;
        const allData = await SocialShieldStorage.getAll();
        const snapshotKeys = Object.keys(allData).filter(k => k.startsWith('snapshots_'));
        for (const key of snapshotKeys) {
          await SocialShieldStorage.remove(key);
        }
        await SocialShieldStorage.remove('snapshot_index');
        this.loadSnapshots();
      });

      // Mark all alerts read
      document.getElementById('btn-mark-all-read').addEventListener('click', async () => {
        const alerts = await SocialShieldStorage.getAlerts();
        for (const alert of alerts) {
          await SocialShieldStorage.markAlertRead(alert.id);
        }
        this.loadAlerts();
        this.loadOverview();
      });

      // Modal close
      document.getElementById('modal-close').addEventListener('click', () => {
        document.getElementById('snapshot-detail-modal').style.display = 'none';
      });
    },

    // ==================== Utilities ====================

    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text || '';
      return div.innerHTML;
    },

    formatDate(timestamp) {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      const now = new Date();
      const diff = now - date;

      if (diff < 60000) return 'Just now';
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
      if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

      return date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  };

  document.addEventListener('DOMContentLoaded', () => Dashboard.init());
})();
