/**
 * SocialShield Privacy Settings Auditor
 *
 * Đọc trang Settings của Instagram & X/Twitter, chấm điểm "privacy posture":
 *  - Tài khoản public hay private?
 *  - Story public hay close-friends?
 *  - Cho phép tag/mention không?
 *  - Có bao nhiêu third-party app đã cấp quyền?
 *  - Login activity có session lạ không?
 *
 * Recon tools không thể đọc các settings này — đây là first-person view.
 *
 * Cách dùng: gọi từ content script khi user đang ở trang settings tương ứng.
 *   const audit = SocialShieldPrivacyAuditor.auditInstagram();
 *   const audit = SocialShieldPrivacyAuditor.auditTwitter();
 */

const SocialShieldPrivacyAuditor = {

  /**
   * Audit Instagram settings — gọi khi user ở /accounts/privacy_and_security/
   * hoặc các sub-page như /accounts/edit/, /accounts/login_activity/
   */
  auditInstagram() {
    const findings = [];
    let score = 100;
    const url = location.pathname;

    // Privacy & Security page
    if (url.includes('privacy_and_security') || url.includes('account_privacy')) {
      // Check toggle "Private Account"
      const privateToggle = this._findToggle(['private account', 'tài khoản riêng tư']);
      if (privateToggle && !privateToggle.checked) {
        findings.push({
          severity: 'medium',
          category: 'visibility',
          title: 'Account is Public',
          message: 'Bất kỳ ai cũng có thể xem post, story, follower của bạn.',
          recommendation: 'Cân nhắc switch sang private nếu là tài khoản cá nhân.',
        });
        score -= 15;
      }

      // Activity status
      const activityToggle = this._findToggle(['show activity status', 'hiển thị trạng thái hoạt động']);
      if (activityToggle && activityToggle.checked) {
        findings.push({
          severity: 'low',
          category: 'tracking',
          title: 'Activity Status Visible',
          message: 'Người khác thấy bạn online/offline real-time.',
          recommendation: 'Tắt nếu không muốn bị theo dõi pattern hoạt động.',
        });
        score -= 5;
      }

      // Story sharing
      const storyAllowReshare = this._findToggle(['allow sharing', 'cho phép chia sẻ story']);
      if (storyAllowReshare && storyAllowReshare.checked) {
        findings.push({
          severity: 'low',
          category: 'visibility',
          title: 'Story Resharing Enabled',
          message: 'Story của bạn có thể được người khác share lại.',
          recommendation: 'Tắt để giảm rủi ro nội dung lan rộng.',
        });
        score -= 5;
      }
    }

    // Login Activity / Active Sessions
    if (url.includes('login_activity') || url.includes('access_tool')) {
      const sessionItems = document.querySelectorAll('[role="button"]');
      const sessions = [];
      sessionItems.forEach(el => {
        const text = el.innerText || '';
        if (/active now|current|đang hoạt động/i.test(text)) sessions.push({ active: true, text });
        else if (/login|đăng nhập/i.test(text)) sessions.push({ text });
      });
      if (sessions.length > 3) {
        findings.push({
          severity: 'medium',
          category: 'session',
          title: `${sessions.length} active sessions detected`,
          message: 'Quá nhiều phiên đăng nhập đang active có thể là dấu hiệu tài khoản bị xâm nhập.',
          recommendation: 'Review và logout các session không nhận ra.',
        });
        score -= 10;
      }
    }

    // Apps and Websites (third-party access)
    if (url.includes('apps_and_websites') || url.includes('manage_access')) {
      const apps = document.querySelectorAll('[role="button"]');
      const activeApps = [...apps].filter(el => /active|đang hoạt động/i.test(el.innerText || '')).length;
      if (activeApps > 5) {
        findings.push({
          severity: 'medium',
          category: 'oauth',
          title: `${activeApps} third-party apps with access`,
          message: 'Quá nhiều app có quyền truy cập tài khoản tăng risk surface.',
          recommendation: 'Revoke các app không còn dùng.',
        });
        score -= 10;
      }
    }

    // 2FA check (account security)
    if (url.includes('two_factor') || url.includes('security')) {
      const tfaEnabled = this._findToggle(['two-factor', 'xác thực hai yếu tố']);
      if (tfaEnabled && !tfaEnabled.checked) {
        findings.push({
          severity: 'high',
          category: 'auth',
          title: '2FA Disabled',
          message: 'Không có 2FA → tài khoản chỉ dựa vào password (đã có thể bị leak).',
          recommendation: 'Bật 2FA bằng authenticator app (KHÔNG SMS).',
        });
        score -= 20;
      }
    }

    return {
      platform: 'instagram',
      url,
      score: Math.max(score, 0),
      findings,
      auditedAt: new Date().toISOString(),
      contextNote: findings.length === 0 && url !== '/' ?
        'No issues detected on this page — navigate to other settings pages for full audit.' : null,
    };
  },

  /**
   * Audit X/Twitter settings — gọi khi ở /settings/* các sub-page.
   */
  auditTwitter() {
    const findings = [];
    let score = 100;
    const url = location.pathname;

    // Privacy and Safety
    if (url.includes('privacy_and_safety') || url.includes('audience_and_tagging')) {
      const protectToggle = this._findToggleByText('protect your posts');
      if (protectToggle && !protectToggle.checked) {
        findings.push({
          severity: 'medium',
          category: 'visibility',
          title: 'Tweets are Public',
          message: 'Tất cả tweet visible với mọi người, không cần follow.',
          recommendation: 'Bật "Protect your posts" nếu là tài khoản cá nhân.',
        });
        score -= 15;
      }

      // Photo tagging
      const tagPolicy = document.body.innerText.match(/who can tag you[\s\S]{0,100}/i);
      if (tagPolicy && /everyone|anyone/i.test(tagPolicy[0])) {
        findings.push({
          severity: 'low',
          category: 'visibility',
          title: 'Anyone can tag you',
          message: 'Stranger có thể tag bạn vào ảnh không liên quan.',
          recommendation: 'Đổi sang "Only people you follow".',
        });
        score -= 5;
      }
    }

    // Discoverability
    if (url.includes('discoverability_and_contacts')) {
      const findByEmail = this._findToggleByText('let people who have your email');
      if (findByEmail && findByEmail.checked) {
        findings.push({
          severity: 'low',
          category: 'tracking',
          title: 'Findable by Email',
          message: 'Email address bạn dùng có thể link đến account này.',
          recommendation: 'Tắt nếu muốn dissociate email khỏi public profile.',
        });
        score -= 5;
      }
      const findByPhone = this._findToggleByText('let people who have your phone');
      if (findByPhone && findByPhone.checked) {
        findings.push({
          severity: 'medium',
          category: 'tracking',
          title: 'Findable by Phone',
          message: 'SĐT có thể link đến account → SIM-swap targeting risk.',
          recommendation: 'Tắt option này.',
        });
        score -= 10;
      }
    }

    // Sessions
    if (url.includes('sessions') || url.includes('apps_and_sessions')) {
      const sessionRows = document.querySelectorAll('[data-testid*="session"], [role="link"]');
      if (sessionRows.length > 5) {
        findings.push({
          severity: 'medium',
          category: 'session',
          title: `${sessionRows.length} sessions detected`,
          message: 'Nhiều session đăng nhập từ device khác nhau.',
          recommendation: 'Review từng session, logout cái không nhận ra.',
        });
        score -= 10;
      }
    }

    // Connected apps
    if (url.includes('connected_apps')) {
      const apps = document.querySelectorAll('[role="link"]');
      if (apps.length > 5) {
        findings.push({
          severity: 'medium',
          category: 'oauth',
          title: `${apps.length} connected apps`,
          message: 'Mỗi app có scope quyền riêng — nhiều app = attack surface lớn.',
          recommendation: 'Revoke app không còn dùng.',
        });
        score -= 10;
      }
    }

    // 2FA
    if (url.includes('two-factor') || url.includes('account_security')) {
      const tfa = this._findToggleByText('two-factor authentication');
      if (tfa && !tfa.checked) {
        findings.push({
          severity: 'high',
          category: 'auth',
          title: '2FA Disabled',
          message: 'Tài khoản chỉ dựa vào password.',
          recommendation: 'Bật 2FA bằng authenticator app.',
        });
        score -= 20;
      }
    }

    return {
      platform: 'twitter',
      url,
      score: Math.max(score, 0),
      findings,
      auditedAt: new Date().toISOString(),
    };
  },

  // ==================== Helpers ====================

  /**
   * Tìm toggle/switch có label chứa 1 trong các text strings (case-insensitive).
   * Trả về element checkbox/switch hoặc null.
   */
  _findToggle(textCandidates) {
    const lowerCandidates = textCandidates.map(t => t.toLowerCase());
    const labels = document.querySelectorAll('label, [role="switch"], div, span');
    for (const el of labels) {
      const text = (el.innerText || '').toLowerCase();
      if (lowerCandidates.some(c => text.includes(c))) {
        // Tìm input checkbox/switch nearby
        const input = el.querySelector('input[type="checkbox"], [role="switch"]') ||
                      el.parentElement?.querySelector('input[type="checkbox"], [role="switch"]');
        if (input) {
          return {
            element: input,
            checked: input.checked || input.getAttribute('aria-checked') === 'true',
          };
        }
      }
    }
    return null;
  },

  _findToggleByText(text) {
    return this._findToggle([text]);
  },

  /**
   * Get summary từ audit result.
   */
  summarize(audit) {
    if (!audit) return 'No audit data';
    const sev = { high: 0, medium: 0, low: 0 };
    for (const f of audit.findings) sev[f.severity] = (sev[f.severity] || 0) + 1;
    return `Privacy Posture: ${audit.score}/100. Issues: ${sev.high} high, ${sev.medium} medium, ${sev.low} low.`;
  }
};
