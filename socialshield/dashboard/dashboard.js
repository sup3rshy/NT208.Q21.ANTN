/**
 * SocialShield Dashboard
 * Quản lý giao diện dashboard đầy đủ
 */
(function () {
  'use strict';

  const Dashboard = {
    currentPage: 'overview',
    snapshotCache: {},
    timelineChart: null,

    // ==================== Initialization ====================

    async init() {
      this.bindNavigation();
      this.bindActions();
      this.initThemeToggle();
      await this.loadOverview();
      await this.loadCompareSelectors();
    },

    // ==================== Theme Toggle ====================

    initThemeToggle() {
      const toggle = document.getElementById('theme-toggle');
      const label = document.getElementById('theme-label');
      if (!toggle) return;

      // Load saved theme preference
      const savedTheme = localStorage.getItem('ss-theme') || 'dark';
      if (savedTheme === 'light') {
        document.body.classList.add('ss-light-theme');
        toggle.textContent = '☀️';
        label.textContent = 'Light Mode';
      }

      toggle.addEventListener('click', () => {
        const isLight = document.body.classList.toggle('ss-light-theme');
        toggle.textContent = isLight ? '☀️' : '🌙';
        label.textContent = isLight ? 'Light Mode' : 'Dark Mode';
        localStorage.setItem('ss-theme', isLight ? 'light' : 'dark');
      });
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
        case 'security': this.loadSecurityScore(); break;
        case 'tools': this.initToolsPage(); break;
        case 'doxxing': this.loadDoxxingReports(); break;
        case 'about': break; // Static page, no data loading needed
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

        // Load recent activity + timeline
        await this.loadRecentActivity();
        await this.loadTimelineChart();
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
          const pLabel = group.platform === 'twitter' ? 'Twitter/X' : 'Instagram';
          activities.push({
            type: 'snapshot',
            icon: group.platform === 'twitter' ? '🐦' : '📷',
            message: `[${pLabel}] Captured ${group.latestSnapshot.count} ${group.type} for @${group.username}`,
            timestamp: group.latestSnapshot.timestamp,
            platform: group.platform
          });
        }
      }

      for (const alert of alerts) {
        const profileTag = alert.username ? `[@${alert.username}] ` : '';
        activities.push({
          type: 'alert',
          icon: '⚠️',
          message: `${profileTag}${alert.message || alert.title}`,
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
            <p>No activity yet. Navigate to Instagram or Twitter/X and capture your first snapshot!</p>
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

    // ==================== Timeline Chart ====================

    async loadTimelineChart() {
      const groups = await SocialShieldStorage.getAllSnapshotGroups();
      const profileSelect = document.getElementById('timeline-profile');
      const canvas = document.getElementById('timeline-chart');
      const empty = document.getElementById('timeline-empty');

      // Populate profile selector
      profileSelect.innerHTML = '<option value="">Select profile...</option>';
      const validGroups = [];
      for (const group of groups) {
        const snapshots = await SocialShieldStorage.getSnapshots(group.platform, group.username, group.type);
        if (snapshots.length >= 2) {
          validGroups.push({ ...group, snapshots });
          const label = `@${group.username} - ${group.type} (${this.platformLabel(group.platform)})`;
          profileSelect.add(new Option(label, group.key));
        }
      }

      // Remove old listener by cloning
      const newSelect = profileSelect.cloneNode(true);
      profileSelect.parentNode.replaceChild(newSelect, profileSelect);

      newSelect.addEventListener('change', () => {
        const key = newSelect.value;
        if (!key) {
          canvas.style.display = 'none';
          empty.style.display = '';
          if (this.timelineChart) { this.timelineChart.destroy(); this.timelineChart = null; }
          return;
        }
        const group = validGroups.find(g => g.key === key);
        if (group) this.renderTimelineChart(group.snapshots);
      });

      // Auto-select first if available
      if (validGroups.length > 0) {
        newSelect.value = validGroups[0].key;
        this.renderTimelineChart(validGroups[0].snapshots);
      } else {
        canvas.style.display = 'none';
        empty.style.display = '';
      }
    },

    renderTimelineChart(snapshots) {
      const canvas = document.getElementById('timeline-chart');
      const empty = document.getElementById('timeline-empty');
      canvas.style.display = '';
      empty.style.display = 'none';

      const timeline = SocialShieldDiff.buildTimeline(snapshots);
      const labels = timeline.map(t => {
        const d = new Date(t.timestamp);
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' +
               d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      });
      const counts = timeline.map(t => t.count);
      const changes = timeline.map(t => t.change);

      if (this.timelineChart) this.timelineChart.destroy();

      this.timelineChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Total Count',
              data: counts,
              borderColor: '#00d4aa',
              backgroundColor: 'rgba(0, 212, 170, 0.1)',
              fill: true,
              tension: 0.3,
              pointRadius: 4,
              pointBackgroundColor: '#00d4aa',
              yAxisID: 'y'
            },
            {
              label: 'Change',
              data: changes,
              type: 'bar',
              backgroundColor: changes.map(c => c > 0 ? 'rgba(16, 185, 129, 0.6)' : c < 0 ? 'rgba(239, 68, 68, 0.6)' : 'rgba(136, 136, 170, 0.3)'),
              borderRadius: 3,
              yAxisID: 'y1'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { intersect: false, mode: 'index' },
          plugins: {
            legend: {
              labels: { color: '#8888aa', font: { size: 12 } }
            },
            tooltip: {
              backgroundColor: '#1a1a35',
              titleColor: '#e8e8f0',
              bodyColor: '#8888aa',
              borderColor: 'rgba(255,255,255,0.06)',
              borderWidth: 1
            }
          },
          scales: {
            x: {
              ticks: { color: '#555577', font: { size: 10 }, maxRotation: 45 },
              grid: { color: 'rgba(255,255,255,0.04)' }
            },
            y: {
              position: 'left',
              ticks: { color: '#8888aa' },
              grid: { color: 'rgba(255,255,255,0.04)' },
              title: { display: true, text: 'Total', color: '#8888aa' }
            },
            y1: {
              position: 'right',
              ticks: { color: '#8888aa' },
              grid: { drawOnChartArea: false },
              title: { display: true, text: 'Change', color: '#8888aa' }
            }
          }
        }
      });
    },

    // ==================== Snapshots Page ====================

    async loadSnapshots() {
      const container = document.getElementById('snapshot-list');
      const groups = await SocialShieldStorage.getAllSnapshotGroups();

      if (groups.length === 0) {
        container.innerHTML = `
          <div class="ss-empty-state">
            <div class="ss-empty-icon">📸</div>
            <p>No snapshots yet. Go to an Instagram or Twitter/X profile and click Capture.</p>
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
              <span>${this.platformIcon(group.platform)} @${this.escapeHtml(group.username)}</span>
              <span style="color: var(--text-secondary); font-weight: 400; font-size: 12px;">
                ${group.type} &middot; ${this.platformLabel(group.platform)}
              </span>
            </div>
            ${snapshots.map((snap, i) => {
              const ba = SocialShieldDiff.analyzeBots(snap.data);
              const realCount = ba.totalAnalyzed - ba.botCount;
              const botLabel = ba.botCount > 0
                ? ` <span style="font-size: 11px; color: var(--text-secondary);">(${realCount} real, <span style="color: #ef4444;">${ba.botCount} bot</span>)</span>`
                : '';
              return `
              <div class="ss-snapshot-item" data-snapshot-id="${snap.id}" data-group-key="${group.key}" data-index="${i}">
                <div class="ss-snapshot-info">
                  <div class="ss-snapshot-count">${snap.count} ${group.type}${botLabel}</div>
                  <div class="ss-snapshot-time">${this.formatDate(snap.timestamp)}</div>
                </div>
                <div class="ss-snapshot-actions">
                  <button class="ss-btn ss-btn-sm btn-view-snapshot" data-snapshot-id="${snap.id}" data-group-key="${group.key}" data-index="${i}">View</button>
                  <button class="ss-btn ss-btn-sm ss-btn-danger btn-delete-snapshot"
                    data-platform="${group.platform}" data-username="${group.username}"
                    data-type="${group.type}" data-snapshot-id="${snap.id}">Del</button>
                </div>
              </div>
            `;}).join('')}
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

      // Run bot analysis
      const botAnalysis = SocialShieldDiff.analyzeBots(snap.data);

      const realCount = botAnalysis.totalAnalyzed - botAnalysis.botCount;
      const botBarWidth = botAnalysis.totalAnalyzed > 0 ? (botAnalysis.botCount / botAnalysis.totalAnalyzed * 100) : 0;
      const botSummaryHtml = `
        <div style="margin-bottom: 16px; padding: 14px; border-radius: 8px; background: ${botAnalysis.botRatio > 20 ? 'rgba(239,68,68,0.1)' : botAnalysis.botCount > 0 ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)'}; border: 1px solid ${botAnalysis.botRatio > 20 ? 'rgba(239,68,68,0.3)' : botAnalysis.botCount > 0 ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.3)'};">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <div style="text-align: center;">
              <div style="font-size: 22px; font-weight: 700; color: #10b981;">${realCount}</div>
              <div style="font-size: 11px; color: var(--text-secondary);">Real Users</div>
            </div>
            <div style="text-align: center;">
              <div style="font-size: 22px; font-weight: 700; color: ${botAnalysis.botCount > 0 ? '#ef4444' : '#8888aa'};">${botAnalysis.botCount}</div>
              <div style="font-size: 11px; color: var(--text-secondary);">Suspected Bots</div>
            </div>
            <div style="text-align: center;">
              <div style="font-size: 22px; font-weight: 700; color: var(--text-primary);">${botAnalysis.botRatio}%</div>
              <div style="font-size: 11px; color: var(--text-secondary);">Bot Ratio</div>
            </div>
          </div>
          <div style="height: 6px; background: #10b981; border-radius: 3px; overflow: hidden;">
            <div style="height: 100%; width: ${botBarWidth}%; background: #ef4444; float: right; border-radius: 3px;"></div>
          </div>
          <div style="font-size: 12px; color: var(--text-secondary); margin-top: 6px;">${this.escapeHtml(botAnalysis.summary)}</div>
        </div>
      `;

      title.textContent = `${this.platformIcon(snap.platform)} @${snap.username} - ${snap.type} (${snap.count}) · ${this.platformLabel(snap.platform)}`;
      body.innerHTML = `
        <div style="margin-bottom: 12px; font-size: 13px; color: var(--text-secondary);">
          Captured: ${this.formatDate(snap.timestamp)}
        </div>
        ${botSummaryHtml}
        <div class="ss-user-list">
          ${snap.data.map(user => {
            const bot = SocialShieldDiff.scoreBotLikelihood(user);
            const botTag = bot.isLikelyBot
              ? `<span style="background: rgba(239,68,68,0.15); color: #ef4444; font-size: 10px; padding: 2px 6px; border-radius: 4px; margin-left: 6px;" title="${this.escapeHtml(bot.reasons.join(', '))}">BOT ${bot.score}%</span>`
              : '';
            const userUrl = this.safeHref(user.profileUrl) !== '#' ? this.safeHref(user.profileUrl) : this.profileUrl(user.username, snap.platform);
            return `
              <div class="ss-user-item" ${bot.isLikelyBot ? 'style="border-left: 2px solid #ef4444; padding-left: 8px;"' : ''}>
                <a class="ss-user-link" href="${userUrl}" target="_blank">
                  @${this.escapeHtml(user.username)}
                </a>
                ${user.isVerified ? '<span class="ss-verified-badge">✓</span>' : ''}
                ${user.displayName ? `<span class="ss-user-display-name">${this.escapeHtml(user.displayName)}</span>` : ''}
                ${botTag}
              </div>
            `;
          }).join('')}
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
      const profileSelect = document.getElementById('compare-profile');
      const oldSelect = document.getElementById('compare-old');
      const newSelect = document.getElementById('compare-new');

      // Reset tất cả
      profileSelect.innerHTML = '<option value="">Select profile first...</option>';
      oldSelect.innerHTML = '<option value="">Select profile first...</option>';
      newSelect.innerHTML = '<option value="">Select profile first...</option>';
      oldSelect.disabled = true;
      newSelect.disabled = true;
      document.getElementById('btn-compare').disabled = true;

      // Cache tất cả snapshots
      for (const group of groups) {
        const snapshots = await SocialShieldStorage.getSnapshots(group.platform, group.username, group.type);
        this.snapshotCache[group.key] = snapshots;
      }

      // Populate profile selector - chỉ hiện profile có >= 2 snapshots (mới compare được)
      const validGroups = groups.filter(g => (this.snapshotCache[g.key]?.length || 0) >= 2);

      if (validGroups.length === 0) {
        profileSelect.innerHTML = '<option value="">No profiles with 2+ snapshots...</option>';
        return;
      }

      for (const group of validGroups) {
        const count = this.snapshotCache[group.key]?.length || 0;
        const label = `@${group.username} - ${group.type} (${count} snapshots) · ${this.platformLabel(group.platform)}`;
        profileSelect.add(new Option(label, group.key));
      }

      // Clone + replace để xóa event listeners cũ (tránh stack khi navigate lại)
      const newProfileSelect = profileSelect.cloneNode(true);
      profileSelect.parentNode.replaceChild(newProfileSelect, profileSelect);
      const newOldSelect = oldSelect.cloneNode(true);
      oldSelect.parentNode.replaceChild(newOldSelect, oldSelect);
      const newNewSelect = newSelect.cloneNode(true);
      newSelect.parentNode.replaceChild(newNewSelect, newSelect);

      // Khi chọn profile → populate old/new dropdowns với snapshot cùng profile
      newProfileSelect.addEventListener('change', () => {
        const selectedKey = newProfileSelect.value;
        newOldSelect.innerHTML = '<option value="">Select older snapshot...</option>';
        newNewSelect.innerHTML = '<option value="">Select newer snapshot...</option>';
        document.getElementById('btn-compare').disabled = true;
        document.getElementById('diff-results').style.display = 'none';

        if (!selectedKey) {
          newOldSelect.disabled = true;
          newNewSelect.disabled = true;
          return;
        }

        const snapshots = this.snapshotCache[selectedKey] || [];
        newOldSelect.disabled = false;
        newNewSelect.disabled = false;

        for (const snap of snapshots) {
          const label = `${snap.count} ${snap.type} - ${this.formatDate(snap.timestamp)}`;
          newOldSelect.add(new Option(label, snap.id));
          newNewSelect.add(new Option(label, snap.id));
        }
      });

      // Enable compare button khi cả 2 đều đã chọn + khác nhau
      const updateBtn = () => {
        const canCompare = newOldSelect.value && newNewSelect.value && newOldSelect.value !== newNewSelect.value;
        document.getElementById('btn-compare').disabled = !canCompare;
      };
      newOldSelect.addEventListener('change', updateBtn);
      newNewSelect.addEventListener('change', updateBtn);
    },

    async runCompare() {
      const profileKey = document.getElementById('compare-profile').value;
      const oldId = document.getElementById('compare-old').value;
      const newId = document.getElementById('compare-new').value;
      if (!profileKey || !oldId || !newId) return;

      if (oldId === newId) {
        alert('Please select two different snapshots to compare.');
        return;
      }

      const snapshots = this.snapshotCache[profileKey] || [];
      const oldSnap = snapshots.find(s => s.id === oldId);
      const newSnap = snapshots.find(s => s.id === newId);

      if (!oldSnap || !newSnap) {
        alert('Could not find selected snapshots');
        return;
      }

      const diff = SocialShieldDiff.compare(oldSnap, newSnap);
      const alerts = SocialShieldDiff.detectSuspicious(diff);

      this.renderDiffResults(diff, alerts, oldSnap, newSnap);
    },

    renderDiffResults(diff, alerts, oldSnap, newSnap) {
      const container = document.getElementById('diff-results');
      const content = document.getElementById('diff-content');
      container.style.display = 'block';

      // Header hiển thị profile info
      const profileInfo = oldSnap ? `
        <div style="text-align: center; margin-bottom: 16px; padding: 12px; background: rgba(0,212,170,0.08); border-radius: 8px;">
          <div style="font-size: 16px; font-weight: 600; color: var(--accent);">
            @${this.escapeHtml(oldSnap.username)}
          </div>
          <div style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">
            ${oldSnap.type} &middot; ${this.platformLabel(oldSnap.platform)}
          </div>
        </div>
      ` : '';

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
        ${profileInfo}
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
              ${diff.added.map(u => {
                const addedUrl = this.safeHref(u.profileUrl) !== '#' ? this.safeHref(u.profileUrl) : this.profileUrl(u.username, oldSnap.platform);
                return `
                <div class="ss-user-item ss-user-item-added">
                  <a class="ss-user-link" href="${addedUrl}" target="_blank">@${this.escapeHtml(u.username)}</a>
                  ${u.displayName ? `<span class="ss-user-display-name">${this.escapeHtml(u.displayName)}</span>` : ''}
                </div>
              `;}).join('')}
            </div>
          </div>
        ` : ''}

        ${diff.removed.length > 0 ? `
          <div class="ss-diff-section">
            <div class="ss-diff-section-title ss-diff-removed">
              ➖ Removed (${diff.removed.length})
            </div>
            <div class="ss-user-list">
              ${diff.removed.map(u => {
                const removedUrl = this.safeHref(u.profileUrl) !== '#' ? this.safeHref(u.profileUrl) : this.profileUrl(u.username, oldSnap.platform);
                return `
                <div class="ss-user-item ss-user-item-removed">
                  <a class="ss-user-link" href="${removedUrl}" target="_blank">@${this.escapeHtml(u.username)}</a>
                  ${u.displayName ? `<span class="ss-user-display-name">${this.escapeHtml(u.displayName)}</span>` : ''}
                </div>
              `;}).join('')}
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
            <p>No privacy scans yet. Run a scan on a social media profile.</p>
          </div>
        `;
        return;
      }

      let html = '';
      for (const key of privacyKeys) {
        const scans = allData[key] || [];
        for (const scan of [...scans].reverse()) {
          const riskClass = `ss-risk-${scan.riskScore >= 50 ? 'critical' : scan.riskScore >= 30 ? 'high' : scan.riskScore >= 15 ? 'medium' : 'low'}`;
          const riskLabel = scan.riskScore >= 50 ? 'Critical' : scan.riskScore >= 30 ? 'High' : scan.riskScore >= 15 ? 'Medium' : 'Low';

          html += `
            <div class="ss-privacy-card">
              <div class="ss-privacy-header">
                <span class="ss-privacy-profile">${this.platformIcon(scan.platform)} @${this.escapeHtml(scan.username)} (${this.platformLabel(scan.platform)})</span>
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
            ${alert.username ? `
              <div class="ss-alert-card-profile" style="font-size: 12px; color: var(--accent); font-weight: 600; margin-bottom: 2px;">
                @${this.escapeHtml(alert.username)}
                <span style="color: var(--text-secondary); font-weight: 400;">
                  &middot; ${this.escapeHtml(alert.snapshotType || '')} &middot; ${this.platformLabel(alert.platform || '')}
                </span>
              </div>
            ` : ''}
            <div class="ss-alert-card-title">${this.escapeHtml(alert.title || alert.type)}</div>
            <div class="ss-alert-card-message">${this.escapeHtml(alert.message)}</div>
            <div class="ss-alert-card-time">${this.formatDate(alert.timestamp)}</div>
          </div>
        </div>
      `).join('');
    },

    // ==================== Security Score Page ====================

    async loadSecurityScore() {
      const allData = await SocialShieldStorage.getAll();
      const snapshotKeys = Object.keys(allData).filter(k => k.startsWith('snapshots_'));
      const privacyKeys = Object.keys(allData).filter(k => k.startsWith('privacy_'));
      const profileKeys = Object.keys(allData).filter(k => k.startsWith('profile_'));
      const alerts = allData.alerts || [];

      let score = 100; // Start perfect, deduct for issues
      const breakdown = [];

      // 1. Privacy findings penalty
      let totalFindings = 0;
      let criticalFindings = 0;
      for (const key of privacyKeys) {
        const scans = allData[key] || [];
        if (scans.length > 0) {
          const latest = scans[scans.length - 1];
          for (const f of (latest.results || [])) {
            totalFindings++;
            if (f.severity === 'critical') { score -= 15; criticalFindings++; }
            else if (f.severity === 'high') score -= 8;
            else if (f.severity === 'medium') score -= 4;
            else score -= 2;
          }
        }
      }
      breakdown.push({
        label: 'Privacy Issues',
        detail: totalFindings === 0 ? 'No PII exposed' : `${totalFindings} issue(s) found (${criticalFindings} critical)`,
        status: totalFindings === 0 ? 'good' : criticalFindings > 0 ? 'bad' : 'warn'
      });

      // 2. Unresolved alerts penalty
      const unreadAlerts = alerts.filter(a => !a.read).length;
      const dangerAlerts = alerts.filter(a => a.severity === 'danger' && !a.read).length;
      score -= unreadAlerts * 3;
      score -= dangerAlerts * 5;
      breakdown.push({
        label: 'Active Alerts',
        detail: unreadAlerts === 0 ? 'All alerts resolved' : `${unreadAlerts} unresolved (${dangerAlerts} critical)`,
        status: unreadAlerts === 0 ? 'good' : dangerAlerts > 0 ? 'bad' : 'warn'
      });

      // 3. Bot ratio check
      let worstBotRatio = 0;
      for (const key of snapshotKeys) {
        const snapshots = allData[key] || [];
        if (snapshots.length > 0) {
          const latest = snapshots[snapshots.length - 1];
          const ba = SocialShieldDiff.analyzeBots(latest.data || []);
          if (ba.botRatio > worstBotRatio) worstBotRatio = ba.botRatio;
        }
      }
      if (worstBotRatio > 30) score -= 15;
      else if (worstBotRatio > 10) score -= 5;
      breakdown.push({
        label: 'Bot Exposure',
        detail: worstBotRatio === 0 ? 'No bots detected' : `Worst bot ratio: ${worstBotRatio}%`,
        status: worstBotRatio <= 10 ? 'good' : worstBotRatio <= 30 ? 'warn' : 'bad'
      });

      // 4. Profile changes
      let totalChanges = 0;
      for (const key of profileKeys) {
        const history = allData[key] || [];
        for (const entry of history) {
          totalChanges += (entry.changes || []).length;
        }
      }
      if (totalChanges > 5) score -= 5;
      breakdown.push({
        label: 'Profile Stability',
        detail: totalChanges === 0 ? 'No profile changes detected' : `${totalChanges} change(s) tracked`,
        status: totalChanges <= 2 ? 'good' : totalChanges <= 5 ? 'warn' : 'bad'
      });

      // 5. Monitoring coverage
      const hasRecentCapture = snapshotKeys.some(k => {
        const snaps = allData[k] || [];
        if (snaps.length === 0) return false;
        const latest = snaps[snaps.length - 1];
        return (Date.now() - (latest.createdAt || 0)) < 7 * 24 * 60 * 60 * 1000; // 7 days
      });
      if (!hasRecentCapture && snapshotKeys.length > 0) score -= 10;
      breakdown.push({
        label: 'Monitoring Freshness',
        detail: hasRecentCapture ? 'Recent captures available' : snapshotKeys.length === 0 ? 'No captures yet' : 'No captures in last 7 days',
        status: hasRecentCapture ? 'good' : 'warn'
      });

      score = Math.max(0, Math.min(100, score));

      // Render score
      const scoreEl = document.getElementById('security-score-value');
      const labelEl = document.getElementById('security-score-label');
      const subtitleEl = document.getElementById('security-score-subtitle');
      const circleEl = document.getElementById('security-score-circle');

      scoreEl.textContent = score;
      const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : score >= 40 ? '#f97316' : '#ef4444';
      const label = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Needs Attention' : 'At Risk';
      labelEl.textContent = label;
      labelEl.style.color = color;
      scoreEl.style.color = color;
      circleEl.style.borderColor = color;
      subtitleEl.textContent = `Based on ${snapshotKeys.length} capture group(s), ${privacyKeys.length} scan(s), ${alerts.length} alert(s)`;

      // Render breakdown
      const breakdownEl = document.getElementById('security-breakdown');
      breakdownEl.innerHTML = breakdown.map(b => {
        const icon = b.status === 'good' ? '✅' : b.status === 'warn' ? '⚠️' : '❌';
        const barColor = b.status === 'good' ? '#10b981' : b.status === 'warn' ? '#f59e0b' : '#ef4444';
        return `
          <div style="display: flex; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
            <span style="font-size: 18px; margin-right: 12px;">${icon}</span>
            <div style="flex: 1;">
              <div style="font-weight: 600; color: var(--text-primary); font-size: 14px;">${this.escapeHtml(b.label)}</div>
              <div style="font-size: 12px; color: var(--text-secondary);">${this.escapeHtml(b.detail)}</div>
            </div>
            <div style="width: 8px; height: 8px; border-radius: 50%; background: ${barColor};"></div>
          </div>
        `;
      }).join('');

      // Render profile changes
      await this.renderProfileChanges(allData, profileKeys);

      // Render recommendations
      this.renderSecurityRecommendations(score, breakdown, allData);
    },

    async renderProfileChanges(allData, profileKeys) {
      const container = document.getElementById('profile-changes-list');
      const allChanges = [];

      for (const key of profileKeys) {
        const history = allData[key] || [];
        const parts = key.replace('profile_', '').split('_');
        const platform = parts[0];
        const username = parts.slice(1).join('_');

        for (const entry of history) {
          if (entry.changes && entry.changes.length > 0) {
            allChanges.push({ platform, username, timestamp: entry.timestamp, changes: entry.changes });
          }
        }
      }

      allChanges.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      if (allChanges.length === 0) {
        container.innerHTML = '<div style="color: var(--text-secondary); font-size: 13px; padding: 8px 0;">No profile changes recorded yet.</div>';
        return;
      }

      container.innerHTML = allChanges.slice(0, 20).map(c => `
        <div style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span style="font-weight: 600; color: var(--accent);">${this.platformIcon(c.platform)} @${this.escapeHtml(c.username)} <span style="color: var(--text-secondary); font-weight: 400; font-size: 12px;">${this.platformLabel(c.platform)}</span></span>
            <span style="font-size: 12px; color: var(--text-secondary);">${this.formatDate(c.timestamp)}</span>
          </div>
          ${c.changes.map(ch => `
            <div style="font-size: 12px; padding: 4px 0 4px 16px; color: var(--text-secondary);">
              <strong>${this.escapeHtml(ch.label)}:</strong>
              <span style="color: #ef4444; text-decoration: line-through;">${this.escapeHtml(String(ch.oldValue).substring(0, 60))}</span>
              → <span style="color: #10b981;">${this.escapeHtml(String(ch.newValue).substring(0, 60))}</span>
            </div>
          `).join('')}
        </div>
      `).join('');
    },

    renderSecurityRecommendations(score, breakdown, allData) {
      const container = document.getElementById('security-recommendations');
      const recs = [];

      if (breakdown.find(b => b.label === 'Privacy Issues' && b.status !== 'good')) {
        recs.push({ icon: '🔒', text: 'Remove exposed personal information from your social media profiles', priority: 'high' });
      }
      if (breakdown.find(b => b.label === 'Active Alerts' && b.status !== 'good')) {
        recs.push({ icon: '🔔', text: 'Review and resolve pending security alerts', priority: 'high' });
      }
      if (breakdown.find(b => b.label === 'Bot Exposure' && b.status !== 'good')) {
        recs.push({ icon: '🤖', text: 'Review and remove suspected bot followers to improve account quality', priority: 'medium' });
      }
      if (breakdown.find(b => b.label === 'Monitoring Freshness' && b.status !== 'good')) {
        recs.push({ icon: '📸', text: 'Run a new capture to keep monitoring data up to date', priority: 'medium' });
      }
      recs.push({ icon: '🛡️', text: 'Enable two-factor authentication on all social media accounts', priority: 'medium' });
      recs.push({ icon: '🔑', text: 'Use unique passwords for each social media platform', priority: 'low' });
      if (score < 60) {
        recs.push({ icon: '⚡', text: 'Consider switching accounts to private mode to reduce exposure', priority: 'high' });
      }

      const priorityColors = { high: '#ef4444', medium: '#f59e0b', low: '#8888aa' };
      container.innerHTML = recs.map(r => `
        <div style="display: flex; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
          <span style="font-size: 18px; margin-right: 12px;">${r.icon}</span>
          <div style="flex: 1; font-size: 13px; color: var(--text-primary);">${this.escapeHtml(r.text)}</div>
          <span style="font-size: 10px; font-weight: 600; color: ${priorityColors[r.priority]}; text-transform: uppercase;">${r.priority}</span>
        </div>
      `).join('');
    },

    // ==================== Export Reports ====================

    async exportAlertsHTML() {
      const alerts = await SocialShieldStorage.getAlerts(100);
      if (alerts.length === 0) {
        alert('No alerts to export.');
        return;
      }

      const severityColors = { danger: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
      const severityIcons = { danger: '&#x1F6A8;', warning: '&#x26A0;&#xFE0F;', info: '&#x2139;&#xFE0F;' };
      const now = new Date().toLocaleString();

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SocialShield - Alerts Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f7; color: #1a1a2e; padding: 40px; }
    .report-header { text-align: center; margin-bottom: 32px; }
    .report-header h1 { font-size: 28px; color: #1a1a2e; }
    .report-header p { font-size: 14px; color: #666; margin-top: 8px; }
    .report-stats { display: flex; justify-content: center; gap: 24px; margin-bottom: 32px; }
    .report-stat { text-align: center; padding: 16px 24px; background: white; border-radius: 10px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
    .report-stat-value { font-size: 28px; font-weight: 700; }
    .report-stat-label { font-size: 12px; color: #888; margin-top: 4px; }
    .alert-card { display: flex; gap: 12px; padding: 16px; margin-bottom: 8px; border-radius: 8px; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.06); border-left: 4px solid #ddd; }
    .alert-card.danger { border-left-color: #ef4444; }
    .alert-card.warning { border-left-color: #f59e0b; }
    .alert-card.info { border-left-color: #3b82f6; }
    .alert-icon { font-size: 20px; flex-shrink: 0; }
    .alert-content { flex: 1; }
    .alert-title { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
    .alert-message { font-size: 13px; color: #555; line-height: 1.5; }
    .alert-meta { font-size: 11px; color: #999; margin-top: 6px; }
    .report-footer { text-align: center; margin-top: 32px; font-size: 12px; color: #999; }
    @media print { body { padding: 20px; } .report-stat { box-shadow: none; border: 1px solid #eee; } .alert-card { box-shadow: none; border: 1px solid #eee; } }
  </style>
</head>
<body>
  <div class="report-header">
    <h1>SocialShield Alerts Report</h1>
    <p>Generated on ${this.escapeHtml(now)}</p>
  </div>
  <div class="report-stats">
    <div class="report-stat">
      <div class="report-stat-value">${alerts.length}</div>
      <div class="report-stat-label">Total Alerts</div>
    </div>
    <div class="report-stat">
      <div class="report-stat-value" style="color: #ef4444;">${alerts.filter(a => a.severity === 'danger').length}</div>
      <div class="report-stat-label">Critical</div>
    </div>
    <div class="report-stat">
      <div class="report-stat-value" style="color: #f59e0b;">${alerts.filter(a => a.severity === 'warning').length}</div>
      <div class="report-stat-label">Warnings</div>
    </div>
    <div class="report-stat">
      <div class="report-stat-value" style="color: #3b82f6;">${alerts.filter(a => a.severity === 'info').length}</div>
      <div class="report-stat-label">Info</div>
    </div>
  </div>
  ${alerts.map(a => `
    <div class="alert-card ${a.severity || 'info'}">
      <div class="alert-icon">${severityIcons[a.severity] || severityIcons.info}</div>
      <div class="alert-content">
        <div class="alert-title">${this.escapeHtml(a.title || a.type || 'Alert')}</div>
        <div class="alert-message">${this.escapeHtml(a.message || '')}</div>
        <div class="alert-meta">
          ${a.username ? `@${this.escapeHtml(a.username)}` : ''}
          ${a.platform ? ` &middot; ${this.escapeHtml(this.platformLabel(a.platform))}` : ''}
          &middot; ${this.formatDate(a.timestamp)}
          ${a.read ? ' &middot; Read' : ' &middot; <strong>Unread</strong>'}
        </div>
      </div>
    </div>
  `).join('')}
  <div class="report-footer">
    <p>SocialShield v1.0.0 &mdash; Social Media Security & Connection Monitor</p>
  </div>
</body>
</html>`;

      const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `socialshield-alerts-${new Date().toISOString().slice(0, 10)}.html`;
      a.click();
      URL.revokeObjectURL(url);
    },

    async exportSecurityReportCSV() {
      const allData = await SocialShieldStorage.getAll();
      const rows = [['Type', 'Platform', 'Username', 'Severity', 'Title', 'Message', 'Timestamp']];

      // Privacy findings
      const privacyKeys = Object.keys(allData).filter(k => k.startsWith('privacy_'));
      for (const key of privacyKeys) {
        const scans = allData[key] || [];
        for (const scan of scans) {
          for (const f of (scan.results || [])) {
            rows.push(['Privacy', scan.platform, scan.username, f.severity, f.title, f.message, scan.timestamp]);
          }
        }
      }

      // Alerts
      for (const alert of (allData.alerts || [])) {
        rows.push(['Alert', alert.platform || '', alert.username || '', alert.severity, alert.title || alert.type, alert.message, alert.timestamp]);
      }

      // Profile changes
      const profileKeys = Object.keys(allData).filter(k => k.startsWith('profile_'));
      for (const key of profileKeys) {
        const history = allData[key] || [];
        const parts = key.replace('profile_', '').split('_');
        const platform = parts[0];
        const username = parts.slice(1).join('_');
        for (const entry of history) {
          for (const ch of (entry.changes || [])) {
            rows.push(['ProfileChange', platform, username, 'info', ch.label, `${ch.oldValue} → ${ch.newValue}`, entry.timestamp]);
          }
        }
      }

      // Bot summary per snapshot
      const snapshotKeys = Object.keys(allData).filter(k => k.startsWith('snapshots_'));
      for (const key of snapshotKeys) {
        const snapshots = allData[key] || [];
        if (snapshots.length > 0) {
          const latest = snapshots[snapshots.length - 1];
          const ba = SocialShieldDiff.analyzeBots(latest.data || []);
          rows.push(['BotAnalysis', latest.platform, latest.username, ba.botRatio > 30 ? 'high' : 'low',
            `${latest.type} bot ratio`, `${ba.botCount}/${ba.totalAnalyzed} (${ba.botRatio}%)`, latest.timestamp]);
        }
      }

      const csv = rows.map(r => r.map(c => `"${String(c || '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `socialshield-report-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },

    // ==================== Settings Page ====================

    async loadSettings() {
      const settings = await SocialShieldStorage.getSettings();
      document.getElementById('setting-mass-follow').value = settings.suspiciousThreshold?.massFollow || 20;
      document.getElementById('setting-mass-unfollow').value = settings.suspiciousThreshold?.massUnfollow || 10;
      document.getElementById('setting-change-rate').value = settings.suspiciousThreshold?.changeRate || 30;
      document.getElementById('setting-notifications').checked = settings.notifications !== false;
      document.getElementById('setting-auto-capture').checked = !!settings.autoCapture;
      document.getElementById('setting-capture-interval').value = String(settings.captureInterval || 360);
      document.getElementById('setting-sb-apikey').value = settings.safeBrowsingApiKey || '';
      document.getElementById('setting-sb-enabled').checked = !!settings.safeBrowsingEnabled;
      document.getElementById('setting-vt-apikey').value = settings.virusTotalApiKey || '';
      document.getElementById('setting-vt-enabled').checked = !!settings.virusTotalEnabled;
      document.getElementById('setting-urlhaus-apikey').value = settings.urlhausAuthKey || '';
      document.getElementById('setting-urlhaus-enabled').checked = !!settings.urlhausEnabled;
      document.getElementById('setting-ai-url').value = settings.aiAnalysisUrl || 'http://localhost:3456';
      document.getElementById('setting-ai-enabled').checked = !!settings.aiAnalysisEnabled;
    },

    async saveSettings() {
      const settings = {
        notifications: document.getElementById('setting-notifications').checked,
        autoCapture: document.getElementById('setting-auto-capture').checked,
        captureInterval: parseInt(document.getElementById('setting-capture-interval').value) || 360,
        safeBrowsingApiKey: document.getElementById('setting-sb-apikey').value.trim(),
        safeBrowsingEnabled: document.getElementById('setting-sb-enabled').checked,
        virusTotalApiKey: document.getElementById('setting-vt-apikey').value.trim(),
        virusTotalEnabled: document.getElementById('setting-vt-enabled').checked,
        urlhausAuthKey: document.getElementById('setting-urlhaus-apikey').value.trim(),
        urlhausEnabled: document.getElementById('setting-urlhaus-enabled').checked,
        aiAnalysisUrl: document.getElementById('setting-ai-url').value.trim() || 'http://localhost:3456',
        aiAnalysisEnabled: document.getElementById('setting-ai-enabled').checked,
        suspiciousThreshold: {
          massFollow: parseInt(document.getElementById('setting-mass-follow').value) || 20,
          massUnfollow: parseInt(document.getElementById('setting-mass-unfollow').value) || 10,
          changeRate: parseInt(document.getElementById('setting-change-rate').value) || 30
        }
      };
      await SocialShieldStorage.saveSettings(settings);

      // Notify service worker to update alarm
      chrome.runtime.sendMessage({ type: 'UPDATE_AUTO_CAPTURE' });

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

    // ==================== Tools Page (standalone) ====================

    initToolsPage() {
      // Tránh bind nhiều lần
      if (this._toolsBound) return;
      this._toolsBound = true;

      // Username Footprint
      document.getElementById('btn-tool-footprint').addEventListener('click', async () => {
        const username = document.getElementById('tool-footprint-username').value.trim();
        const out = document.getElementById('tool-footprint-result');
        if (!username) { out.innerHTML = '<div style="color:var(--danger);">Enter a username</div>'; return; }
        out.innerHTML = '<div style="color: var(--text-secondary);">⏳ Scanning...</div>';
        try {
          const result = await SocialShieldScanner.scanUsernameFootprint(username);
          if (!result || result.error) {
            out.innerHTML = `<div style="color:var(--danger);">Error: ${result?.error || 'unknown'}</div>`;
            return;
          }
          let html = `<div style="margin-bottom: 12px; font-weight: 600; color: var(--accent);">${result.summary}</div>`;
          html += '<table style="width:100%; border-collapse: collapse;">';
          html += '<thead><tr style="border-bottom: 1px solid var(--border);"><th style="text-align:left;padding:6px;">Site</th><th style="text-align:left;padding:6px;">Status</th><th style="text-align:left;padding:6px;">Profile</th></tr></thead><tbody>';
          for (const r of result.found) {
            html += `<tr><td style="padding:6px;">${r.site}</td><td style="padding:6px; color: var(--danger);">✓ Found</td><td style="padding:6px;"><a href="${r.profileUrl}" target="_blank" style="color: var(--accent);">${r.profileUrl}</a></td></tr>`;
          }
          for (const r of result.notFound) {
            html += `<tr><td style="padding:6px;">${r.site}</td><td style="padding:6px; color: var(--text-secondary);">✗ Not found</td><td style="padding:6px;">—</td></tr>`;
          }
          for (const r of (result.inconclusive || [])) {
            html += `<tr><td style="padding:6px;">${r.site}</td><td style="padding:6px; color: #fbbf24;">? ${r.reason}</td><td style="padding:6px; font-size: 11px; color: var(--text-secondary);">—</td></tr>`;
          }
          for (const r of result.errors) {
            html += `<tr><td style="padding:6px;">${r.site}</td><td style="padding:6px; color: orange;">⚠ ${r.error}</td><td style="padding:6px;">—</td></tr>`;
          }
          html += '</tbody></table>';
          if (result.found.length >= 3) {
            html += `<div style="margin-top: 12px; padding: 10px; background: rgba(239,68,68,0.1); border-radius: 6px; font-size: 13px;">⚠️ Username "${result.username}" được tái sử dụng ở ${result.found.length} site khác nhau — cao rủi ro linkability. Khuyến nghị: dùng username khác cho dịch vụ nhạy cảm.</div>`;
          }
          out.innerHTML = html;
        } catch (err) {
          out.innerHTML = `<div style="color:var(--danger);">Error: ${err.message}</div>`;
        }
      });

      // URL Safety check
      document.getElementById('btn-tool-url-check').addEventListener('click', async () => {
        const url = document.getElementById('tool-url-input').value.trim();
        const out = document.getElementById('tool-url-result');
        if (!url) { out.innerHTML = '<div style="color:var(--danger);">Enter a URL</div>'; return; }
        out.innerHTML = '<div style="color: var(--text-secondary);">⏳ Checking...</div>';
        try {
          const settings = await SocialShieldStorage.getSettings();
          const opts = {};
          if (settings.safeBrowsingEnabled && settings.safeBrowsingApiKey) opts.safeBrowsingApiKey = settings.safeBrowsingApiKey;
          if (settings.virusTotalEnabled && settings.virusTotalApiKey) opts.virusTotalApiKey = settings.virusTotalApiKey;
          if (settings.urlhausEnabled && settings.urlhausAuthKey) opts.urlhausAuthKey = settings.urlhausAuthKey;

          const result = await SocialShieldScanner.checkLinkFull(url, opts);
          const color = result.safe ? 'var(--accent)' : 'var(--danger)';
          const verdict = result.safe ? '✓ Appears safe' : '✗ UNSAFE';
          let html = `<div style="font-size: 18px; font-weight: 600; color: ${color}; margin-bottom: 8px;">${verdict} (score: ${result.score}/100)</div>`;
          const checks = [];
          if (result.safeBrowsingChecked) checks.push('Google Safe Browsing');
          if (result.virusTotalChecked) checks.push(`VirusTotal (${result.virusTotalStats?.malicious || 0}/${result.virusTotalStats?.total || 0} malicious)`);
          if (result.urlhausChecked) checks.push('URLhaus');
          if (checks.length) html += `<div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">Engines: ${checks.join(' • ')}</div>`;

          if (result.warnings && result.warnings.length > 0) {
            html += '<ul style="margin: 0; padding-left: 18px;">';
            for (const w of result.warnings) {
              const sevColor = w.severity === 'critical' ? 'var(--danger)'
                            : w.severity === 'high' ? 'orange' : 'var(--text-secondary)';
              html += `<li style="color: ${sevColor}; margin-bottom: 4px;"><b>[${w.severity}]</b> ${w.message}</li>`;
            }
            html += '</ul>';
          } else {
            html += '<div style="color: var(--accent);">No warnings.</div>';
          }
          out.innerHTML = html;
        } catch (err) {
          out.innerHTML = `<div style="color:var(--danger);">Error: ${err.message}</div>`;
        }
      });

      // Text PII scanner
      document.getElementById('btn-tool-text-scan').addEventListener('click', () => {
        const text = document.getElementById('tool-text-input').value;
        const out = document.getElementById('tool-text-result');
        if (!text) { out.innerHTML = '<div style="color:var(--danger);">Paste some text first</div>'; return; }
        const findings = [
          ...SocialShieldScanner.scanPrivacy(text),
          ...SocialShieldScanner.checkPasswordExposure(text),
        ];
        if (findings.length === 0) {
          out.innerHTML = '<div style="color: var(--accent); font-weight: 600;">✓ No PII detected.</div>';
          return;
        }
        let html = `<div style="font-weight: 600; margin-bottom: 12px;">Found ${findings.length} issue(s):</div>`;
        for (const f of findings) {
          const sevColor = f.severity === 'critical' ? 'var(--danger)'
                        : f.severity === 'high' ? 'orange'
                        : f.severity === 'medium' ? '#fbbf24' : 'var(--text-secondary)';
          html += `<div style="padding: 10px; margin-bottom: 8px; background: rgba(255,255,255,0.04); border-left: 3px solid ${sevColor}; border-radius: 4px;">`;
          html += `<div style="font-weight: 600;">${f.icon || '⚠'} ${f.title} <span style="font-size: 11px; color: ${sevColor};">[${f.severity}]</span></div>`;
          html += `<div style="font-size: 13px; color: var(--text-secondary); margin: 4px 0;">${f.message}</div>`;
          if (f.values && f.values.length) {
            html += `<div style="font-size: 12px; font-family: monospace; color: var(--accent);">${f.values.slice(0, 5).map(v => this._escapeHtml(String(v))).join(', ')}${f.values.length > 5 ? ` +${f.values.length - 5} more` : ''}</div>`;
          }
          html += '</div>';
        }
        out.innerHTML = html;
      });
      document.getElementById('btn-tool-text-clear').addEventListener('click', () => {
        document.getElementById('tool-text-input').value = '';
        document.getElementById('tool-text-result').innerHTML = '';
      });

      // Email Breach check
      document.getElementById('btn-tool-email-check').addEventListener('click', async () => {
        const email = document.getElementById('tool-email-input').value.trim();
        const out = document.getElementById('tool-email-result');
        if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
          out.innerHTML = '<div style="color:var(--danger);">Enter a valid email</div>'; return;
        }
        out.innerHTML = '<div style="color: var(--text-secondary);">⏳ Checking...</div>';
        try {
          const result = await chrome.runtime.sendMessage({ type: 'CHECK_EMAIL_BREACH', email });
          if (!result) { out.innerHTML = '<div style="color: orange;">Could not check.</div>'; return; }
          if (result.breached) {
            const list = (result.breaches || []).filter(b => b && !String(b).startsWith('Domain'));
            let html = `<div style="font-size: 18px; font-weight: 600; color: var(--danger); margin-bottom: 8px;">💀 Breached in ${result.breachCount > 0 ? result.breachCount : 'multiple'} dataset(s)</div>`;
            html += `<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">Source: ${result.source}</div>`;
            if (list.length) html += `<div style="font-size: 13px;"><b>Breaches:</b> ${list.slice(0, 20).join(', ')}${list.length > 20 ? ` +${list.length - 20} more` : ''}</div>`;
            html += '<div style="margin-top: 10px; padding: 10px; background: rgba(239,68,68,0.1); border-radius: 6px; font-size: 13px;">⚠ Đổi password ngay trên các service liên quan và bật 2FA.</div>';
            out.innerHTML = html;
          } else if (result.note) {
            out.innerHTML = `<div style="color: orange;">⚠ ${result.note}</div>`;
          } else {
            out.innerHTML = '<div style="color: var(--accent); font-weight: 600;">✓ No known breaches.</div>';
          }
        } catch (err) {
          out.innerHTML = `<div style="color:var(--danger);">Error: ${err.message}</div>`;
        }
      });

      // ============= Image Privacy Scanner =============
      let lastImageBlob = null;
      let lastImageEl = null;
      document.getElementById('btn-tool-image-scan').addEventListener('click', async () => {
        const fileInput = document.getElementById('tool-image-input');
        const out = document.getElementById('tool-image-result');
        const file = fileInput.files?.[0];
        if (!file) { out.innerHTML = '<div style="color:var(--danger);">Choose an image first</div>'; return; }
        out.innerHTML = '<div style="color: var(--text-secondary);">⏳ Analyzing (EXIF + QR + CCCD)...</div>';
        try {
          lastImageBlob = file;
          const result = await SocialShieldImageAnalyzer.scanImage(file);
          let html = '';

          // EXIF GPS
          if (result.exif) {
            const e = result.exif;
            html += '<h3 style="margin: 8px 0;">📍 EXIF Metadata</h3>';
            if (e.gps?.latitude !== undefined) {
              const lat = e.gps.latitude.toFixed(6);
              const lng = e.gps.longitude.toFixed(6);
              html += `<div style="padding: 10px; background: rgba(239,68,68,0.1); border-left: 3px solid var(--danger); border-radius: 4px; margin-bottom: 8px;"><b style="color: var(--danger);">⚠ GPS LEAK:</b> ${lat}, ${lng} <a href="https://maps.google.com/?q=${lat},${lng}" target="_blank" style="color: var(--accent); margin-left: 8px;">→ View on map</a><br><span style="font-size: 11px; color: var(--text-secondary);">Anyone with this image can find where it was taken.</span></div>`;
            }
            const meta = [];
            if (e.make) meta.push(`Camera: ${this._escapeHtml(e.make)} ${this._escapeHtml(e.model || '')}`);
            if (e.dateTimeOriginal) meta.push(`Taken: ${this._escapeHtml(e.dateTimeOriginal)}`);
            if (meta.length) html += `<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">${meta.join(' • ')}</div>`;
            if (!e.gps?.latitude && !meta.length) html += `<div style="color: var(--accent);">✓ No sensitive metadata.</div>`;
          } else {
            html += '<h3 style="margin: 8px 0;">📍 EXIF</h3><div style="color: var(--text-secondary);">No EXIF (PNG or stripped JPEG).</div>';
          }

          // QR
          if (result.qr) {
            html += '<h3 style="margin: 16px 0 8px;">📱 QR Code</h3>';
            if (result.qr.isVietQR) {
              html += `<div style="padding: 10px; background: rgba(239,68,68,0.1); border-left: 3px solid var(--danger); border-radius: 4px;"><b style="color: var(--danger);">⚠ VietQR detected — bank account exposed:</b><br>`;
              if (result.qr.bankBin) html += `Bank BIN: <code>${this._escapeHtml(result.qr.bankBin)}</code><br>`;
              if (result.qr.accountNumber) html += `Account: <code>${this._escapeHtml(result.qr.accountNumber)}</code><br>`;
              if (result.qr.merchantName) html += `Name: ${this._escapeHtml(result.qr.merchantName)}<br>`;
              if (result.qr.amount) html += `Amount: ${this._escapeHtml(result.qr.amount)}<br>`;
              html += `<span style="font-size: 11px; color: var(--text-secondary);">Đăng STK lên public dễ bị scam chuyển khoản giả mạo (gửi tiền nhầm rồi kiện).</span></div>`;
            } else {
              html += `<div style="padding: 8px; background: rgba(255,255,255,0.04); border-radius: 4px;"><b>QR raw data:</b> <code style="font-size: 11px; word-break: break-all;">${this._escapeHtml(result.qr.rawData.substring(0, 200))}${result.qr.rawData.length > 200 ? '...' : ''}</code></div>`;
            }
          } else {
            html += '<h3 style="margin: 16px 0 8px;">📱 QR</h3><div style="color: var(--text-secondary);">No QR code detected.</div>';
          }

          // CCCD heuristic
          if (result.idCard) {
            html += '<h3 style="margin: 16px 0 8px;">🆔 ID Card Heuristic</h3>';
            if (result.idCard.likelyIdCard) {
              html += `<div style="padding: 10px; background: rgba(245,158,11,0.1); border-left: 3px solid orange; border-radius: 4px;"><b style="color: orange;">⚠ Possible CCCD/CMND image (confidence: ${Math.round(result.idCard.confidence * 100)}%)</b><br>Signals: ${result.idCard.signals.join('; ')}<br><span style="font-size: 11px; color: var(--text-secondary);">Do NOT post ID card photos publicly. KHÔNG đăng ảnh CCCD lên mạng — kể cả góc nhỏ trong ảnh khoe.</span></div>`;
            } else {
              html += `<div style="color: var(--accent); font-size: 12px;">Not detected as ID card (confidence ${Math.round(result.idCard.confidence * 100)}%).</div>`;
            }
          }

          if (result.errors.length > 0) {
            html += `<div style="margin-top: 8px; font-size: 11px; color: orange;">Errors: ${result.errors.join('; ')}</div>`;
          }

          // Lưu image element để OCR sau dùng
          lastImageEl = await SocialShieldImageAnalyzer._blobToImage(file);

          out.innerHTML = html;
        } catch (err) {
          out.innerHTML = `<div style="color:var(--danger);">Error: ${this._escapeHtml(err.message)}</div>`;
        }
      });

      // ============= Footprint Monitor =============
      this._loadFootprintMonitorSettings();

      document.getElementById('btn-tool-fpmon-save').addEventListener('click', async () => {
        const usernames = document.getElementById('tool-fpmon-usernames').value
          .split('\n').map(s => s.trim()).filter(Boolean);
        const enabled = document.getElementById('tool-fpmon-enabled').checked;
        const interval = parseInt(document.getElementById('tool-fpmon-interval').value, 10) || 1440;

        const settings = await SocialShieldStorage.getSettings();
        settings.footprintMonitorEnabled = enabled;
        settings.footprintMonitorUsernames = usernames;
        settings.footprintMonitorInterval = interval;
        await SocialShieldStorage.saveSettings(settings);
        await chrome.runtime.sendMessage({ type: 'UPDATE_FOOTPRINT_MONITOR' });
        document.getElementById('tool-fpmon-result').innerHTML =
          `<div style="color: var(--accent);">✓ Saved. ${enabled ? `Monitoring ${usernames.length} username(s) every ${interval} min.` : 'Monitoring disabled.'}</div>`;
      });

      document.getElementById('btn-tool-fpmon-run').addEventListener('click', async () => {
        const out = document.getElementById('tool-fpmon-result');
        out.innerHTML = '<div style="color: var(--text-secondary);">⏳ Running monitor now...</div>';
        try {
          await chrome.runtime.sendMessage({ type: 'RUN_FOOTPRINT_MONITOR_NOW' });
          out.innerHTML = '<div style="color: var(--accent);">✓ Monitor run completed. Check Alerts tab for new accounts.</div>';
        } catch (err) {
          out.innerHTML = `<div style="color:var(--danger);">Error: ${this._escapeHtml(err.message)}</div>`;
        }
      });

      // ============= Privacy Audit Viewer =============
      document.getElementById('btn-tool-audit-load').addEventListener('click', async () => {
        const out = document.getElementById('tool-audit-result');
        const ig = await SocialShieldStorage.get('privacy_audit_instagram');
        const tw = await SocialShieldStorage.get('privacy_audit_twitter');
        let html = '';
        for (const [label, audit] of [['Instagram', ig], ['Twitter/X', tw]]) {
          if (!audit) continue;
          const color = audit.score >= 70 ? 'var(--accent)' : audit.score >= 40 ? '#fbbf24' : 'var(--danger)';
          html += `<div style="padding: 12px; margin-bottom: 12px; background: rgba(255,255,255,0.04); border-radius: 8px;">`;
          html += `<div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;"><h3 style="margin:0;">${label}</h3><div style="font-size: 24px; font-weight: 700; color: ${color};">${audit.score}<span style="font-size: 12px;">/100</span></div></div>`;
          html += `<div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 8px;">Audited at ${new Date(audit.auditedAt).toLocaleString()} on <code>${this._escapeHtml(audit.url)}</code></div>`;
          if (audit.findings.length === 0) {
            html += `<div style="color: var(--accent); font-size: 13px;">${audit.contextNote || 'No issues found on this page.'}</div>`;
          } else {
            for (const f of audit.findings) {
              const sevColor = f.severity === 'high' ? 'var(--danger)' : f.severity === 'medium' ? '#fbbf24' : 'var(--text-secondary)';
              html += `<div style="padding: 8px; margin-bottom: 6px; border-left: 3px solid ${sevColor}; background: rgba(255,255,255,0.03); border-radius: 3px;">`;
              html += `<div><b>${this._escapeHtml(f.title)}</b> <span style="font-size: 10px; color: ${sevColor}; text-transform: uppercase;">[${f.severity}]</span></div>`;
              html += `<div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">${this._escapeHtml(f.message)}</div>`;
              html += `<div style="font-size: 12px; color: var(--accent); margin-top: 4px;">→ ${this._escapeHtml(f.recommendation)}</div>`;
              html += `</div>`;
            }
          }
          html += '</div>';
        }
        if (!html) {
          html = '<div class="ss-empty-state" style="padding: 16px;"><div class="ss-empty-icon">⚙️</div><p>Chưa có audit. Mở Instagram Settings hoặc X Settings → click FAB → Audit Privacy Settings.</p></div>';
        }
        out.innerHTML = html;
      });

      // ============= Safe Image Generator =============
      document.getElementById('btn-tool-image-safe').addEventListener('click', async () => {
        const out = document.getElementById('tool-image-result');
        const file = document.getElementById('tool-image-input').files?.[0];
        if (!file) { alert('Choose an image first'); return; }
        const status = document.createElement('div');
        status.style.cssText = 'margin-top: 12px; padding: 10px; background: rgba(255,255,255,0.04); border-radius: 4px;';
        status.innerHTML = '<div style="color: var(--text-secondary);">⏳ Generating safe version...</div>';
        out.appendChild(status);
        try {
          const { blob, info } = await SocialShieldImageAnalyzer.generateSafeImage(file);
          const url = URL.createObjectURL(blob);
          let html = '<h3 style="margin: 0 0 8px;">🛡️ Safe version ready</h3><ul style="margin: 0; padding-left: 18px;">';
          if (info.exifStripped) html += '<li>EXIF metadata stripped (GPS, camera, datetime removed)</li>';
          if (info.qrCovered) html += `<li style="color: orange;">QR code covered (data was: <code style="font-size: 10px;">${this._escapeHtml((info.qrData || '').substring(0, 50))}...</code>)</li>`;
          if (info.idCardWarning) html += `<li style="color: var(--danger);">⚠ Image looks like ID card (confidence ${Math.round(info.idCardConfidence * 100)}%) — KHÔNG tự crop, bạn nên KHÔNG đăng ảnh này.</li>`;
          html += '</ul>';
          html += `<div style="margin-top: 10px;"><a href="${url}" download="safe_${file.name.replace(/\.\w+$/, '')}.jpg" class="ss-btn ss-btn-primary" style="display: inline-block; padding: 8px 14px;">⬇ Download safe image</a></div>`;
          html += `<div style="margin-top: 8px;"><img src="${url}" style="max-width: 100%; max-height: 300px; border-radius: 6px;"></div>`;
          status.innerHTML = html;
        } catch (err) {
          status.innerHTML = `<div style="color:var(--danger);">Error: ${this._escapeHtml(err.message)}</div>`;
        }
      });

      // ============= Reverse Image Search =============
      const openRevSearch = (engineFn) => {
        const url = document.getElementById('tool-revsearch-url').value.trim();
        if (!url) { alert('Paste image URL first'); return; }
        window.open(engineFn(encodeURIComponent(url)), '_blank');
      };
      document.getElementById('btn-revsearch-google').addEventListener('click', () =>
        openRevSearch(u => `https://lens.google.com/uploadbyurl?url=${u}`));
      document.getElementById('btn-revsearch-yandex').addEventListener('click', () =>
        openRevSearch(u => `https://yandex.com/images/search?rpt=imageview&url=${u}`));
      document.getElementById('btn-revsearch-tineye').addEventListener('click', () =>
        openRevSearch(u => `https://tineye.com/search/?url=${u}`));
      document.getElementById('btn-revsearch-bing').addEventListener('click', () =>
        openRevSearch(u => `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${u}`));

      // ============= Geo Heatmap =============
      document.getElementById('btn-tool-geo-load').addEventListener('click', async () => {
        const username = document.getElementById('tool-geo-username').value.trim();
        const out = document.getElementById('tool-geo-result');
        if (!username) { out.innerHTML = '<div style="color:var(--danger);">Enter username</div>'; return; }
        out.innerHTML = '<div style="color: var(--text-secondary);">⏳ Fetching recent posts...</div>';
        try {
          const info = await chrome.runtime.sendMessage({ type: 'FETCH_PROFILE_INFO', username });
          if (!info) {
            out.innerHTML = '<div style="color:var(--danger);">Could not fetch profile (must be logged into Instagram).</div>';
            return;
          }
          const posts = info.recentPosts || [];
          const withLoc = posts.filter(p => p.location);
          if (withLoc.length === 0) {
            out.innerHTML = `<div style="color: var(--accent);">✓ ${posts.length} recent posts checked, none have location tags. Good privacy.</div>`;
            return;
          }
          // Cluster by location.name
          const cluster = {};
          for (const p of withLoc) {
            const loc = p.location;
            if (!cluster[loc]) cluster[loc] = { name: loc, count: 0, posts: [] };
            cluster[loc].count++;
            cluster[loc].posts.push(p);
          }
          const clusters = Object.values(cluster).sort((a, b) => b.count - a.count);

          let html = `<div style="margin-bottom: 12px; font-size: 13px;"><b>${withLoc.length}</b>/${posts.length} posts có location → <b>${clusters.length}</b> địa điểm khác nhau:</div>`;
          html += '<table style="width:100%; border-collapse: collapse;">';
          html += '<thead><tr style="border-bottom: 1px solid var(--border);"><th style="text-align:left;padding:6px;">Location</th><th style="text-align:left;padding:6px;">Posts</th><th style="text-align:left;padding:6px;">Map</th></tr></thead><tbody>';
          for (const c of clusters) {
            const heatColor = c.count >= 3 ? 'var(--danger)' : c.count >= 2 ? 'orange' : 'var(--text-secondary)';
            html += `<tr><td style="padding:6px;">${this._escapeHtml(c.name)}</td><td style="padding:6px; color: ${heatColor}; font-weight: 600;">${c.count}×</td><td style="padding:6px;"><a href="https://www.google.com/maps/search/${encodeURIComponent(c.name)}" target="_blank" style="color: var(--accent);">→ Maps</a></td></tr>`;
          }
          html += '</tbody></table>';

          // Top location warning
          if (clusters[0] && clusters[0].count >= 3) {
            html += `<div style="margin-top: 12px; padding: 10px; background: rgba(239,68,68,0.1); border-left: 3px solid var(--danger); border-radius: 4px; font-size: 13px;">⚠ <b>"${this._escapeHtml(clusters[0].name)}"</b> xuất hiện ${clusters[0].count} lần → khả năng cao là nơi user sống/làm việc thường xuyên. Attacker có thể dùng để stalking.</div>`;
          }
          out.innerHTML = html;
        } catch (err) {
          out.innerHTML = `<div style="color:var(--danger);">Error: ${this._escapeHtml(err.message)}</div>`;
        }
      });

      // ============= Apps Revocation Helper =============
      const openTab = (url) => chrome.tabs.create({ url });
      document.getElementById('btn-revoke-ig').addEventListener('click', () =>
        openTab('https://www.instagram.com/accounts/manage_access/'));
      document.getElementById('btn-revoke-x').addEventListener('click', () =>
        openTab('https://x.com/settings/connected_apps'));
      document.getElementById('btn-revoke-google').addEventListener('click', () =>
        openTab('https://myaccount.google.com/connections'));
      document.getElementById('btn-revoke-fb').addEventListener('click', () =>
        openTab('https://www.facebook.com/settings/?tab=business_tools'));
      document.getElementById('btn-revoke-github').addEventListener('click', () =>
        openTab('https://github.com/settings/applications'));

      // Password Pwned check (via service worker, k-anonymity)
      document.getElementById('btn-tool-pwd-check').addEventListener('click', async () => {
        const password = document.getElementById('tool-pwd-input').value;
        const out = document.getElementById('tool-pwd-result');
        if (!password || password.length < 4) {
          out.innerHTML = '<div style="color:var(--danger);">Password too short</div>'; return;
        }
        out.innerHTML = '<div style="color: var(--text-secondary);">⏳ Checking via HIBP k-anonymity...</div>';
        try {
          const result = await chrome.runtime.sendMessage({ type: 'CHECK_PASSWORD_PWNED', password });
          if (result && result.pwned) {
            out.innerHTML = `<div style="font-size: 18px; font-weight: 600; color: var(--danger);">💀 PWNED — seen ${result.count.toLocaleString()} time(s) in breaches</div><div style="margin-top: 8px; font-size: 13px;">Don't use this password anywhere. Generate a strong unique one.</div>`;
          } else {
            out.innerHTML = '<div style="color: var(--accent); font-weight: 600;">✓ Not found in HIBP database.</div><div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">Note: still ensure it\'s strong and unique.</div>';
          }
          // Clear input để không lưu
          document.getElementById('tool-pwd-input').value = '';
        } catch (err) {
          out.innerHTML = `<div style="color:var(--danger);">Error: ${err.message}</div>`;
        }
      });
    },

    _escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    async _renderReverseSearchHint(report) {
      try {
        const history = await SocialShieldStorage.getProfileHistory(report.platform, report.username);
        if (!history || history.length === 0) return;
        const latest = history[history.length - 1];
        if (!latest.profilePicUrl) return;
        const u = encodeURIComponent(latest.profilePicUrl);
        // Append vào title bar hint
        const titleEl = document.getElementById('doxxing-detail-title');
        if (!titleEl) return;
        const hintId = 'doxxing-revsearch-hint';
        document.getElementById(hintId)?.remove();
        const hint = document.createElement('div');
        hint.id = hintId;
        hint.style.cssText = 'font-size: 11px; margin-top: 4px; color: var(--text-secondary);';
        hint.innerHTML = `Reverse search profile pic: ` +
          `<a href="https://lens.google.com/uploadbyurl?url=${u}" target="_blank" style="color: var(--accent);">Google Lens</a> · ` +
          `<a href="https://yandex.com/images/search?rpt=imageview&url=${u}" target="_blank" style="color: var(--accent);">Yandex</a> · ` +
          `<a href="https://tineye.com/search/?url=${u}" target="_blank" style="color: var(--accent);">TinEye</a>`;
        titleEl.parentElement?.appendChild(hint);
      } catch {}
    },

    async _loadFootprintMonitorSettings() {
      const settings = await SocialShieldStorage.getSettings();
      const usernames = settings.footprintMonitorUsernames || [];
      const enabled = !!settings.footprintMonitorEnabled;
      const interval = settings.footprintMonitorInterval || 1440;
      document.getElementById('tool-fpmon-usernames').value = usernames.join('\n');
      document.getElementById('tool-fpmon-enabled').checked = enabled;
      document.getElementById('tool-fpmon-interval').value = String(interval);
    },

    // ==================== Doxxing Risk Page ====================

    async loadDoxxingReports() {
      const list = document.getElementById('doxxing-list');
      const all = await SocialShieldStorage.getAll();
      const reports = [];
      for (const [key, value] of Object.entries(all)) {
        if (key.startsWith('doxxing_') && value && value.riskTier) {
          reports.push({ key, ...value });
        }
      }

      if (reports.length === 0) {
        list.innerHTML = '<div class="ss-empty-state"><div class="ss-empty-icon">🎯</div><p>Chưa có report. Chạy Privacy Scan trên Instagram hoặc X profile để generate.</p></div>';
        return;
      }

      reports.sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0));
      let html = '';
      for (const r of reports) {
        const tierColor = r.riskTier === 'critical' ? 'var(--danger)'
                       : r.riskTier === 'high' ? 'orange'
                       : r.riskTier === 'medium' ? '#fbbf24' : 'var(--accent)';
        html += `<div class="ss-doxxing-row" data-key="${r.key}" style="display:flex; justify-content:space-between; align-items:center; padding: 12px; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; cursor: pointer;">`;
        html += `<div><div style="font-weight: 600;">@${r.username} <span style="font-size: 11px; color: var(--text-secondary);">(${r.platform})</span></div><div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">${r.attackerKnows?.length || 0} facts • ${r.attackerCanDo?.length || 0} attack vectors</div></div>`;
        html += `<div style="text-align: right;"><div style="font-size: 22px; font-weight: 700; color: ${tierColor};">${r.riskScore}</div><div style="font-size: 11px; color: ${tierColor}; text-transform: uppercase;">${r.riskTier}</div></div>`;
        html += `</div>`;
      }
      list.innerHTML = html;

      // Click to view detail
      list.querySelectorAll('.ss-doxxing-row').forEach(row => {
        row.addEventListener('click', () => {
          const key = row.getAttribute('data-key');
          const r = reports.find(x => x.key === key);
          this.renderDoxxingDetail(r);
        });
      });
    },

    renderDoxxingDetail(r) {
      const card = document.getElementById('doxxing-detail-card');
      const title = document.getElementById('doxxing-detail-title');
      const body = document.getElementById('doxxing-detail-body');

      title.textContent = `@${r.username} — ${r.platform.toUpperCase()}`;

      // Suggest reverse image search nếu có profile pic URL trong storage
      this._renderReverseSearchHint(r);

      const tierColor = r.riskTier === 'critical' ? 'var(--danger)'
                     : r.riskTier === 'high' ? 'orange'
                     : r.riskTier === 'medium' ? '#fbbf24' : 'var(--accent)';

      let html = `<div style="display:flex; align-items: baseline; gap: 16px; margin-bottom: 16px;">`;
      html += `<div style="font-size: 48px; font-weight: 700; color: ${tierColor};">${r.riskScore}<span style="font-size: 20px;">/100</span></div>`;
      html += `<div><div style="font-size: 14px; text-transform: uppercase; color: ${tierColor}; font-weight: 600;">${r.riskTier} risk</div><div style="font-size: 12px; color: var(--text-secondary);">Generated ${new Date(r.generatedAt).toLocaleString()}</div></div>`;
      html += `</div>`;

      html += `<div style="padding: 14px; background: rgba(255,255,255,0.04); border-left: 3px solid ${tierColor}; border-radius: 4px; margin-bottom: 16px; line-height: 1.6;">${this._escapeHtml(r.narrative).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</div>`;

      // Attacker knows
      if (r.attackerKnows?.length > 0) {
        html += '<h3 style="margin: 16px 0 8px;">🕵️ Attacker biết được:</h3>';
        html += '<ul style="margin: 0; padding-left: 20px;">';
        for (const k of r.attackerKnows) {
          html += `<li style="margin-bottom: 6px;"><b>[${k.category}]</b> ${this._escapeHtml(k.fact).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')} <span style="font-size: 11px; color: var(--text-secondary);">— ${k.source}</span></li>`;
        }
        html += '</ul>';
      }

      // Attacker can do
      if (r.attackerCanDo?.length > 0) {
        html += '<h3 style="margin: 16px 0 8px;">⚔️ Hướng tấn công khả thi:</h3>';
        html += '<ul style="margin: 0; padding-left: 20px;">';
        for (const a of r.attackerCanDo) {
          html += `<li style="margin-bottom: 4px; color: var(--text);">${this._escapeHtml(a)}</li>`;
        }
        html += '</ul>';
      }

      // Fix actions
      if (r.fixActions?.length > 0) {
        html += '<h3 style="margin: 16px 0 8px;">🛡️ Bạn cần làm:</h3>';
        for (const f of r.fixActions) {
          const pColor = f.priority === 'critical' ? 'var(--danger)'
                      : f.priority === 'high' ? 'orange'
                      : f.priority === 'medium' ? '#fbbf24' : 'var(--accent)';
          html += `<div style="padding: 10px; margin-bottom: 6px; background: rgba(255,255,255,0.04); border-left: 3px solid ${pColor}; border-radius: 4px;"><span style="font-size: 11px; color: ${pColor}; text-transform: uppercase; font-weight: 600;">[${f.priority}]</span> ${this._escapeHtml(f.action)}</div>`;
        }
      }

      body.innerHTML = html;
      card.style.display = 'block';
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    // ==================== Event Binding ====================

    bindActions() {
      // Doxxing close + refresh
      document.getElementById('btn-doxxing-close').addEventListener('click', () => {
        document.getElementById('doxxing-detail-card').style.display = 'none';
      });
      document.getElementById('btn-doxxing-refresh').addEventListener('click', () => this.loadDoxxingReports());

      // Compare button
      document.getElementById('btn-compare').addEventListener('click', () => this.runCompare());

      // Settings
      document.getElementById('btn-save-settings').addEventListener('click', () => this.saveSettings());
      document.getElementById('btn-export').addEventListener('click', () => this.exportData());
      document.getElementById('btn-clear-all').addEventListener('click', () => this.clearAllData());

      // Capture Now button
      document.getElementById('btn-capture-now').addEventListener('click', async () => {
        const btn = document.getElementById('btn-capture-now');
        btn.disabled = true;
        btn.textContent = 'Capturing...';
        try {
          await chrome.runtime.sendMessage({ type: 'RUN_AUTO_CAPTURE_NOW' });
          btn.textContent = 'Done!';
          setTimeout(() => {
            btn.textContent = 'Capture Now';
            btn.disabled = false;
          }, 2000);
        } catch (err) {
          btn.textContent = 'Error';
          setTimeout(() => {
            btn.textContent = 'Capture Now';
            btn.disabled = false;
          }, 2000);
        }
      });

      // Test AI connection
      document.getElementById('btn-test-ai').addEventListener('click', async () => {
        const btn = document.getElementById('btn-test-ai');
        const url = document.getElementById('setting-ai-url').value.trim() || 'http://localhost:3456';
        btn.disabled = true;
        btn.textContent = 'Testing...';
        try {
          const res = await fetch(`${url}/health`);
          if (res.ok) {
            const data = await res.json();
            btn.textContent = 'Connected!';
            btn.style.background = 'rgba(0,212,170,0.2)';
            alert(`AI Server OK!\nStatus: ${data.status}\nAI configured: ${data.aiConfigured}`);
          } else {
            throw new Error(`HTTP ${res.status}`);
          }
        } catch (err) {
          btn.textContent = 'Failed';
          btn.style.background = 'rgba(239,68,68,0.2)';
          alert(`Cannot connect to AI server at ${url}\nError: ${err.message}\n\nMake sure the server is running: cd server && npm start`);
        }
        setTimeout(() => {
          btn.textContent = 'Test';
          btn.disabled = false;
          btn.style.background = '';
        }, 3000);
      });

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

      // Export alerts as HTML report
      document.getElementById('btn-export-alerts-html').addEventListener('click', () => {
        this.exportAlertsHTML();
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

      // Security Score export buttons
      const btnExportReport = document.getElementById('btn-export-report');
      if (btnExportReport) {
        btnExportReport.addEventListener('click', () => this.exportSecurityReportCSV());
      }
      const btnExportJson = document.getElementById('btn-export-report-json');
      if (btnExportJson) {
        btnExportJson.addEventListener('click', () => this.exportData());
      }
    },

    // ==================== Utilities ====================

    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text || '';
      return div.innerHTML;
    },

    platformLabel(platform) {
      const map = { instagram: 'Instagram', twitter: 'Twitter/X' };
      return map[platform] || platform;
    },

    platformIcon(platform) {
      const map = { instagram: '📷', twitter: '🐦' };
      return map[platform] || '🌐';
    },

    profileUrl(username, platform) {
      const u = encodeURIComponent(username);
      if (platform === 'twitter') return `https://x.com/${u}`;
      return `https://www.instagram.com/${u}/`;
    },

    safeHref(url) {
      if (!url) return '#';
      try {
        const u = new URL(url);
        if (u.protocol === 'https:' || u.protocol === 'http:') return url;
      } catch {}
      return '#';
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