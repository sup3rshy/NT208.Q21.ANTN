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
          const label = `@${group.username} - ${group.type}`;
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
              <span>@${this.escapeHtml(group.username)}</span>
              <span style="color: var(--text-secondary); font-weight: 400; font-size: 12px;">
                ${group.type} &middot; ${group.platform}
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

      title.textContent = `@${snap.username} - ${snap.type} (${snap.count})`;
      body.innerHTML = `
        <div style="margin-bottom: 12px; font-size: 13px; color: var(--text-secondary);">
          Captured: ${this.formatDate(snap.timestamp)}
        </div>
        ${botSummaryHtml}
        <div class="ss-user-list">
          ${snap.data.map(user => {
            const bot = SocialShieldDiff.scoreBotLikelihood(user);
            const botTag = bot.isLikelyBot
              ? `<span style="background: rgba(239,68,68,0.15); color: #ef4444; font-size: 10px; padding: 2px 6px; border-radius: 4px; margin-left: 6px;" title="${bot.reasons.join(', ')}">BOT ${bot.score}%</span>`
              : '';
            const userUrl = user.profileUrl || `https://www.instagram.com/${user.username}/`;
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
        const label = `@${group.username} - ${group.type} (${count} snapshots)`;
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
            ${oldSnap.type} &middot; ${oldSnap.platform}
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
                const addedUrl = u.profileUrl || `https://www.instagram.com/${u.username}/`;
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
                const removedUrl = u.profileUrl || `https://www.instagram.com/${u.username}/`;
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
            ${alert.username ? `
              <div class="ss-alert-card-profile" style="font-size: 12px; color: var(--accent); font-weight: 600; margin-bottom: 2px;">
                @${this.escapeHtml(alert.username)}
                <span style="color: var(--text-secondary); font-weight: 400;">
                  &middot; ${this.escapeHtml(alert.snapshotType || '')} &middot; ${this.escapeHtml(alert.platform || '')}
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

    // ==================== Event Binding ====================

    bindActions() {
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