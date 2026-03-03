/**
 * SocialShield Diff Engine
 * So sánh snapshots và phát hiện hoạt động bất thường
 */
const SocialShieldDiff = {

  /**
   * So sánh 2 snapshots
   * @param {Object} oldSnap - snapshot cũ
   * @param {Object} newSnap - snapshot mới
   * @returns {Object} kết quả diff
   */
  compare(oldSnap, newSnap) {
    const oldMap = new Map(oldSnap.data.map(u => [u.username, u]));
    const newMap = new Map(newSnap.data.map(u => [u.username, u]));

    const added = [];
    const removed = [];
    const unchanged = [];

    // Tìm users mới (có trong new, không có trong old)
    for (const [username, user] of newMap) {
      if (!oldMap.has(username)) {
        added.push(user);
      } else {
        unchanged.push(user);
      }
    }

    // Tìm users đã bị xóa (có trong old, không có trong new)
    for (const [username, user] of oldMap) {
      if (!newMap.has(username)) {
        removed.push(user);
      }
    }

    const totalChange = added.length + removed.length;
    const baseCount = Math.max(oldSnap.data.length, 1);

    return {
      oldSnapshot: {
        id: oldSnap.id,
        timestamp: oldSnap.timestamp,
        count: oldSnap.data.length
      },
      newSnapshot: {
        id: newSnap.id,
        timestamp: newSnap.timestamp,
        count: newSnap.data.length
      },
      added,
      removed,
      unchanged,
      summary: {
        addedCount: added.length,
        removedCount: removed.length,
        unchangedCount: unchanged.length,
        netChange: added.length - removed.length,
        changeRate: parseFloat(((totalChange / baseCount) * 100).toFixed(1)),
        timeDiff: this._timeDiff(oldSnap.timestamp, newSnap.timestamp)
      }
    };
  },

  /**
   * Phát hiện hoạt động bất thường từ kết quả diff
   */
  detectSuspicious(diff, thresholds = null) {
    const defaults = {
      massFollow: 20,
      massUnfollow: 10,
      changeRate: 30,
      botRatio: 0.5
    };
    const t = thresholds || defaults;
    const alerts = [];

    // Mass follow detection
    if (diff.summary.addedCount >= t.massFollow) {
      alerts.push({
        type: 'mass_follow',
        severity: 'warning',
        title: 'Mass Follow Detected',
        message: `${diff.summary.addedCount} new connections added in ${diff.summary.timeDiff}`,
        count: diff.summary.addedCount
      });
    }

    // Mass unfollow detection
    if (diff.summary.removedCount >= t.massUnfollow) {
      alerts.push({
        type: 'mass_unfollow',
        severity: 'danger',
        title: 'Mass Unfollow Detected',
        message: `${diff.summary.removedCount} connections removed in ${diff.summary.timeDiff}`,
        count: diff.summary.removedCount
      });
    }

    // High change rate
    if (diff.summary.changeRate >= t.changeRate) {
      alerts.push({
        type: 'high_change_rate',
        severity: 'danger',
        title: 'Unusual Activity',
        message: `${diff.summary.changeRate}% change rate detected - possible account compromise`,
        rate: diff.summary.changeRate
      });
    }

    // Rapid follower spike (potential bot attack)
    if (diff.summary.addedCount > 0) {
      const hours = this._hoursBetween(diff.oldSnapshot.timestamp, diff.newSnapshot.timestamp);
      if (hours > 0 && hours < 24 && diff.summary.addedCount / hours > 10) {
        alerts.push({
          type: 'follower_spike',
          severity: 'warning',
          title: 'Follower Spike',
          message: `${(diff.summary.addedCount / hours).toFixed(0)} new connections/hour - possible bot activity`
        });
      }
    }

    return alerts;
  },

  /**
   * Tạo timeline từ nhiều snapshots
   */
  buildTimeline(snapshots) {
    if (!snapshots || snapshots.length === 0) return [];

    return snapshots.map((snap, index) => {
      const entry = {
        id: snap.id,
        timestamp: snap.timestamp,
        count: snap.count,
        change: 0,
        changeType: 'none'
      };

      if (index > 0) {
        entry.change = snap.count - snapshots[index - 1].count;
        entry.changeType = entry.change > 0 ? 'increase' : entry.change < 0 ? 'decrease' : 'none';
      }

      return entry;
    });
  },

  // ==================== Private Helpers ====================

  _timeDiff(timestamp1, timestamp2) {
    const ms = Math.abs(new Date(timestamp2) - new Date(timestamp1));
    const hours = ms / (1000 * 60 * 60);
    if (hours < 1) return `${Math.round(ms / (1000 * 60))} minutes`;
    if (hours < 24) return `${Math.round(hours)} hours`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days} days`;
    return `${Math.round(days / 30)} months`;
  },

  _hoursBetween(timestamp1, timestamp2) {
    return Math.abs(new Date(timestamp2) - new Date(timestamp1)) / (1000 * 60 * 60);
  }
};
