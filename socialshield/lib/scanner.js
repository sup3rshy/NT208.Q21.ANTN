/**
 * SocialShield Scanner Module
 * Quét bảo mật và quyền riêng tư trên trang mạng xã hội
 */
const SocialShieldScanner = {

  // ==================== Privacy Scanner ====================

  /**
   * Quét văn bản để tìm thông tin cá nhân bị lộ
   * @param {string} text - nội dung cần quét
   * @returns {Array} danh sách findings
   */
  scanPrivacy(text) {
    if (!text) return [];
    const findings = [];

    // Email addresses
    const emails = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g);
    if (emails) {
      findings.push({
        type: 'email',
        severity: 'high',
        icon: '📧',
        title: 'Email Address Exposed',
        message: `${emails.length} email address(es) found publicly visible`,
        values: [...new Set(emails)]
      });
    }

    // Vietnamese phone numbers
    const vnPhones = text.match(/(?:\+84|0)(?:3[2-9]|5[689]|7[06-9]|8[1-9]|9[0-46-9])\d{7}/g);
    if (vnPhones) {
      findings.push({
        type: 'phone_vn',
        severity: 'high',
        icon: '📱',
        title: 'Vietnamese Phone Number',
        message: `${vnPhones.length} VN phone number(s) exposed`,
        values: [...new Set(vnPhones)]
      });
    }

    // International phone numbers
    const intlPhones = text.match(/\+\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g);
    if (intlPhones) {
      const unique = [...new Set(intlPhones)].filter(p => {
        return !vnPhones || !vnPhones.some(vp => p.includes(vp));
      });
      if (unique.length > 0) {
        findings.push({
          type: 'phone_intl',
          severity: 'high',
          icon: '☎️',
          title: 'Phone Number Exposed',
          message: `${unique.length} phone number(s) found`,
          values: unique
        });
      }
    }

    // Physical addresses (basic patterns)
    const addressPatterns = [
      /\d+\s+(?:đường|phố|street|st|avenue|ave|road|rd|lane|ln)\s+[A-Za-zÀ-ỹ\s]+/gi,
      /(?:quận|huyện|district|phường|ward)\s+[A-Za-zÀ-ỹ0-9\s]+/gi
    ];
    for (const pattern of addressPatterns) {
      const addresses = text.match(pattern);
      if (addresses) {
        findings.push({
          type: 'address',
          severity: 'medium',
          icon: '📍',
          title: 'Physical Address Detected',
          message: 'Location information may be exposed',
          values: [...new Set(addresses)]
        });
        break;
      }
    }

    // Social Security / ID numbers (Vietnamese CCCD)
    const cccdPattern = /\b0\d{11}\b/g;
    const cccdMatches = text.match(cccdPattern);
    if (cccdMatches) {
      findings.push({
        type: 'national_id',
        severity: 'critical',
        icon: '🚨',
        title: 'National ID Number',
        message: 'Possible Vietnamese CCCD/CMND number exposed - CRITICAL RISK',
        values: [...new Set(cccdMatches)]
      });
    }

    // Date of birth patterns
    const dobPatterns = [
      /(?:born|sinh|birthday|ngày sinh)[:\s]+\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/gi,
      /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4}\b/g
    ];
    for (const pattern of dobPatterns) {
      const dobs = text.match(pattern);
      if (dobs) {
        findings.push({
          type: 'dob',
          severity: 'medium',
          icon: '🎂',
          title: 'Date of Birth',
          message: 'Date of birth information may be exposed',
          values: [...new Set(dobs)]
        });
        break;
      }
    }

    // Bank account numbers (Vietnamese) - chỉ match khi có context
    const bankContext = text.match(/(?:stk|số tài khoản|account\s*(?:number|no)|bank\s*account)[:\s]*(\d{9,19})/gi);
    if (bankContext) {
      findings.push({
        type: 'bank_account',
        severity: 'critical',
        icon: '🏦',
        title: 'Bank Account Number',
        message: 'Bank account number may be exposed - CRITICAL RISK',
        values: [...new Set(bankContext)]
      });
    }

    // Credit card numbers (basic Luhn-compatible patterns)
    const ccPatterns = text.match(/\b(?:4\d{3}|5[1-5]\d{2}|6(?:011|5\d{2}))[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g);
    if (ccPatterns) {
      findings.push({
        type: 'credit_card',
        severity: 'critical',
        icon: '💳',
        title: 'Credit Card Number',
        message: 'Possible credit card number exposed - CRITICAL RISK',
        values: ccPatterns.map(c => c.replace(/\d(?=\d{4})/g, '*'))
      });
    }

    // API keys / tokens (generic patterns)
    const tokenPatterns = [
      /(?:api[_-]?key|token|secret|password)[=:\s]+['"]?[A-Za-z0-9_\-]{20,}['"]?/gi,
      /(?:sk|pk)[-_](?:live|test)[-_][A-Za-z0-9]{20,}/g,
      /ghp_[A-Za-z0-9]{36}/g,
      /AIza[A-Za-z0-9_\-]{35}/g,
    ];
    for (const pattern of tokenPatterns) {
      const tokens = text.match(pattern);
      if (tokens) {
        findings.push({
          type: 'api_token',
          severity: 'critical',
          icon: '🔑',
          title: 'API Key / Token Exposed',
          message: 'Possible API key or authentication token found - CRITICAL RISK',
          values: tokens.map(t => t.substring(0, 15) + '...[REDACTED]')
        });
        break;
      }
    }

    // Crypto wallet addresses
    const btcWallet = text.match(/\b(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}\b/g);
    const ethWallet = text.match(/\b0x[a-fA-F0-9]{40}\b/g);
    if (btcWallet || ethWallet) {
      const wallets = [...(btcWallet || []), ...(ethWallet || [])];
      findings.push({
        type: 'crypto_wallet',
        severity: 'medium',
        icon: '🪙',
        title: 'Cryptocurrency Wallet Address',
        message: `${wallets.length} crypto wallet address(es) found - may attract targeted attacks`,
        values: [...new Set(wallets)]
      });
    }

    // ========== Vietnam-specific patterns ==========

    // Biển số xe VN — chặt format chuẩn:
    //  - 2 số đầu (mã tỉnh 11-99), dấu "-" gần như bắt buộc, chữ cái đầu A-Z
    //  - Phải có dấu chấm hoặc khoảng trắng tách 5 chữ số cuối kiểu "12345" hoặc "123.45"
    //  Ví dụ thật: 51K-12345, 30A-123.45, 59-X1 1234.56
    //  Tránh match version/build: "v1.2 A 12345", hash, etc.
    const vnPlate = text.match(/\b[1-9][0-9]-[A-Z][A-Z0-9]?\s?\d{3}\.?\d{2,3}\b/g);
    if (vnPlate && vnPlate.length > 0) {
      findings.push({
        type: 'vn_license_plate',
        severity: 'medium',
        icon: '🚗',
        title: 'Vehicle License Plate (VN)',
        message: 'Biển số xe có thể bị lộ - dễ bị truy ngược chủ sở hữu',
        values: [...new Set(vnPlate)]
      });
    }

    // Mã sinh viên VN — yêu cầu PHẢI có context word.
    //  Pattern naked "2x5xxxxx" 7 chữ số quá rộng (match được năm sản xuất, ID bất kỳ).
    const studentIdPatterns = [
      /\b(?:MSSV|mã\s*số\s*sinh\s*viên|student\s*id)[:\s]*(\d{7,10})\b/gi,
    ];
    for (const pattern of studentIdPatterns) {
      const m = text.match(pattern);
      if (m) {
        findings.push({
          type: 'vn_student_id',
          severity: 'medium',
          icon: '🎓',
          title: 'Vietnamese Student ID',
          message: 'Mã sinh viên có thể giúp tra cứu thông tin trên hệ thống nhà trường',
          values: [...new Set(m)]
        });
        break;
      }
    }

    // MoMo / Zalo / VietQR references — số ĐT kèm context payment
    const paymentContext = text.match(/(?:momo|zalopay|vietqr|chuy[eể]n\s*kho[ảa]n|stk|s[oố]\s*tk)[:\s]+(?:0\d{9,10}|\+?\d{9,12})/gi);
    if (paymentContext) {
      findings.push({
        type: 'vn_payment_handle',
        severity: 'high',
        icon: '💸',
        title: 'Payment Handle Exposed (MoMo/ZaloPay/VietQR)',
        message: 'Số ĐT/STK gắn với payment app dễ bị scam chuyển khoản giả mạo',
        values: [...new Set(paymentContext)].map(v => v.substring(0, 30))
      });
    }

    // Trường học / nơi làm việc - yêu cầu \b để tránh "[B]reaking[Co]llege"
    // và bắt buộc capture-group bắt đầu bằng chữ HOA (tên riêng).
    const schoolWorkPattern = text.match(
      /\b(?:trường|university|college|công\s*ty|làm\s*tại|work\s*at|study\s*at|sinh\s*viên\s*tại)[:\s]+([A-ZĐ][A-Za-zÀ-ỹ][A-Za-zÀ-ỹ\s]{2,40})/gi
    );
    if (schoolWorkPattern && schoolWorkPattern.length > 0) {
      findings.push({
        type: 'school_or_work',
        severity: 'low',
        icon: '🏢',
        title: 'School/Workplace Mentioned',
        message: 'Nơi học/làm có thể giúp attacker xây dựng pretext (social engineering)',
        values: [...new Set(schoolWorkPattern)].slice(0, 5)
      });
    }

    // Geo / địa chỉ chi tiết — yêu cầu chặt:
    //  - Số nhà + KHOẢNG TRẮNG + từ "đường"/"phố"/"street"/"road" ĐẦY ĐỦ (có \b và space sau)
    //    → tránh case "3d visualizations" match "d" đơn.
    //  - PHẢI có hậu tố quận/phường/ward/district để confirm là địa chỉ thật,
    //    không phải đoạn text bất kỳ chứa số + "street".
    const detailedAddr = text.match(
      /\b\d{1,4}[A-Za-z]?(?:\s*\/\s*\d+)?\s+(?:đường|phố|street|road)\s+[A-ZĐ][\wÀ-ỹ\s]{2,30},?\s*(?:phường|quận|huyện|p\.|q\.|h\.|ward|district)\s+[\wÀ-ỹ0-9\s]{1,30}/gi
    );
    if (detailedAddr) {
      findings.push({
        type: 'detailed_address',
        severity: 'high',
        icon: '🗺️',
        title: 'Detailed Address',
        message: 'Địa chỉ cụ thể có thể bị dùng để stalking hoặc swatting',
        values: [...new Set(detailedAddr)].slice(0, 3)
      });
    }

    // Family relations - tag mẹ/bố/anh/em → suy ra họ thật & gia đình
    const familyTag = text.match(/(?:mẹ|me|bố|ba|cha|anh trai|chị gái|em gái|em trai|mom|dad|sister|brother)[\s:]+@[a-zA-Z0-9._]+/gi);
    if (familyTag) {
      findings.push({
        type: 'family_relation',
        severity: 'medium',
        icon: '👨‍👩‍👧',
        title: 'Family Member Tagged',
        message: 'Gắn thẻ người thân tiết lộ quan hệ gia đình - hỗ trợ social engineering',
        values: [...new Set(familyTag)].slice(0, 5)
      });
    }

    // Passport number patterns (Vietnamese)
    const passportVN = text.match(/\b[A-Z]\d{7}\b/g);
    if (passportVN) {
      // Phân biệt với các mã khác: chỉ cảnh báo nếu có context
      const hasContext = /(?:passport|hộ chiếu|CMND|identification)/i.test(text);
      if (hasContext) {
        findings.push({
          type: 'passport',
          severity: 'critical',
          icon: '🛂',
          title: 'Passport / ID Number',
          message: 'Possible passport or identification number exposed',
          values: [...new Set(passportVN)]
        });
      }
    }

    return findings;
  },

  // ==================== Data Breach Check ====================

  /**
   * Kiểm tra email có bị lộ trong các vụ data breach không
   * Chuỗi ưu tiên: XposedOrNot (free) → HackCheck (free) → domain heuristic
   * @param {string} email - email cần kiểm tra
   * @returns {Object|null} kết quả kiểm tra
   */
  async checkEmailBreach(email) {
    if (!email) return null;

    // 1. XposedOrNot API (free, không cần API key)
    try {
      const xonResult = await this._checkXposedOrNot(email);
      if (xonResult) return xonResult;
    } catch (err) {
      console.warn('[SocialShield] XposedOrNot failed, trying fallback:', err.message);
    }

    // 2. HackCheck API (free, CORS enabled)
    try {
      const hcResult = await this._checkHackCheck(email);
      if (hcResult) return hcResult;
    } catch (err) {
      console.warn('[SocialShield] HackCheck failed, trying fallback:', err.message);
    }

    // 3. Domain heuristic fallback
    return this._checkDomainHeuristic(email);
  },

  /**
   * XposedOrNot API - free email breach check with rich analytics
   * Rate limit: 1 req/sec
   */
  async _checkXposedOrNot(email) {
    const res = await fetch(
      `https://api.xposedornot.com/v1/check-email/${encodeURIComponent(email)}`,
      { headers: { 'User-Agent': 'SocialShield-Extension' } }
    );

    if (res.status === 404 || res.status === 204) {
      return { breached: false, breachCount: 0, breaches: [], source: 'XposedOrNot' };
    }

    if (!res.ok) return null;

    const data = await res.json();

    // XposedOrNot trả về Error nếu không tìm thấy
    if (data.Error) {
      return { breached: false, breachCount: 0, breaches: [], source: 'XposedOrNot' };
    }

    // Lấy danh sách breach names
    const breachList = data.breaches || [];
    if (breachList.length === 0) {
      return { breached: false, breachCount: 0, breaches: [], source: 'XposedOrNot' };
    }

    return {
      breached: true,
      breachCount: breachList.length,
      breaches: breachList.slice(0, 20),
      source: 'XposedOrNot',
    };
  },

  /**
   * HackCheck API v4 - free breach check with detailed info
   * CORS enabled, no API key
   */
  async _checkHackCheck(email) {
    const res = await fetch(
      `https://hackcheck.woventeams.com/api/v4/breachedaccount/${encodeURIComponent(email)}`,
      { headers: { 'User-Agent': 'SocialShield-Extension' } }
    );

    if (res.status === 404) {
      return { breached: false, breachCount: 0, breaches: [], source: 'HackCheck' };
    }

    if (!res.ok) return null;

    const breaches = await res.json();
    if (!Array.isArray(breaches) || breaches.length === 0) {
      return { breached: false, breachCount: 0, breaches: [], source: 'HackCheck' };
    }

    return {
      breached: true,
      breachCount: breaches.length,
      breaches: breaches.slice(0, 20).map(b => b.Name || b.Title || 'Unknown'),
      dataClasses: [...new Set(breaches.flatMap(b => b.DataClasses || []))],
      source: 'HackCheck',
    };
  },

  /**
   * Fallback: kiểm tra domain dựa trên danh sách dịch vụ đã bị breach lớn
   */
  _checkDomainHeuristic(email) {
    try {
      const domain = email.split('@')[1]?.toLowerCase();
      if (!domain) return null;

      const knownBreachedDomains = [
        'yahoo.com', 'yahoo.co', 'linkedin.com', 'adobe.com',
        'myspace.com', 'dropbox.com', 'tumblr.com', 'lastfm.com',
        'canva.com', 'dubsmash.com', 'zynga.com', 'wattpad.com',
      ];

      const highRiskProviders = [
        'gmail.com', 'hotmail.com', 'outlook.com', 'mail.com',
        'yahoo.com', 'aol.com', 'protonmail.com',
      ];

      if (knownBreachedDomains.includes(domain)) {
        return {
          breached: true,
          breachCount: -1,
          breaches: ['Domain has known major breaches'],
          source: 'heuristic',
          note: 'Based on known breach database. Check haveibeenpwned.com for details.'
        };
      }

      if (highRiskProviders.includes(domain)) {
        return {
          breached: null,
          breachCount: -1,
          breaches: [],
          source: 'heuristic',
          note: 'Common email provider - recommend checking at haveibeenpwned.com'
        };
      }

      return { breached: false, breachCount: 0, breaches: [], source: 'heuristic' };
    } catch {
      return null;
    }
  },

  /**
   * Kiểm tra password đã bị lộ trong breach database không
   * Sử dụng HIBP Pwned Passwords API (free, k-anonymity SHA-1)
   * Chỉ gửi 5 ký tự đầu của SHA-1 hash → privacy-preserving
   * @param {string} password - password cần kiểm tra
   * @returns {Object} { pwned: boolean, count: number }
   */
  async checkPasswordPwned(password) {
    if (!password || password.length < 4) return { pwned: false, count: 0 };

    try {
      // SHA-1 hash password
      const encoder = new TextEncoder();
      const data = encoder.encode(password);
      const hashBuffer = await crypto.subtle.digest('SHA-1', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

      const prefix = hashHex.substring(0, 5);
      const suffix = hashHex.substring(5);

      // k-anonymity: chỉ gửi 5 ký tự đầu
      const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true' }
      });

      if (!res.ok) return { pwned: false, count: 0 };

      const text = await res.text();
      const lines = text.split('\n');

      for (const line of lines) {
        const [hashSuffix, count] = line.trim().split(':');
        if (hashSuffix === suffix) {
          return { pwned: true, count: parseInt(count, 10) || 0 };
        }
      }

      return { pwned: false, count: 0 };
    } catch (err) {
      console.warn('[SocialShield] Pwned password check failed:', err.message);
      return { pwned: false, count: 0 };
    }
  },

  /**
   * Đánh giá mức độ an toàn password (entropy-based)
   * Không lưu password - chỉ phân tích pattern
   * @param {string} text - text có thể chứa password
   * @returns {Array} findings nếu phát hiện password yếu
   */
  checkPasswordExposure(text) {
    const findings = [];

    // Phát hiện password viết plaintext.
    // Yêu cầu strict:
    //  - Từ context phải đầy đủ ("password", "passwd", "mật khẩu") — KHÔNG match "pass"/"mk"/"pw" trần
    //    vì "pass UAC", "pass local", "mk dir" đầy trong code/article → noise lớn.
    //  - Phải có ký hiệu gán : hoặc = (không chỉ space) — viết tự nhiên kiểu "the password is X"
    //    hiếm khi xuất hiện trong bio/caption.
    //  - Min 6 ký tự cho password (4 quá ngắn → match version, mã viết tắt).
    const pwdPatterns = [
      /\b(?:password|passwd|mật\s*khẩu)\s*[:=]\s*['"]?([A-Za-z0-9!@#$%^&*()_+\-={}\[\]|:;<>,.?/~`]{6,30})['"]?/gi,
      /\b(?:pin|mã\s*pin)\s*[:=]\s*(\d{4,8})\b/gi,
    ];

    for (const pattern of pwdPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        findings.push({
          type: 'password_exposed',
          severity: 'critical',
          icon: '🔓',
          title: 'Password/PIN Exposed',
          message: 'Password or PIN code appears to be written in plain text - CRITICAL RISK',
          values: matches.map(m => m.substring(0, 10) + '...[REDACTED]')
        });
        break;
      }
    }

    return findings;
  },

  // ==================== Security Recommendations ====================

  /**
   * Tạo danh sách recommendations dựa trên findings
   * @param {Array} findings - kết quả từ scanPrivacy
   * @param {Object} profileData - thông tin profile
   * @returns {Array} danh sách khuyến nghị bảo mật
   */
  generateSecurityRecommendations(findings, profileData = {}) {
    const recommendations = [];

    const typeSet = new Set(findings.map(f => f.type));

    if (typeSet.has('email')) {
      recommendations.push({
        icon: '📧',
        title: 'Remove Email from Public Profile',
        description: 'Move email to private contact info or use a dedicated public email',
        priority: 'high'
      });
    }

    if (typeSet.has('phone_vn') || typeSet.has('phone_intl')) {
      recommendations.push({
        icon: '📱',
        title: 'Remove Phone Number',
        description: 'Phone numbers enable SIM-swap attacks and spam. Use messaging apps instead',
        priority: 'high'
      });
    }

    if (typeSet.has('national_id') || typeSet.has('passport')) {
      recommendations.push({
        icon: '🚨',
        title: 'URGENT: Remove ID Numbers',
        description: 'National ID/passport numbers can be used for identity theft. Remove immediately',
        priority: 'critical'
      });
    }

    if (typeSet.has('bank_account') || typeSet.has('credit_card')) {
      recommendations.push({
        icon: '💳',
        title: 'URGENT: Remove Financial Info',
        description: 'Bank/card numbers enable financial fraud. Remove and monitor your accounts',
        priority: 'critical'
      });
    }

    if (typeSet.has('api_token')) {
      recommendations.push({
        icon: '🔑',
        title: 'Rotate Exposed API Keys',
        description: 'Regenerate all exposed API keys/tokens immediately. They may already be compromised',
        priority: 'critical'
      });
    }

    if (typeSet.has('password_exposed')) {
      recommendations.push({
        icon: '🔒',
        title: 'Change Exposed Passwords',
        description: 'Change passwords on all accounts that used the exposed password. Enable 2FA',
        priority: 'critical'
      });
    }

    if (typeSet.has('crypto_wallet')) {
      recommendations.push({
        icon: '🪙',
        title: 'Monitor Crypto Wallets',
        description: 'Public wallet addresses attract phishing. Consider using separate wallets for public display',
        priority: 'medium'
      });
    }

    if (!profileData.isPrivate) {
      recommendations.push({
        icon: '🔐',
        title: 'Consider Private Account',
        description: 'A private account limits who can see your information',
        priority: 'low'
      });
    }

    // General recommendations
    recommendations.push({
      icon: '🛡️',
      title: 'Enable Two-Factor Authentication',
      description: 'Protect your account with 2FA (authenticator app preferred over SMS)',
      priority: 'medium'
    });

    return recommendations;
  },

  // ==================== Link Scanner ====================

  /**
   * Kiểm tra URL có an toàn không
   * @param {string} url
   * @returns {Object} kết quả kiểm tra
   */
  checkLink(url) {
    const result = {
      url,
      safe: true,
      warnings: [],
      score: 100 // 100 = safe, 0 = dangerous
    };

    try {
      const parsed = new URL(url);

      // Check URL shorteners (often used for phishing)
      const shorteners = [
        'bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'is.gd',
        'buff.ly', 'ow.ly', 'rebrand.ly', 'bl.ink', 'short.io'
      ];
      if (shorteners.some(s => parsed.hostname.includes(s))) {
        result.warnings.push({
          type: 'url_shortener',
          severity: 'low',
          message: 'URL shortener detected - destination unknown'
        });
        result.score -= 15;
      }

      // Check for suspicious social media typosquatting domains
      const suspiciousDomains = [
        /instagr[^a]m/i, /1nstagram/i, /instagram\d/i,
        /instag\.ram/i, /lnstagram/i, /instagran/i,
        /tw[^i]tter/i, /twltter/i, /twitter\d/i, /twiiter/i,
        /x\.com\./i,
      ];
      for (const pattern of suspiciousDomains) {
        if (pattern.test(parsed.hostname)) {
          result.warnings.push({
            type: 'typosquatting',
            severity: 'high',
            message: 'Possible typosquatting attack - fake domain mimicking social media'
          });
          result.safe = false;
          result.score -= 40;
          break;
        }
      }

      // Check for phishing keywords in URL
      const phishingKeywords = [
        'login', 'verify', 'confirm', 'secure', 'update',
        'account', 'suspended', 'password', 'authenticate'
      ];
      const urlLower = url.toLowerCase();
      const phishCount = phishingKeywords.filter(kw => urlLower.includes(kw)).length;
      if (phishCount >= 2) {
        result.warnings.push({
          type: 'phishing_keywords',
          severity: 'medium',
          message: `Multiple phishing-related keywords found in URL (${phishCount})`
        });
        result.score -= phishCount * 10;
      }

      // Check for suspicious free offer keywords
      const scamKeywords = [
        'free-followers', 'free-likes', 'get-followers',
        'hack-instagram', 'free-verification', 'blue-badge'
      ];
      if (scamKeywords.some(kw => urlLower.includes(kw))) {
        result.warnings.push({
          type: 'scam',
          severity: 'high',
          message: 'URL contains scam/fraud-related keywords'
        });
        result.safe = false;
        result.score -= 50;
      }

      // Check for IP address instead of domain
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parsed.hostname)) {
        result.warnings.push({
          type: 'ip_address',
          severity: 'medium',
          message: 'URL uses IP address instead of domain name'
        });
        result.score -= 20;
      }

      // Check for non-HTTPS
      if (parsed.protocol === 'http:') {
        result.warnings.push({
          type: 'no_https',
          severity: 'medium',
          message: 'Connection is not encrypted (HTTP instead of HTTPS)'
        });
        result.score -= 15;
      }

      // Check for excessive subdomains
      const subdomainCount = parsed.hostname.split('.').length - 2;
      if (subdomainCount > 2) {
        result.warnings.push({
          type: 'excessive_subdomains',
          severity: 'low',
          message: 'Unusual number of subdomains'
        });
        result.score -= 10;
      }

      // Homograph attack detection (mixed scripts)
      if (/[а-яА-Я]/.test(parsed.hostname) || /[\u0400-\u04FF]/.test(parsed.hostname)) {
        result.warnings.push({
          type: 'homograph',
          severity: 'high',
          message: 'Possible homograph attack - URL contains Cyrillic characters'
        });
        result.safe = false;
        result.score -= 50;
      }

    } catch (e) {
      result.warnings.push({
        type: 'invalid_url',
        severity: 'high',
        message: 'URL format is invalid'
      });
      result.safe = false;
      result.score = 0;
    }

    result.score = Math.max(result.score, 0);
    if (result.score < 50) result.safe = false;

    return result;
  },

  /**
   * Quét tất cả links trên trang hiện tại
   * @param {Document|Element} root - element gốc để quét
   * @returns {Array} kết quả kiểm tra từng link
   */
  scanAllLinks(root = document) {
    const links = root.querySelectorAll('a[href]');
    const results = [];
    const seen = new Set();

    for (const link of links) {
      const href = link.href;
      if (!href || href.startsWith('javascript:') || seen.has(href)) continue;
      // Bỏ qua links nội bộ Instagram và Twitter/X
      if (href.startsWith('https://www.instagram.com/') || href.startsWith('https://instagram.com/')) continue;
      if (href.startsWith('https://x.com/') || href.startsWith('https://twitter.com/')) continue;
      if (href.startsWith('https://t.co/')) continue;

      seen.add(href);
      const result = this.checkLink(href);
      result.element = link;
      result.text = link.textContent.trim().substring(0, 100);
      results.push(result);
    }

    return results;
  },

  // ==================== Google Safe Browsing API ====================

  /**
   * Kiểm tra URL qua Google Safe Browsing Lookup API v4
   * @param {string} url - URL cần kiểm tra
   * @param {string} apiKey - Google API key
   * @returns {Object|null} kết quả từ API, null nếu lỗi
   */
  async checkSafeBrowsing(url, apiKey) {
    if (!apiKey || !url) return null;

    try {
      const res = await fetch(
        `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client: { clientId: 'socialshield', clientVersion: '1.0.0' },
            threatInfo: {
              threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
              platformTypes: ['ANY_PLATFORM'],
              threatEntryTypes: ['URL'],
              threatEntries: [{ url }]
            }
          })
        }
      );

      if (!res.ok) {
        console.error(`[SocialShield] Safe Browsing API error: ${res.status}`);
        return null;
      }

      const data = await res.json();
      if (data.matches && data.matches.length > 0) {
        return {
          unsafe: true,
          threats: data.matches.map(m => ({
            type: m.threatType,
            platform: m.platformType
          }))
        };
      }
      return { unsafe: false, threats: [] };
    } catch (err) {
      console.error('[SocialShield] Safe Browsing API error:', err);
      return null;
    }
  },

  // ==================== VirusTotal API ====================

  /**
   * Kiểm tra URL qua VirusTotal v3 API (multi-engine, 60+ AVs)
   * Free tier: 4 req/min, 500/day, 15.5K/month
   * @param {string} url
   * @param {string} apiKey - VirusTotal API key
   * @returns {Object|null}
   */
  async checkVirusTotal(url, apiKey) {
    if (!apiKey || !url) return null;

    try {
      // VT v3 URL identifier: base64url của URL, không padding
      const urlId = btoa(unescape(encodeURIComponent(url)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      const res = await fetch(`https://www.virustotal.com/api/v3/urls/${urlId}`, {
        headers: { 'x-apikey': apiKey, 'Accept': 'application/json' }
      });

      // URL chưa từng được phân tích → submit cho VT scan
      if (res.status === 404) {
        try {
          await fetch('https://www.virustotal.com/api/v3/urls', {
            method: 'POST',
            headers: {
              'x-apikey': apiKey,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `url=${encodeURIComponent(url)}`
          });
        } catch { /* ignore */ }
        return { unsafe: false, pending: true, source: 'VirusTotal' };
      }

      if (!res.ok) {
        console.error(`[SocialShield] VirusTotal API error: ${res.status}`);
        return null;
      }

      const data = await res.json();
      const stats = data?.data?.attributes?.last_analysis_stats || {};
      const malicious = stats.malicious || 0;
      const suspicious = stats.suspicious || 0;
      const harmless = stats.harmless || 0;
      const undetected = stats.undetected || 0;
      const total = malicious + suspicious + harmless + undetected;

      // ≥2 engines malicious, hoặc 1 malicious + 1 suspicious → unsafe
      const unsafe = malicious >= 2 || (malicious >= 1 && suspicious >= 1);

      const results = data?.data?.attributes?.last_analysis_results || {};
      const threatNames = [...new Set(
        Object.values(results)
          .filter(r => r.category === 'malicious' || r.category === 'suspicious')
          .map(r => r.result)
          .filter(Boolean)
      )].slice(0, 5);

      return {
        unsafe,
        malicious,
        suspicious,
        harmless,
        total,
        threatNames,
        reputation: data?.data?.attributes?.reputation,
        source: 'VirusTotal',
      };
    } catch (err) {
      console.error('[SocialShield] VirusTotal API error:', err);
      return null;
    }
  },

  // ==================== URLhaus (abuse.ch) ====================

  /**
   * Kiểm tra URL qua URLhaus database (abuse.ch) - chuyên malware distribution URLs
   * Yêu cầu Auth-Key miễn phí từ https://auth.abuse.ch
   * @param {string} url
   * @param {string} authKey
   * @returns {Object|null}
   */
  async checkURLhaus(url, authKey) {
    if (!authKey || !url) return null;

    try {
      const res = await fetch('https://urlhaus-api.abuse.ch/v1/url/', {
        method: 'POST',
        headers: {
          'Auth-Key': authKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `url=${encodeURIComponent(url)}`
      });

      if (!res.ok) {
        console.error(`[SocialShield] URLhaus API error: ${res.status}`);
        return null;
      }

      const data = await res.json();

      if (data.query_status === 'no_results') {
        return { unsafe: false, source: 'URLhaus' };
      }

      if (data.query_status === 'ok') {
        return {
          unsafe: true,
          threat: data.threat || 'malware_download',
          tags: data.tags || [],
          urlStatus: data.url_status,
          dateAdded: data.date_added,
          source: 'URLhaus',
        };
      }

      return null;
    } catch (err) {
      console.error('[SocialShield] URLhaus API error:', err);
      return null;
    }
  },

  // ==================== Combined Link Check ====================

  /**
   * Kiểm tra link kết hợp heuristic + Google Safe Browsing + VirusTotal + URLhaus
   * @param {string} url
   * @param {Object|string} options - { safeBrowsingApiKey, virusTotalApiKey, urlhausAuthKey }
   *                                  Truyền string = legacy safeBrowsingApiKey
   * @returns {Object}
   */
  async checkLinkFull(url, options) {
    if (typeof options === 'string') options = { safeBrowsingApiKey: options };
    options = options || {};

    const result = this.checkLink(url);

    const tasks = [];
    if (options.safeBrowsingApiKey) {
      tasks.push(['safeBrowsing', this.checkSafeBrowsing(url, options.safeBrowsingApiKey)]);
    }
    if (options.virusTotalApiKey) {
      tasks.push(['virusTotal', this.checkVirusTotal(url, options.virusTotalApiKey)]);
    }
    if (options.urlhausAuthKey) {
      tasks.push(['urlhaus', this.checkURLhaus(url, options.urlhausAuthKey)]);
    }

    if (tasks.length === 0) return result;

    const settled = await Promise.allSettled(tasks.map(t => t[1]));

    for (let i = 0; i < settled.length; i++) {
      const name = tasks[i][0];
      const outcome = settled[i];
      if (outcome.status !== 'fulfilled' || !outcome.value) continue;
      const data = outcome.value;

      if (name === 'safeBrowsing') {
        result.safeBrowsingChecked = true;
        if (data.unsafe) {
          result.safe = false;
          result.score = Math.max(result.score - 60, 0);
          for (const threat of data.threats) {
            result.warnings.push({
              type: 'google_safe_browsing',
              severity: 'critical',
              message: `Google Safe Browsing: ${threat.type.replace(/_/g, ' ').toLowerCase()}`
            });
          }
        }
      } else if (name === 'virusTotal') {
        result.virusTotalChecked = true;
        result.virusTotalStats = {
          malicious: data.malicious,
          suspicious: data.suspicious,
          total: data.total,
          pending: data.pending || false,
        };
        if (data.unsafe) {
          result.safe = false;
          result.score = Math.max(result.score - 60, 0);
          const names = data.threatNames?.length ? ` (${data.threatNames.join(', ')})` : '';
          result.warnings.push({
            type: 'virustotal',
            severity: 'critical',
            message: `VirusTotal: ${data.malicious}/${data.total} engines flagged as malicious${names}`
          });
        } else if (data.suspicious >= 2) {
          result.score = Math.max(result.score - 20, 0);
          result.warnings.push({
            type: 'virustotal',
            severity: 'medium',
            message: `VirusTotal: ${data.suspicious} engines flagged as suspicious`
          });
        }
      } else if (name === 'urlhaus') {
        result.urlhausChecked = true;
        if (data.unsafe) {
          result.safe = false;
          result.score = Math.max(result.score - 70, 0);
          const tagStr = data.tags?.length ? ` [${data.tags.slice(0, 3).join(', ')}]` : '';
          const status = data.urlStatus === 'online' ? ' - currently ONLINE' : '';
          result.warnings.push({
            type: 'urlhaus',
            severity: 'critical',
            message: `URLhaus: known malware distribution URL (${data.threat})${tagStr}${status}`
          });
        }
      }
    }

    if (result.score < 50) result.safe = false;

    return result;
  },

  // ==================== Profile Analyzer ====================

  /**
   * Phân tích toàn bộ profile để đánh giá mức độ rủi ro
   * @param {Object} profileData - dữ liệu profile
   * @returns {Object} kết quả phân tích tổng hợp
   */
  analyzeProfile(profileData) {
    const { bio, externalUrl, isPrivate, followerCount, followingCount, postCount } = profileData;

    const analysis = {
      privacyFindings: this.scanPrivacy(bio || ''),
      linkCheck: externalUrl ? this.checkLink(externalUrl) : null,
      riskLevel: 'low',
      riskScore: 0,
      recommendations: []
    };

    // Tính risk score từ privacy findings
    for (const finding of analysis.privacyFindings) {
      switch (finding.severity) {
        case 'critical': analysis.riskScore += 30; break;
        case 'high': analysis.riskScore += 20; break;
        case 'medium': analysis.riskScore += 10; break;
        case 'low': analysis.riskScore += 5; break;
      }
    }

    // Kiểm tra link an toàn
    if (analysis.linkCheck && !analysis.linkCheck.safe) {
      analysis.riskScore += 25;
    }

    // Kiểm tra tài khoản public
    if (!isPrivate) {
      analysis.riskScore += 5;
      analysis.recommendations.push('Consider switching to a private account for better privacy');
    }

    // Follower/Following ratio bất thường
    if (followerCount && followingCount) {
      const ratio = followingCount / Math.max(followerCount, 1);
      if (ratio > 10) {
        analysis.riskScore += 10;
        analysis.recommendations.push('Unusually high following/follower ratio - potential spam behavior');
      }
    }

    // Xác định mức risk
    if (analysis.riskScore >= 50) analysis.riskLevel = 'critical';
    else if (analysis.riskScore >= 30) analysis.riskLevel = 'high';
    else if (analysis.riskScore >= 15) analysis.riskLevel = 'medium';
    else analysis.riskLevel = 'low';

    analysis.riskScore = Math.min(analysis.riskScore, 100);

    return analysis;
  },

  // ==================== Engagement Rate Calculator ====================

  /**
   * Tính engagement rate và phân tích chất lượng tương tác
   * @param {Object} profileData - { followerCount, followingCount, postCount, totalLikes, totalComments }
   * @returns {Object} engagement analysis
   */
  calculateEngagement(profileData) {
    const { followerCount = 0, followingCount = 0, postCount = 0,
            totalLikes = 0, totalComments = 0, recentPosts = [] } = profileData;

    const result = {
      engagementRate: 0,
      avgLikes: 0,
      avgComments: 0,
      quality: 'unknown',
      flags: [],
      followerFollowingRatio: 0,
      postsPerFollower: 0,
    };

    if (followerCount === 0) {
      result.quality = 'no_followers';
      return result;
    }

    // Tính engagement rate từ recent posts nếu có
    if (recentPosts.length > 0) {
      const totalEng = recentPosts.reduce((sum, p) => sum + (p.likes || 0) + (p.comments || 0), 0);
      result.engagementRate = parseFloat(((totalEng / recentPosts.length / followerCount) * 100).toFixed(2));
      result.avgLikes = Math.round(recentPosts.reduce((s, p) => s + (p.likes || 0), 0) / recentPosts.length);
      result.avgComments = Math.round(recentPosts.reduce((s, p) => s + (p.comments || 0), 0) / recentPosts.length);
    } else if (totalLikes > 0 && postCount > 0) {
      // Fallback: dùng tổng likes/comments chia cho số posts
      const avgEng = (totalLikes + totalComments) / postCount;
      result.engagementRate = parseFloat(((avgEng / followerCount) * 100).toFixed(2));
      result.avgLikes = Math.round(totalLikes / postCount);
      result.avgComments = Math.round(totalComments / postCount);
    }

    // Follower/Following ratio
    result.followerFollowingRatio = parseFloat((followerCount / Math.max(followingCount, 1)).toFixed(2));
    result.postsPerFollower = parseFloat((postCount / Math.max(followerCount, 1)).toFixed(3));

    // Phân tích chất lượng engagement
    const er = result.engagementRate;
    if (er > 10) {
      result.quality = 'suspicious_high';
      result.flags.push('Unusually high engagement rate - possible engagement pods or bots');
    } else if (er >= 3) {
      result.quality = 'excellent';
    } else if (er >= 1) {
      result.quality = 'good';
    } else if (er >= 0.5) {
      result.quality = 'average';
    } else if (er > 0) {
      result.quality = 'low';
      result.flags.push('Low engagement rate may indicate fake/bought followers');
    } else {
      result.quality = 'no_data';
    }

    // Thêm flags cho anomalies
    if (followingCount > 0 && followerCount / followingCount > 100) {
      result.flags.push('Very high follower/following ratio - possible celebrity or public figure');
    }
    if (followingCount > 5000 && followerCount < 500) {
      result.flags.push('Mass following with few followers - possible spam account');
    }
    if (postCount === 0 && followerCount > 100) {
      result.flags.push('No posts but has followers - unusual pattern');
    }

    return result;
  },

  // ==================== Impersonation Detection ====================

  /**
   * Phát hiện tài khoản nghi giả mạo trong danh sách followers/following
   * @param {string} targetUsername - username gốc
   * @param {string} targetDisplayName - display name gốc
   * @param {Array} users - danh sách users cần kiểm tra
   * @returns {Array} danh sách tài khoản nghi giả mạo
   */
  detectImpersonation(targetUsername, targetDisplayName, users) {
    if (!targetUsername || !users || users.length === 0) return [];

    const suspects = [];
    const targetLower = targetUsername.toLowerCase();
    const targetNameLower = (targetDisplayName || '').toLowerCase();

    for (const user of users) {
      const uname = (user.username || '').toLowerCase();
      const dname = (user.displayName || '').toLowerCase();
      let score = 0;
      const reasons = [];

      // 1. Username tương tự (Levenshtein-like simple check)
      if (uname !== targetLower) {
        // Chứa username gốc + thêm ký tự
        if (uname.includes(targetLower) || targetLower.includes(uname)) {
          if (Math.abs(uname.length - targetLower.length) <= 4) {
            score += 30;
            reasons.push('Username very similar to target');
          }
        }
        // Thay thế ký tự phổ biến (l→1, o→0, i→1)
        const normalized = uname.replace(/[01]/g, m => m === '0' ? 'o' : 'l').replace(/_+/g, '');
        const targetNorm = targetLower.replace(/[01]/g, m => m === '0' ? 'o' : 'l').replace(/_+/g, '');
        if (normalized === targetNorm && uname !== targetLower) {
          score += 40;
          reasons.push('Username is a character-swap variant of target');
        }
        // Username chỉ khác 1-2 ký tự
        if (uname.length === targetLower.length) {
          let diffCount = 0;
          for (let i = 0; i < uname.length; i++) {
            if (uname[i] !== targetLower[i]) diffCount++;
          }
          if (diffCount <= 2 && diffCount > 0) {
            score += 35;
            reasons.push(`Username differs by only ${diffCount} character(s)`);
          }
        }
        // Thêm prefix/suffix phổ biến: real_, official_, _official, _backup
        const impersonationAffixes = ['real', 'official', 'backup', 'original', 'the', 'its', 'im', 'iam'];
        for (const affix of impersonationAffixes) {
          if (uname === affix + targetLower || uname === targetLower + affix ||
              uname === affix + '_' + targetLower || uname === targetLower + '_' + affix ||
              uname === affix + '.' + targetLower || uname === targetLower + '.' + affix) {
            score += 35;
            reasons.push(`Username uses impersonation pattern: "${affix}"`);
            break;
          }
        }
      }

      // 2. Display name giống hệt hoặc tương tự target
      if (targetNameLower && dname) {
        if (dname === targetNameLower) {
          score += 25;
          reasons.push('Display name identical to target');
        } else if (dname.includes(targetNameLower) || targetNameLower.includes(dname)) {
          if (dname.length > 3) {
            score += 15;
            reasons.push('Display name contains target name');
          }
        }
      }

      // 3. No profile pic + similar name = stronger signal
      if (user.hasAnonymousProfilePic && score > 0) {
        score += 10;
        reasons.push('No profile picture (stronger impersonation signal)');
      }

      if (score >= 30) {
        suspects.push({
          ...user,
          impersonationScore: Math.min(score, 100),
          impersonationReasons: reasons,
        });
      }
    }

    return suspects.sort((a, b) => b.impersonationScore - a.impersonationScore);
  },

  // ==================== Full Profile Scan (bio + captions + comments) ====================

  /**
   * Quét sâu toàn bộ text user-generated, không chỉ bio.
   * Recon tools không thấy được captions/comments full → đây là lợi thế.
   * @param {Object} data - { bio, displayName, fullName, captions: [], comments: [] }
   * @returns {Array} merged findings, có thêm field `source` chỉ ra văn bản phát hiện
   */
  scanFullProfile(data) {
    const all = [];
    const sources = [
      { label: 'bio', text: data.bio || '' },
      { label: 'displayName', text: data.displayName || data.fullName || '' },
    ];
    if (Array.isArray(data.captions)) {
      data.captions.forEach((c, i) => sources.push({ label: `caption#${i + 1}`, text: c || '' }));
    }
    if (Array.isArray(data.comments)) {
      data.comments.forEach((c, i) => sources.push({ label: `comment#${i + 1}`, text: c || '' }));
    }

    // Dedupe findings cùng type+value để tránh nhiễu
    const seen = new Map();
    for (const src of sources) {
      if (!src.text) continue;
      const findings = this.scanPrivacy(src.text);
      const pwdFindings = this.checkPasswordExposure(src.text);
      for (const f of [...findings, ...pwdFindings]) {
        const key = f.type + '|' + (f.values || []).join(',');
        if (seen.has(key)) {
          // Gộp nguồn
          seen.get(key).sources.push(src.label);
        } else {
          seen.set(key, { ...f, sources: [src.label] });
        }
        all.push(f);
      }
    }
    return Array.from(seen.values());
  },

  // ==================== Username Footprint Enumeration ====================

  /**
   * Danh sách site có CORS-friendly API hoặc endpoint trả status code rõ ràng.
   * Chỉ gồm những endpoint mà fetch từ extension không cần host_permissions thêm
   * (đều CORS-enabled hoặc có Access-Control-Allow-Origin: *).
   */
  FOOTPRINT_SITES: [
    // ===== Dev / Code platforms =====
    { name: 'GitHub',     url: u => `https://api.github.com/users/${u}`,
      profile: u => `https://github.com/${u}`,
      existIf: d => d && d.login && !d.message },
    { name: 'GitLab',     url: u => `https://gitlab.com/api/v4/users?username=${u}`,
      profile: u => `https://gitlab.com/${u}`,
      existIf: d => Array.isArray(d) && d.length > 0 },
    { name: 'Codeberg',   url: u => `https://codeberg.org/api/v1/users/${u}`,
      profile: u => `https://codeberg.org/${u}`,
      existIf: d => d && d.login && !d.message },
    { name: 'DEV.to',     url: u => `https://dev.to/api/users/by_username?url=${u}`,
      profile: u => `https://dev.to/${u}`,
      existIf: d => d && d.username },
    { name: 'Docker Hub', url: u => `https://hub.docker.com/v2/users/${u}/`,
      profile: u => `https://hub.docker.com/u/${u}`,
      existIf: d => d && d.username },
    { name: 'npm',        url: u => `https://registry.npmjs.com/-/v1/search?text=author:${u}&size=1`,
      profile: u => `https://www.npmjs.com/~${u}`,
      existIf: d => d && d.objects && d.objects.length > 0 &&
                    d.objects.some(o => (o.package?.author?.name || '').toLowerCase() === u.toLowerCase()) },

    // ===== Forums / Community =====
    { name: 'Reddit',     url: u => `https://www.reddit.com/user/${u}/about.json`,
      profile: u => `https://reddit.com/user/${u}`,
      existIf: d => d && d.data && d.data.name && !d.data.is_suspended },
    { name: 'Hacker News',url: u => `https://hacker-news.firebaseio.com/v0/user/${u}.json`,
      profile: u => `https://news.ycombinator.com/user?id=${u}`,
      existIf: d => d && d.id },
    { name: 'Wikipedia',  url: u => `https://en.wikipedia.org/w/api.php?action=query&list=users&ususers=${encodeURIComponent(u)}&format=json&origin=*`,
      profile: u => `https://en.wikipedia.org/wiki/User:${u}`,
      existIf: d => d?.query?.users?.[0] && !d.query.users[0].missing && !d.query.users[0].invalid },

    // ===== Identity / verification =====
    { name: 'Keybase',    url: u => `https://keybase.io/_/api/1.0/user/lookup.json?usernames=${u}`,
      profile: u => `https://keybase.io/${u}`,
      existIf: d => d && d.them && d.them[0] },

    // ===== Federated / decentralized =====
    { name: 'Mastodon',   url: u => `https://mastodon.social/api/v1/accounts/lookup?acct=${u}`,
      profile: u => `https://mastodon.social/@${u}`,
      existIf: d => d && d.id && d.username },
    { name: 'Bluesky',    url: u => `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${u}.bsky.social`,
      profile: u => `https://bsky.app/profile/${u}.bsky.social`,
      existIf: d => d && d.did },

    // ===== Gaming / chess =====
    { name: 'Lichess',    url: u => `https://lichess.org/api/user/${u}`,
      profile: u => `https://lichess.org/@/${u}`,
      existIf: d => d && d.id && !d.error },
    { name: 'Chess.com',  url: u => `https://api.chess.com/pub/player/${u}`,
      profile: u => `https://www.chess.com/member/${u}`,
      existIf: d => d && d.player_id },

    // ===== Competitive programming =====
    // Codeforces API hay 403/CORS-block từ extension → check profile HTML thay thế.
    // Profile page tồn tại có chứa data-handle attribute hoặc class userbox.
    { name: 'Codeforces', url: u => `https://codeforces.com/profile/${u}`,
      profile: u => `https://codeforces.com/profile/${u}`,
      kind: 'text',
      existIf: text => /class=["'][^"']*userbox|data-handle=|<title>[^<]*\b\S+\s+-\s+Codeforces/i.test(text) },
  ],

  /**
   * Quét username trên các site lớn xem account có tồn tại không.
   * Chạy song song, timeout 6s mỗi request.
   * @param {string} username
   * @returns {Object} { username, found: [...], notFound: [...], errors: [...], summary }
   */
  async scanUsernameFootprint(username) {
    if (!username) return null;
    const cleanUser = String(username).trim().replace(/^@/, '');
    if (!/^[a-zA-Z0-9_.\-]{2,30}$/.test(cleanUser)) {
      return { username: cleanUser, error: 'invalid_username' };
    }

    const tasks = this.FOOTPRINT_SITES.map(async site => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const isText = site.kind === 'text';
        const res = await fetch(site.url(cleanUser), {
          signal: controller.signal,
          headers: { 'Accept': isText ? 'text/html,*/*' : 'application/json' },
        });
        clearTimeout(timer);
        // 404 / 410 / 451 = explicitly not found
        if ([404, 410, 451].includes(res.status)) {
          return { site: site.name, exists: false };
        }
        // Site phát hiện rate-limit hoặc auth-block → đánh dấu inconclusive thay vì error
        if ([401, 403, 429].includes(res.status)) {
          return { site: site.name, inconclusive: true, reason: `rate-limited (${res.status})` };
        }
        if (!res.ok) return { site: site.name, error: `HTTP ${res.status}` };

        let parsed;
        if (isText) {
          parsed = await res.text().catch(() => '');
        } else {
          parsed = await res.json().catch(() => null);
        }
        const exists = site.existIf(parsed);
        return {
          site: site.name,
          exists: !!exists,
          profileUrl: exists ? site.profile(cleanUser) : null,
        };
      } catch (err) {
        clearTimeout(timer);
        const reason = err.name === 'AbortError' ? 'timeout' : 'network/CORS';
        return { site: site.name, inconclusive: true, reason };
      }
    });

    const results = await Promise.all(tasks);
    const found = results.filter(r => r.exists);
    const notFound = results.filter(r => r.exists === false);
    const inconclusive = results.filter(r => r.inconclusive);
    const errors = results.filter(r => r.error);

    return {
      username: cleanUser,
      total: this.FOOTPRINT_SITES.length,
      found,
      notFound,
      inconclusive,
      errors,
      summary: `Found on ${found.length}/${this.FOOTPRINT_SITES.length} sites` +
               (inconclusive.length ? ` (${inconclusive.length} inconclusive)` : ''),
    };
  },

  // ==================== Cross-Platform Linkage ====================

  /**
   * Phát hiện linkability giữa các profile trên platform khác nhau.
   * Same person giữa IG ↔ X dễ bị doxx vì attacker pivot dữ liệu.
   * @param {Array} profiles - [{ platform, username, displayName, bio, profilePicUrl, externalUrl }]
   * @returns {Object} { linkagePairs, score, signals }
   */
  detectCrossPlatformLinkage(profiles) {
    if (!Array.isArray(profiles) || profiles.length < 2) {
      return { linkagePairs: [], score: 0, signals: [] };
    }

    const pairs = [];
    for (let i = 0; i < profiles.length; i++) {
      for (let j = i + 1; j < profiles.length; j++) {
        const a = profiles[i], b = profiles[j];
        if (a.platform === b.platform) continue;

        const signals = [];
        let pairScore = 0;

        // 1. Username giống nhau (chuẩn hoá)
        const ua = (a.username || '').toLowerCase().replace(/[._\-]/g, '');
        const ub = (b.username || '').toLowerCase().replace(/[._\-]/g, '');
        if (ua && ub && ua === ub) {
          signals.push({ type: 'identical_username', weight: 50,
            detail: `Same username "${a.username}" used on ${a.platform} & ${b.platform}` });
          pairScore += 50;
        } else if (ua && ub && (ua.includes(ub) || ub.includes(ua))) {
          signals.push({ type: 'similar_username', weight: 25,
            detail: `Usernames overlap: ${a.username} vs ${b.username}` });
          pairScore += 25;
        }

        // 2. Display name giống
        const da = (a.displayName || '').toLowerCase().trim();
        const db = (b.displayName || '').toLowerCase().trim();
        if (da && db && da === db) {
          signals.push({ type: 'identical_displayname', weight: 30,
            detail: `Display name "${a.displayName}" identical on both` });
          pairScore += 30;
        }

        // 3. Bio chéo nhắc nhau (e.g., bio IG có "twitter.com/userX")
        if (a.bio && b.username) {
          const re = new RegExp(`(?:twitter\\.com|x\\.com|instagram\\.com)/${b.username}\\b`, 'i');
          if (re.test(a.bio)) {
            signals.push({ type: 'cross_link_bio', weight: 60,
              detail: `${a.platform} bio links to ${b.platform} account` });
            pairScore += 60;
          }
        }
        if (b.bio && a.username) {
          const re = new RegExp(`(?:twitter\\.com|x\\.com|instagram\\.com)/${a.username}\\b`, 'i');
          if (re.test(b.bio)) {
            signals.push({ type: 'cross_link_bio', weight: 60,
              detail: `${b.platform} bio links to ${a.platform} account` });
            pairScore += 60;
          }
        }

        // 4. External URL trùng (Linktree, blog cá nhân...)
        if (a.externalUrl && b.externalUrl) {
          try {
            const ha = new URL(a.externalUrl).hostname;
            const hb = new URL(b.externalUrl).hostname;
            if (ha === hb) {
              signals.push({ type: 'shared_external_url', weight: 40,
                detail: `Both link to same external host: ${ha}` });
              pairScore += 40;
            }
          } catch {}
        }

        // 5. Profile pic pathname giống (cùng ảnh upload sang nhiều nơi)
        if (a.profilePicUrl && b.profilePicUrl) {
          try {
            const pa = new URL(a.profilePicUrl).pathname;
            const pb = new URL(b.profilePicUrl).pathname;
            if (pa === pb) {
              signals.push({ type: 'shared_profile_pic_path', weight: 30,
                detail: 'Same profile picture path on both platforms' });
              pairScore += 30;
            }
          } catch {}
        }

        // 6. Perceptual hash matching — bằng chứng mạnh nhất khi user upload
        // cùng ảnh lên 2 platform (URL khác nhau, hash giống).
        if (a.profilePicHash && b.profilePicHash) {
          const cmp = (typeof SocialShieldImageAnalyzer !== 'undefined')
            ? SocialShieldImageAnalyzer.compareHashes(a.profilePicHash, b.profilePicHash)
            : null;
          if (cmp) {
            if (cmp.identical) {
              signals.push({ type: 'identical_profile_pic_hash', weight: 70,
                detail: `Identical profile picture (aHash match)` });
              pairScore += 70;
            } else if (cmp.similar) {
              signals.push({ type: 'similar_profile_pic_hash', weight: 50,
                detail: `Very similar profile picture (Hamming distance ${cmp.distance}/64)` });
              pairScore += 50;
            }
          }
        }

        if (pairScore >= 30) {
          pairs.push({
            a: { platform: a.platform, username: a.username },
            b: { platform: b.platform, username: b.username },
            score: Math.min(pairScore, 100),
            confidence: pairScore >= 80 ? 'high' : pairScore >= 50 ? 'medium' : 'low',
            signals,
          });
        }
      }
    }

    pairs.sort((x, y) => y.score - x.score);
    const totalScore = pairs.reduce((s, p) => s + p.score, 0);

    return {
      linkagePairs: pairs,
      score: Math.min(totalScore, 100),
      signals: pairs.flatMap(p => p.signals),
    };
  },

  // ==================== Doxxing Report Generator ====================

  /**
   * Tổng hợp toàn bộ findings thành 1 narrative attacker-perspective report.
   * Đây là feature differentiator chính so với recon tool — chúng chỉ liệt kê.
   * @param {Object} input - { profile, privacyFindings, breachData, footprint, linkage, recentPosts }
   * @returns {Object} { riskTier, narrative, attackerKnows, attackerCanDo, fixActions }
   */
  generateDoxxingReport(input) {
    const { profile = {}, privacyFindings = [], breachData = [],
            footprint = null, linkage = null, recentPosts = [] } = input;

    const knows = []; // facts attacker can extract
    const canDo = []; // attacks they can execute
    const fix = [];   // user actions to take, ordered by impact

    // === Layer 1: Identity facts ===
    if (profile.fullName || profile.displayName) {
      knows.push({
        category: 'Identity',
        fact: `Real name: **${profile.fullName || profile.displayName}**`,
        source: 'profile_displayname',
      });
    }

    const findingByType = {};
    for (const f of privacyFindings) {
      (findingByType[f.type] = findingByType[f.type] || []).push(f);
    }

    if (findingByType.email) {
      const emails = findingByType.email.flatMap(f => f.values || []);
      knows.push({ category: 'Contact', fact: `Email(s): ${emails.join(', ')}`, source: 'bio/captions' });
      canDo.push('Phishing via email, password reset abuse, account enumeration on other services');
      fix.push({ priority: 'high', action: `Remove ${emails.length} email(s) from public profile or use throwaway alias` });
    }
    if (findingByType.phone_vn || findingByType.phone_intl) {
      const phones = [...(findingByType.phone_vn || []), ...(findingByType.phone_intl || [])]
        .flatMap(f => f.values || []);
      knows.push({ category: 'Contact', fact: `Phone: ${phones.join(', ')}`, source: 'bio/captions' });
      canDo.push('SIM-swap attack, OTP phishing, smishing, harassment calls');
      fix.push({ priority: 'high', action: 'Remove phone number — use messaging apps for public contact' });
    }
    if (findingByType.national_id || findingByType.passport) {
      const ids = [...(findingByType.national_id || []), ...(findingByType.passport || [])]
        .flatMap(f => f.values || []);
      knows.push({ category: 'Government ID', fact: `ID number: ${ids.join(', ')}`, source: 'bio/captions' });
      canDo.push('Identity theft, fraudulent loan/account opening, KYC bypass');
      fix.push({ priority: 'critical', action: 'URGENT: delete posts containing CCCD/passport. Monitor credit reports' });
    }
    if (findingByType.bank_account || findingByType.credit_card || findingByType.vn_payment_handle) {
      knows.push({ category: 'Financial', fact: 'Bank/payment handle exposed', source: 'bio/captions' });
      canDo.push('Targeted scam transfers, fake refund schemes, MoMo/Zalo impersonation');
      fix.push({ priority: 'critical', action: 'Remove banking info and monitor account for unauthorized activity' });
    }
    if (findingByType.detailed_address) {
      knows.push({ category: 'Location', fact: 'Detailed home/work address', source: 'bio/captions' });
      canDo.push('Stalking, doorstep harassment, swatting, package interception');
      fix.push({ priority: 'high', action: 'Remove specific addresses — use district level only' });
    }
    if (findingByType.vn_license_plate) {
      knows.push({ category: 'Vehicle', fact: 'License plate visible', source: 'photos/captions' });
      canDo.push('Vehicle owner lookup, location tracking from public traffic cams/social posts' );
      fix.push({ priority: 'medium', action: 'Blur plates in photos before posting' });
    }
    if (findingByType.school_or_work) {
      knows.push({ category: 'Affiliation', fact: 'School/workplace mentioned', source: 'bio/captions' });
      canDo.push('Pretexting attacks pretending to be HR/teacher, targeted spear phishing');
      fix.push({ priority: 'medium', action: 'Be vague about employer; remove company logos in photos' });
    }
    if (findingByType.family_relation) {
      knows.push({ category: 'Relationships', fact: 'Family members tagged', source: 'captions/comments' });
      canDo.push('Pivot attack to family members (often less security-aware), emotional manipulation scams');
      fix.push({ priority: 'medium', action: 'Avoid tagging family with relation labels publicly' });
    }
    if (findingByType.dob) {
      knows.push({ category: 'Identity', fact: 'Date of birth', source: 'bio/captions' });
      canDo.push('Combined with name → bypass KYC questions; combined with email → password guessing');
      fix.push({ priority: 'medium', action: 'Hide birth year; show only month/day for greetings if needed' });
    }
    if (findingByType.api_token || findingByType.password_exposed || findingByType.password_pwned) {
      knows.push({ category: 'Credentials', fact: 'API key or password leaked in plaintext', source: 'bio/captions' });
      canDo.push('Direct account takeover, code repo access, cloud bill abuse');
      fix.push({ priority: 'critical', action: 'Rotate ALL exposed credentials immediately. Audit access logs' });
    }

    // === Layer 2: Breach correlation ===
    if (Array.isArray(breachData) && breachData.length > 0) {
      const totalBreaches = breachData.reduce((s, b) => s + (b.breachCount || 0), 0);
      knows.push({
        category: 'Breaches',
        fact: `Email appeared in ${totalBreaches} known data breach(es)`,
        source: 'HIBP/XposedOrNot/HackCheck',
      });
      canDo.push('Credential stuffing across services, breached password reuse exploitation');
      fix.push({ priority: 'high', action: 'Change passwords on all services; enable 2FA; check haveibeenpwned.com' });
    }

    // === Layer 3: Footprint expansion ===
    if (footprint && footprint.found?.length > 0) {
      const sites = footprint.found.map(f => f.site);
      knows.push({
        category: 'Online Presence',
        fact: `Username "${footprint.username}" exists on: ${sites.join(', ')}`,
        source: 'username footprint scan',
      });
      canDo.push('Cross-site profile aggregation, find older/forgotten accounts with weaker passwords');
      fix.push({ priority: 'medium',
        action: 'Audit each linked account; delete unused; vary usernames for sensitive services' });
    }

    // === Layer 4: Cross-platform linkage ===
    if (linkage && linkage.linkagePairs?.length > 0) {
      const top = linkage.linkagePairs[0];
      knows.push({
        category: 'Linkability',
        fact: `${top.a.platform}@${top.a.username} confirmed = ${top.b.platform}@${top.b.username} (confidence: ${top.confidence})`,
        source: 'cross-platform linkage',
      });
      canDo.push('Build composite profile combining all platforms (e.g., IG photos + X opinions + LinkedIn job)');
    }

    // === Compute risk tier ===
    let riskScore = 0;
    riskScore += knows.length * 8;
    if (findingByType.national_id || findingByType.passport) riskScore += 30;
    if (findingByType.detailed_address) riskScore += 20;
    if (findingByType.bank_account || findingByType.credit_card) riskScore += 25;
    if (findingByType.api_token) riskScore += 25;
    if (breachData && breachData.length > 0) riskScore += 15;
    if (linkage?.linkagePairs?.length > 0) riskScore += 10;
    riskScore = Math.min(riskScore, 100);

    let riskTier;
    if (riskScore >= 70) riskTier = 'critical';
    else if (riskScore >= 45) riskTier = 'high';
    else if (riskScore >= 20) riskTier = 'medium';
    else riskTier = 'low';

    // === Narrative ===
    const userLabel = profile.fullName || profile.displayName || profile.username || 'this user';
    let narrative;
    if (knows.length === 0) {
      narrative = `Profile của ${userLabel} không lộ thông tin nhạy cảm rõ rệt. Tiếp tục giữ thói quen này.`;
    } else {
      const timeEst = riskScore >= 70 ? '5-10 phút'
                    : riskScore >= 45 ? '15-30 phút'
                    : riskScore >= 20 ? '1-2 giờ' : 'vài giờ';
      narrative = `Một attacker có kinh nghiệm cần khoảng **${timeEst}** để dựng hồ sơ về **${userLabel}** từ public footprint hiện tại. ` +
                  `Họ có thể biết được ${knows.length} loại thông tin và thực hiện ${canDo.length} hướng tấn công khác nhau.`;
    }

    // Sort fix actions: critical → high → medium → low
    const prioOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    fix.sort((a, b) => prioOrder[a.priority] - prioOrder[b.priority]);

    return {
      riskTier,
      riskScore,
      narrative,
      attackerKnows: knows,
      attackerCanDo: [...new Set(canDo)],
      fixActions: fix,
      generatedAt: new Date().toISOString(),
    };
  }
};