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
    // Dùng userId (pk) làm key chính vì nó không bao giờ thay đổi.
    // Fallback sang username (normalized) cho snapshots cũ không có userId.
    const getKey = (u) => {
      if (u.userId) return String(u.userId);
      return (u.username || '').trim().toLowerCase();
    };
    const oldMap = new Map(oldSnap.data.map(u => [getKey(u), u]));
    const newMap = new Map(newSnap.data.map(u => [getKey(u), u]));

    const added = [];
    const removed = [];
    const unchanged = [];

    // Tìm users mới (có trong new, không có trong old)
    for (const [key, user] of newMap) {
      if (!oldMap.has(key)) {
        added.push(user);
      } else {
        unchanged.push(user);
      }
    }

    // Tìm users đã bị xóa (có trong old, không có trong new)
    for (const [key, user] of oldMap) {
      if (!newMap.has(key)) {
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

  // ==================== Bot Detection ====================

  /**
   * Tính bot score cho một user (0-100, cao = nghi bot)
   * @param {Object} user - user object từ snapshot
   * @returns {Object} { score, reasons }
   */
  scoreBotLikelihood(user) {
    let score = 0;
    const reasons = [];

    // 0. Verified account → chắc chắn không phải bot, return ngay
    if (user.isVerified) {
      return { score: 0, reasons: ['Verified account'], isLikelyBot: false };
    }

    // 1. has_anonymous_profile_picture — Instagram API field chính xác
    if (user.hasAnonymousProfilePic === true) {
      score += 25;
      reasons.push('No profile picture');
    }

    // 2. Username patterns: many digits, random chars
    const username = user.username || '';
    const digitCount = (username.match(/\d/g) || []).length;
    const digitRatio = digitCount / Math.max(username.length, 1);
    if (digitRatio > 0.5 && username.length > 5) {
      score += 20;
      reasons.push('Username mostly digits');
    }
    // Pattern: word + many digits (e.g., user382947123)
    if (/^[a-z]{2,8}\d{5,}$/i.test(username)) {
      score += 15;
      reasons.push('Generic username pattern');
    }
    // Excessive underscores/dots
    const specialCount = (username.match(/[._]/g) || []).length;
    if (specialCount >= 4) {
      score += 10;
      reasons.push('Many special characters in username');
    }

    // 4. No display name
    if (!user.displayName || user.displayName.trim() === '') {
      score += 15;
      reasons.push('No display name');
    }

    // 5. Display name matches username exactly (lazy bot setup)
    if (user.displayName && user.displayName.toLowerCase().replace(/\s/g, '') === username.toLowerCase()) {
      score += 10;
      reasons.push('Display name same as username');
    }

    // 6. Very short username (< 4 chars) with digits
    if (username.length <= 3 && digitCount > 0) {
      score += 10;
      reasons.push('Very short username with digits');
    }

    // === Twitter-specific signals (only available from Twitter API) ===

    // 7. Follow ratio bất thường: following rất nhiều nhưng follower rất ít
    if (user.followersCount !== undefined && user.followingCount !== undefined) {
      const followers = user.followersCount || 0;
      const following = user.followingCount || 0;
      if (following > 500 && followers < 10) {
        score += 25;
        reasons.push(`Extreme follow ratio (${following} following / ${followers} followers)`);
      } else if (following > 200 && followers > 0 && following / followers > 50) {
        score += 15;
        reasons.push('Suspicious follow/follower ratio');
      }
    }

    // 8. Tài khoản không có tweet nào (egg account)
    if (user.statusesCount !== undefined && user.statusesCount === 0) {
      score += 20;
      reasons.push('Zero tweets posted');
    } else if (user.statusesCount !== undefined && user.statusesCount < 3 &&
               user.followingCount !== undefined && user.followingCount > 100) {
      score += 15;
      reasons.push('Almost no tweets but follows many accounts');
    }

    return {
      score: Math.min(score, 100),
      reasons,
      isLikelyBot: score >= 40
    };
  },

  /**
   * Phân tích bot trong danh sách users từ snapshot
   * @param {Array} users - mảng user objects
   * @returns {Object} { botCount, totalAnalyzed, botRatio, bots, summary }
   */
  analyzeBots(users) {
    if (!users || users.length === 0) {
      return { botCount: 0, totalAnalyzed: 0, botRatio: 0, bots: [], summary: 'No users to analyze' };
    }

    const analyzed = users.map(user => ({
      ...user,
      botAnalysis: this.scoreBotLikelihood(user)
    }));

    const bots = analyzed
      .filter(u => u.botAnalysis.isLikelyBot)
      .sort((a, b) => b.botAnalysis.score - a.botAnalysis.score);

    const botRatio = bots.length / users.length;

    let summary;
    if (botRatio > 0.5) {
      summary = 'High bot ratio detected - over 50% of accounts show bot-like patterns';
    } else if (botRatio > 0.2) {
      summary = 'Moderate bot presence - about ' + Math.round(botRatio * 100) + '% show bot patterns';
    } else if (bots.length > 0) {
      summary = bots.length + ' potential bot account(s) detected';
    } else {
      summary = 'No obvious bot accounts detected';
    }

    return {
      botCount: bots.length,
      totalAnalyzed: users.length,
      botRatio: parseFloat((botRatio * 100).toFixed(1)),
      bots: bots.slice(0, 50), // Top 50 most suspicious
      summary
    };
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
