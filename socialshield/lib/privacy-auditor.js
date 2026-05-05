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
   * Parse trang "Connected Apps" / "Apps and Websites":
   * trả về list { name, lastUsed, scope, platform } để user review hàng loạt.
   * Không tự revoke (cần user click → vẫn cần manual workflow).
   *
   * IG layout: /accounts/manage_access/ — danh sách app dưới dạng <a> hoặc <div>
   * trong các tab Active / Expired / Removed.
   * X layout: /settings/connected_apps — danh sách <a role="link"> chứa app name + scope.
   *
   * Vì DOM có thể đổi, scraping này best-effort + tolerant.
   *
   * @returns {Array<{name, lastUsed?, scope?, status?}>}
   */
  parseAppsPage() {
    const url = location.pathname.toLowerCase();
    const host = location.hostname;
    const apps = [];

    if (host.includes('instagram.com') &&
        (url.includes('manage_access') || url.includes('apps_and_websites'))) {
      // IG: mỗi entry thường là <a href> chứa text "AppName" + meta phụ
      // hoặc <div role="button"> với heading.
      const candidates = document.querySelectorAll(
        'a[role="link"], div[role="button"], main a, main [role="article"]'
      );
      const seen = new Set();
      for (const el of candidates) {
        const text = (el.innerText || '').trim();
        if (!text || text.length < 2 || text.length > 200) continue;
        // Skip nav/buttons
        if (/^(active|expired|removed|settings|cancel|edit|home|profile)$/i.test(text)) continue;
        // First line = app name thường
        const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
        if (lines.length === 0) continue;
        const name = lines[0];
        if (seen.has(name)) continue;
        if (name.length < 2 || name.length > 60) continue;
        seen.add(name);
        // Extract date-like: "Active until ..." / "Last used ..."
        const meta = lines.slice(1).join(' • ');
        const lastUsed = (meta.match(/(active until|last used|expires?)[^•]*/i) || [])[0] || null;
        // Determine status từ container heading lớn hơn
        let status = 'active';
        const ancestor = el.closest('section') || el.closest('[role="region"]') || el.parentElement;
        const heading = ancestor?.querySelector('h2, h3, [role="heading"]')?.innerText?.toLowerCase() || '';
        if (heading.includes('expired')) status = 'expired';
        else if (heading.includes('removed')) status = 'removed';
        apps.push({ platform: 'instagram', name, lastUsed, status, raw: meta });
      }
    } else if (/(x|twitter)\.com$/.test(host) && url.includes('connected_apps')) {
      const links = document.querySelectorAll('a[role="link"], a[href*="/connected_apps/"]');
      const seen = new Set();
      for (const el of links) {
        const text = (el.innerText || '').trim();
        if (!text) continue;
        const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
        const name = lines[0];
        if (!name || seen.has(name) || name.length > 80) continue;
        // Filter UI noise
        if (/^(connected apps|settings|back|done|revoke access)$/i.test(name)) continue;
        seen.add(name);
        const scope = lines.slice(1).find(l => /read|write|access|permission/i.test(l)) || null;
        apps.push({ platform: 'twitter', name, scope, raw: lines.slice(1).join(' • ') });
      }
    }

    return apps;
  },

  /**
   * Quick risk assessment cho 1 list apps.
   */
  assessApps(apps) {
    if (!apps || apps.length === 0) {
      return { count: 0, risk: 'none', recommendation: 'No connected apps detected.' };
    }
    const total = apps.length;
    const writeScope = apps.filter(a => /write|post|tweet|publish/i.test(a.scope || '')).length;
    let risk = 'low';
    if (total > 10 || writeScope > 3) risk = 'high';
    else if (total > 5 || writeScope > 1) risk = 'medium';
    return {
      count: total,
      writeScope,
      risk,
      recommendation: total > 5
        ? `${total} apps connected → review và revoke các app không nhận ra hoặc không dùng >6 tháng.`
        : `${total} apps — manageable, nhưng vẫn nên audit định kỳ.`,
    };
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
