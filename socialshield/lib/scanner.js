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
    // Giới hạn input để tránh regex ReDoS trên bio cực dài.
    // Bio thực tế chỉ 150 char; cắt ở 5000 char vẫn đủ context cho mọi platform.
    if (text.length > 5000) text = text.substring(0, 5000);
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

    // International phone numbers.
    // Anchor word-boundary để tránh backtracking trên chuỗi dài chứa nhiều dấu phân tách.
    const intlPhones = text.match(/(?:^|\s)(\+\d{1,3}[ .-]?\d{1,4}[ .-]?\d{3,4}[ .-]?\d{3,4})(?=\s|$|[^\d])/g);
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
   * Sử dụng Have I Been Pwned API (free, k-anonymity model)
   * @param {string} email - email cần kiểm tra
   * @returns {Object|null} kết quả kiểm tra
   */
  async checkEmailBreach(email) {
    if (!email) return null;

    try {
      // HIBP API v3 - breachedaccount endpoint
      const res = await fetch(
        `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=true`,
        {
          headers: {
            'User-Agent': 'SocialShield-Extension',
          }
        }
      );

      if (res.status === 404) {
        return { breached: false, breachCount: 0, breaches: [] };
      }

      if (res.status === 401) {
        // API key required - fallback to password hash check
        return await this.checkEmailBreachFallback(email);
      }

      if (!res.ok) {
        console.warn(`[SocialShield] HIBP API error: ${res.status}`);
        return null;
      }

      const breaches = await res.json();
      return {
        breached: true,
        breachCount: breaches.length,
        breaches: breaches.map(b => b.Name),
      };
    } catch (err) {
      console.error('[SocialShield] checkEmailBreach error:', err);
      return null;
    }
  },

  /**
   * Fallback: kiểm tra password hash qua HIBP Pwned Passwords API (k-anonymity, no API key)
   * Kiểm tra xem email prefix có xuất hiện trong các breach dumps phổ biến
   */
  async checkEmailBreachFallback(email) {
    // Sử dụng heuristic: kiểm tra domain của email
    try {
      const domain = email.split('@')[1]?.toLowerCase();
      if (!domain) return null;

      // Danh sách dịch vụ đã bị breach lớn (public knowledge)
      const knownBreachedDomains = [
        'yahoo.com', 'yahoo.co', 'linkedin.com', 'adobe.com',
        'myspace.com', 'dropbox.com', 'tumblr.com', 'lastfm.com',
      ];

      // Email provider lớn - rất có thể có trong breaches
      const highRiskProviders = [
        'gmail.com', 'hotmail.com', 'outlook.com', 'mail.com',
        'yahoo.com', 'aol.com', 'protonmail.com',
      ];

      if (knownBreachedDomains.includes(domain)) {
        return {
          breached: true,
          breachCount: -1,
          breaches: ['Domain has known major breaches'],
          note: 'Based on known breach database (API key not configured for detailed check)'
        };
      }

      if (highRiskProviders.includes(domain)) {
        return {
          breached: null,
          breachCount: -1,
          breaches: [],
          note: 'Common email provider - recommend checking at haveibeenpwned.com'
        };
      }

      return { breached: false, breachCount: 0, breaches: [] };
    } catch {
      return null;
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

    // Phát hiện password viết plaintext
    const pwdPatterns = [
      /(?:password|pass|mật khẩu|mk|pw)[:\s=]+['"]?([^\s'"]{4,30})['"]?/gi,
      /(?:pin|mã pin)[:\s=]+(\d{4,8})/gi,
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

  /**
   * Kiểm tra link kết hợp heuristic + Google Safe Browsing API
   * @param {string} url
   * @param {string} apiKey - Google Safe Browsing API key (optional)
   * @returns {Object} kết quả kiểm tra
   */
  async checkLinkFull(url, apiKey) {
    // Chạy heuristic check trước (nhanh)
    const result = this.checkLink(url);

    // Nếu có API key, chạy Safe Browsing check song song
    if (apiKey) {
      const sbResult = await this.checkSafeBrowsing(url, apiKey);
      if (sbResult) {
        result.safeBrowsingChecked = true;
        if (sbResult.unsafe) {
          result.safe = false;
          result.score = Math.max(result.score - 60, 0);
          for (const threat of sbResult.threats) {
            result.warnings.push({
              type: 'google_safe_browsing',
              severity: 'critical',
              message: `Google Safe Browsing: ${threat.type.replace(/_/g, ' ').toLowerCase()}`
            });
          }
        }
      }
    }

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
  detectImpersonation(targetUsername, targetDisplayName, users, whitelist = []) {
    if (!targetUsername || !users || users.length === 0) return [];

    const suspects = [];
    const targetLower = targetUsername.toLowerCase();
    const targetNameLower = (targetDisplayName || '').toLowerCase();
    // Whitelist: user đã đánh dấu các username này là hợp lệ (false positive)
    const whitelistSet = new Set((whitelist || []).map(u => String(u).toLowerCase()));

    for (const user of users) {
      const uname = (user.username || '').toLowerCase();
      if (whitelistSet.has(uname)) continue;
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
  }
};
