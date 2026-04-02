/**
 * SocialShield Text Analyzer Module
 * Phân tích văn bản bằng AI (qua backend) hoặc rule-based fallback
 */
const SocialShieldTextAnalyzer = {

  /**
   * Phân tích văn bản - thử AI trước, fallback rule-based
   * @param {string} text - văn bản cần phân tích
   * @param {string} context - ngữ cảnh (vd: "instagram bio", "twitter post")
   * @returns {Object} { classification, confidence, reasoning, source }
   */
  async analyzeText(text, context = '') {
    if (!text || text.trim().length < 5) {
      return { classification: 'safe', confidence: 1, reasoning: 'Text too short to analyze', source: 'skip' };
    }

    // Thử gọi AI endpoint qua background service worker
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'ANALYZE_TEXT_AI',
        text: text.substring(0, 5000),
        context
      });

      if (response && response.available !== false && response.classification) {
        return response;
      }
    } catch (err) {
      console.warn('[SocialShield] AI analysis unavailable:', err.message);
    }

    // Fallback: rule-based
    return this.analyzeTextRuleBased(text);
  },

  /**
   * Phân tích rule-based (không cần server)
   */
  analyzeTextRuleBased(text) {
    if (!text) return { classification: 'safe', confidence: 1, reasoning: 'Empty text', source: 'rule-based' };

    let score = 0;
    const matches = [];

    const rules = [
      // Phishing
      { pattern: /verify\s*your\s*(account|identity|email)/i, weight: 20, label: 'Account verification phishing' },
      { pattern: /(click|tap)\s*here\s*to\s*(confirm|verify|claim|restore)/i, weight: 25, label: 'Phishing CTA' },
      { pattern: /account\s*(suspended|locked|restricted|compromised)/i, weight: 20, label: 'Fake account warning' },
      { pattern: /unusual\s*(activity|login|sign.in)/i, weight: 15, label: 'Fake security alert' },
      { pattern: /password\s*(reset|change|expired)/i, weight: 15, label: 'Password phishing' },

      // Scams
      { pattern: /free\s*(followers|likes|money|bitcoin|crypto|gift)/i, weight: 25, label: 'Free offer scam' },
      { pattern: /send\s*(btc|eth|usdt|crypto|bitcoin)/i, weight: 30, label: 'Crypto transfer scam' },
      { pattern: /guaranteed\s*(returns?|profits?|income)/i, weight: 25, label: 'Investment scam' },
      { pattern: /double\s*your\s*(money|investment|crypto)/i, weight: 30, label: 'Doubling scam' },
      { pattern: /make\s*\$?\d+.*per\s*(day|week|month|hour)/i, weight: 20, label: 'Income scam' },
      { pattern: /investment\s*opportunity/i, weight: 20, label: 'Investment bait' },
      { pattern: /hack\s*(instagram|twitter|facebook|tiktok|account)/i, weight: 30, label: 'Hacking service scam' },

      // Social engineering
      { pattern: /(official|customer)\s*support/i, weight: 15, label: 'Fake support impersonation' },
      { pattern: /act\s*now|limited\s*time|expires?\s*(today|soon)/i, weight: 15, label: 'Urgency tactics' },
      { pattern: /last\s*chance|don'?t\s*miss/i, weight: 10, label: 'FOMO manipulation' },
      { pattern: /dm\s*(me|for)\s*(promo|collab|partnership|deal)/i, weight: 10, label: 'DM bait' },
      { pattern: /whatsapp\s*me|telegram\s*me/i, weight: 10, label: 'Off-platform redirect' },
      { pattern: /congratulations?\s*!?\s*you\s*(have\s*)?(won|been\s*selected)/i, weight: 25, label: 'Fake prize notification' },

      // Malware
      { pattern: /download\s*(this|the)\s*(app|tool|software)/i, weight: 15, label: 'Suspicious download prompt' },
      { pattern: /install\s*(this|the)\s*(app|extension|plugin)/i, weight: 15, label: 'Suspicious install prompt' },
    ];

    for (const { pattern, weight, label } of rules) {
      if (pattern.test(text)) {
        score += weight;
        matches.push(label);
      }
    }

    score = Math.min(score, 100);
    const classification = score >= 60 ? 'scam' : score >= 30 ? 'suspicious' : 'safe';

    return {
      classification,
      confidence: classification === 'safe' ? 0.7 : Math.min(0.5 + score / 200, 0.9),
      reasoning: matches.length > 0
        ? `Rule-based: ${matches.join(', ')}`
        : 'No suspicious patterns detected',
      source: 'rule-based',
      matchedPatterns: matches,
    };
  }
};
