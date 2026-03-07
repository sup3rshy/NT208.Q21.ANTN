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

    return findings;
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

      // Check for suspicious Instagram-like domains (typosquatting)
      const suspiciousDomains = [
        /instagr[^a]m/i, /1nstagram/i, /instagram\d/i,
        /instag\.ram/i, /lnstagram/i, /instagran/i
      ];
      for (const pattern of suspiciousDomains) {
        if (pattern.test(parsed.hostname)) {
          result.warnings.push({
            type: 'typosquatting',
            severity: 'high',
            message: 'Possible typosquatting attack - fake domain mimicking Instagram'
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
      // Bỏ qua links nội bộ Instagram
      if (href.startsWith('https://www.instagram.com/') || href.startsWith('https://instagram.com/')) continue;

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
  }
};
