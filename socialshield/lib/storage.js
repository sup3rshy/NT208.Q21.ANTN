/**
 * SocialShield Storage Module
 * Quản lý lưu trữ dữ liệu snapshots, privacy scans, và settings
 * Sử dụng Chrome Storage API (local)
 */
const SocialShieldStorage = {

  // ==================== Generic Storage ====================

  async get(key) {
    const result = await chrome.storage.local.get(key);
    return result[key];
  },

  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },

  async remove(key) {
    await chrome.storage.local.remove(key);
  },

  async getAll() {
    return await chrome.storage.local.get(null);
  },

  // ==================== API Cache (TTL-based) ====================

  /**
   * Lấy giá trị từ cache, trả về null nếu hết hạn hoặc chưa có
   * @param {string} cacheKey - key trong storage
   * @param {number} ttlMs - thời gian sống tính bằng ms
   */
  async cacheGet(cacheKey, ttlMs) {
    const entry = await this.get(cacheKey);
    if (!entry || !entry._cachedAt) return null;
    if (Date.now() - entry._cachedAt > ttlMs) return null;
    return entry.data;
  },

  /**
   * Lưu giá trị vào cache với timestamp
   */
  async cacheSet(cacheKey, data) {
    await this.set(cacheKey, { data, _cachedAt: Date.now() });
  },

  // ==================== Snapshots ====================

  /**
   * Lưu snapshot danh sách following/followers
   * @param {string} platform - 'instagram'
   * @param {string} username - username profile được capture
   * @param {string} type - 'following' | 'followers'
   * @param {Array} data - mảng {username, displayName, isVerified}
   */
  async saveSnapshot(platform, username, type, data) {
    const snapshot = {
      id: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      platform,
      username,
      type,
      data,
      count: data.length,
      timestamp: new Date().toISOString(),
      createdAt: Date.now()
    };

    const key = this._snapshotKey(platform, username, type);
    const existing = await this.get(key) || [];
    existing.push(snapshot);
    await this.set(key, existing);

    // Cập nhật index
    await this._updateSnapshotIndex(platform, username, type, snapshot.id);

    return snapshot;
  },

  /**
   * Lấy tất cả snapshots của một profile
   */
  async getSnapshots(platform, username, type) {
    const key = this._snapshotKey(platform, username, type);
    return await this.get(key) || [];
  },

  /**
   * Lấy snapshot theo ID
   */
  async getSnapshotById(snapshotId) {
    const index = await this.get('snapshot_index') || {};
    for (const key of Object.keys(index)) {
      const snapshots = await this.get(key) || [];
      const found = snapshots.find(s => s.id === snapshotId);
      if (found) return found;
    }
    return null;
  },

  /**
   * Xóa snapshot theo ID
   */
  async deleteSnapshot(platform, username, type, snapshotId) {
    const key = this._snapshotKey(platform, username, type);
    const snapshots = await this.get(key) || [];
    const filtered = snapshots.filter(s => s.id !== snapshotId);
    await this.set(key, filtered);
  },

  /**
   * Lấy tất cả snapshot keys (để liệt kê)
   */
  async getAllSnapshotGroups() {
    const index = await this.get('snapshot_index') || {};
    const groups = [];
    for (const [key, info] of Object.entries(index)) {
      const snapshots = await this.get(key) || [];
      groups.push({
        key,
        ...info,
        snapshotCount: snapshots.length,
        latestSnapshot: snapshots[snapshots.length - 1] || null
      });
    }
    return groups;
  },

  // ==================== Profile Change Tracking ====================

  /**
   * Lưu profile metadata (bio, displayName, profilePic, externalUrl, isPrivate, isVerified)
   * So sánh với lần lưu trước để phát hiện thay đổi
   */
  async saveProfileSnapshot(platform, username, profileData) {
    const key = `profile_${platform}_${username}`;
    const history = await this.get(key) || [];

    const entry = {
      ...profileData,
      timestamp: new Date().toISOString(),
      createdAt: Date.now()
    };

    // So sánh với entry trước
    const changes = [];
    if (history.length > 0) {
      const prev = history[history.length - 1];
      const fields = [
        { key: 'bio', label: 'Bio' },
        { key: 'displayName', label: 'Display Name' },
        { key: 'profilePicUrl', label: 'Profile Picture', normalize: 'imageUrl' },
        { key: 'externalUrl', label: 'External Link', normalize: 'url' },
        { key: 'isPrivate', label: 'Account Privacy' },
        { key: 'isVerified', label: 'Verification Status' },
      ];
      for (const f of fields) {
        const oldVal = prev[f.key];
        const newVal = entry[f.key];
        if (oldVal === undefined || newVal === undefined) continue;

        // CDN URLs (đặc biệt Instagram fbcdn) có signed query params đổi liên tục
        // dù ảnh không đổi → normalize trước khi so sánh
        const oldNorm = this._normalizeForCompare(oldVal, f.normalize);
        const newNorm = this._normalizeForCompare(newVal, f.normalize);

        if (oldNorm !== newNorm) {
          changes.push({
            field: f.key,
            label: f.label,
            oldValue: oldVal,
            newValue: newVal,
          });
        }
      }
    }

    entry.changes = changes;
    history.push(entry);
    // Giữ tối đa 50 entries
    if (history.length > 50) history.splice(0, history.length - 50);
    await this.set(key, history);

    return { entry, changes };
  },

  async getProfileHistory(platform, username) {
    const key = `profile_${platform}_${username}`;
    return await this.get(key) || [];
  },

  // ==================== Privacy Scans ====================

  async savePrivacyScan(platform, username, results) {
    const scan = {
      id: `scan_${Date.now()}`,
      platform,
      username,
      results,
      riskScore: this._calculateRiskScore(results),
      timestamp: new Date().toISOString(),
      createdAt: Date.now()
    };

    const key = `privacy_${platform}_${username}`;
    const existing = await this.get(key) || [];
    existing.push(scan);
    await this.set(key, existing);
    return scan;
  },

  async getPrivacyScans(platform, username) {
    const key = `privacy_${platform}_${username}`;
    return await this.get(key) || [];
  },

  // ==================== Alerts ====================

  async saveAlert(alert) {
    const alerts = await this.get('alerts') || [];
    alerts.unshift({
      ...alert,
      id: `alert_${Date.now()}`,
      read: false,
      timestamp: new Date().toISOString()
    });
    // Giữ tối đa 100 alerts
    if (alerts.length > 100) alerts.length = 100;
    await this.set('alerts', alerts);
  },

  async getAlerts(limit = 50) {
    const alerts = await this.get('alerts') || [];
    return alerts.slice(0, limit);
  },

  async markAlertRead(alertId) {
    const alerts = await this.get('alerts') || [];
    const alert = alerts.find(a => a.id === alertId);
    if (alert) {
      alert.read = true;
      await this.set('alerts', alerts);
    }
  },

  async getUnreadAlertCount() {
    const alerts = await this.get('alerts') || [];
    return alerts.filter(a => !a.read).length;
  },

  // ==================== Settings ====================

  async getSettings() {
    return await this.get('settings') || {
      autoCapture: false,
      captureInterval: 360, // phút (6 giờ)
      notifications: true,
      suspiciousThreshold: {
        massFollow: 20,
        massUnfollow: 10,
        changeRate: 30
      }
    };
  },

  async saveSettings(settings) {
    await this.set('settings', settings);
  },

  // ==================== Stats ====================

  async getStats() {
    const all = await this.getAll();
    const snapshotKeys = Object.keys(all).filter(k => k.startsWith('snapshots_'));
    // Exclude `privacy_audit_*` (object, không phải array scan history)
    const privacyKeys = Object.keys(all).filter(k =>
      k.startsWith('privacy_') && !k.startsWith('privacy_audit_') && Array.isArray(all[k]));

    let totalSnapshots = 0;
    let totalProfiles = new Set();

    for (const key of snapshotKeys) {
      const snapshots = all[key] || [];
      totalSnapshots += snapshots.length;
      snapshots.forEach(s => totalProfiles.add(`${s.platform}_${s.username}`));
    }

    return {
      totalSnapshots,
      totalProfiles: totalProfiles.size,
      totalPrivacyScans: privacyKeys.reduce((sum, k) => sum + (all[k]?.length || 0), 0),
      totalAlerts: (all.alerts || []).length,
      unreadAlerts: (all.alerts || []).filter(a => !a.read).length
    };
  },

  // ==================== Private Helpers ====================

  _snapshotKey(platform, username, type) {
    return `snapshots_${platform}_${username}_${type}`;
  },

  async _updateSnapshotIndex(platform, username, type, snapshotId) {
    const index = await this.get('snapshot_index') || {};
    const key = this._snapshotKey(platform, username, type);
    index[key] = { platform, username, type, lastUpdated: Date.now() };
    await this.set('snapshot_index', index);
  },

  /**
   * Chuẩn hóa giá trị để so sánh thay đổi profile.
   * - 'imageUrl': dành cho profile pic CDN. Instagram fbcdn URL có signed query
   *   (`stp`, `_nc_ht`, `_nc_cat`, `oh`, `oe`, ...) refresh mỗi vài phút mặc dù
   *   ảnh không đổi. Strip toàn bộ query, chỉ giữ origin + pathname để diff.
   *   Pathname Instagram dạng `/v/t51.../{hash}_{n}.jpg` ổn định cho cùng 1 ảnh.
   * - 'url': bio external link, strip tracking params phổ biến (utm_*, fbclid, gclid).
   */
  _normalizeForCompare(value, mode) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (!mode) return str;

    try {
      const u = new URL(str);
      if (mode === 'imageUrl') {
        // Bỏ toàn bộ query string — CDN signed params không có ý nghĩa identity
        return `${u.origin}${u.pathname}`;
      }
      if (mode === 'url') {
        // Bỏ tracking params nhưng giữ params khác
        const drop = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term',
                      'utm_content', 'fbclid', 'gclid', 'mc_cid', 'mc_eid',
                      '_ga', 'igshid', 'igsh'];
        for (const p of drop) u.searchParams.delete(p);
        // Bỏ trailing slash để `/path` và `/path/` coi như giống nhau
        const path = u.pathname.replace(/\/$/, '');
        return `${u.origin}${path}${u.search}`;
      }
    } catch { /* không phải URL hợp lệ → so sánh raw */ }

    return str;
  },

  _calculateRiskScore(results) {
    let score = 0;
    for (const finding of results) {
      switch (finding.severity) {
        case 'critical': score += 30; break;
        case 'high': score += 20; break;
        case 'medium': score += 10; break;
        case 'low': score += 5; break;
      }
    }
    return Math.min(score, 100);
  }
};
