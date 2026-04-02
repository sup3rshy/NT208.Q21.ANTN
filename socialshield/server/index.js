/**
 * SocialShield AI Analysis Server
 * Endpoint tối giản cho LLM text analysis
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3456;

// OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// CORS: cho phép Chrome extension và localhost
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '16kb' }));

// ==================== Rate Limiting (in-memory) ====================

const rateMap = new Map();
const RATE_LIMIT = 60; // requests per minute per IP
const RATE_WINDOW = 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW) {
    rateMap.set(ip, { start: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

// Cleanup rate map mỗi 5 phút
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateMap) {
    if (now - entry.start > RATE_WINDOW) rateMap.delete(ip);
  }
}, 5 * 60 * 1000);

// ==================== System Prompt ====================

const SYSTEM_PROMPT = `You are a social media security analyst. Analyze the given text and classify it.

Your task: Evaluate text from social media profiles, bios, messages, or posts for security risks.

Look for these patterns:
- Phishing: fake login links, "verify your account", credential harvesting
- Scams: fake giveaways, "free followers", crypto/investment scams, "guaranteed returns"
- Social engineering: impersonation, fake support, urgency tactics ("act now", "last chance")
- Malware: suspicious download links, "install this app"
- Data harvesting: requests for personal info, surveys collecting PII

Respond ONLY with valid JSON in this exact format:
{
  "classification": "scam" | "suspicious" | "safe",
  "confidence": 0.0 to 1.0,
  "reasoning": "Brief explanation in Vietnamese"
}

Rules:
- "scam": Clear malicious intent (phishing, fraud, malware)
- "suspicious": Potentially risky but not definitively malicious
- "safe": Normal content with no security concerns
- Be conservative: when uncertain, classify as "suspicious" rather than "safe"`;

// ==================== POST /analyze-text ====================

app.post('/analyze-text', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
  }

  const { text, context } = req.body;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "text" field' });
  }

  if (text.length > 5000) {
    return res.status(400).json({ error: 'Text too long (max 5000 characters)' });
  }

  try {
    const userMessage = context
      ? `Context: ${context}\n\nText to analyze:\n"${text}"`
      : `Text to analyze:\n"${text}"`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 200,
      temperature: 0.3,
    }, { signal: controller.signal });

    clearTimeout(timeout);

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return res.json(fallbackResult('AI returned empty response'));
    }

    const result = JSON.parse(content);

    // Validate response shape
    if (!['scam', 'suspicious', 'safe'].includes(result.classification)) {
      return res.json(fallbackResult('Invalid AI classification'));
    }

    res.json({
      classification: result.classification,
      confidence: Math.min(1, Math.max(0, result.confidence || 0.5)),
      reasoning: result.reasoning || '',
      source: 'ai',
    });

  } catch (err) {
    console.error('[SocialShield Server] AI error:', err.message);

    // Fallback: rule-based nếu AI fail
    res.json(fallbackResult(err.message, text));
  }
});

// ==================== GET /health ====================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'SocialShield AI Server',
    version: '1.0.0',
    aiConfigured: !!process.env.OPENAI_API_KEY,
  });
});

// ==================== Fallback Rule-Based ====================

function fallbackResult(errorReason, text = '') {
  // Nếu có text, thử phân tích rule-based
  if (text) {
    const score = ruleBasedScore(text);
    return {
      classification: score >= 60 ? 'scam' : score >= 30 ? 'suspicious' : 'safe',
      confidence: 0.4,
      reasoning: `Rule-based fallback (AI unavailable: ${errorReason})`,
      source: 'rule-based',
    };
  }

  return {
    classification: 'suspicious',
    confidence: 0.3,
    reasoning: `AI unavailable: ${errorReason}`,
    source: 'fallback',
  };
}

function ruleBasedScore(text) {
  const lower = text.toLowerCase();
  let score = 0;

  const scamPatterns = [
    { pattern: /free\s*(followers|likes|money|bitcoin|crypto)/i, weight: 25 },
    { pattern: /send\s*(btc|eth|usdt|crypto)/i, weight: 30 },
    { pattern: /guaranteed\s*(returns|profit|income)/i, weight: 25 },
    { pattern: /investment\s*opportunity/i, weight: 20 },
    { pattern: /double\s*your\s*(money|investment|crypto)/i, weight: 30 },
    { pattern: /dm\s*(me|for)\s*(promo|collab|partnership)/i, weight: 10 },
    { pattern: /verify\s*your\s*(account|identity)/i, weight: 20 },
    { pattern: /(click|tap)\s*here\s*to\s*(confirm|verify|claim)/i, weight: 25 },
    { pattern: /account\s*(suspended|locked|restricted)/i, weight: 20 },
    { pattern: /(official|customer)\s*support/i, weight: 15 },
    { pattern: /act\s*now|limited\s*time|expires?\s*today/i, weight: 15 },
    { pattern: /whatsapp\s*me|telegram\s*me/i, weight: 10 },
    { pattern: /make\s*\$?\d+.*per\s*(day|week|month|hour)/i, weight: 20 },
    { pattern: /hack\s*(instagram|twitter|facebook|account)/i, weight: 30 },
  ];

  for (const { pattern, weight } of scamPatterns) {
    if (pattern.test(text)) score += weight;
  }

  return Math.min(score, 100);
}

// ==================== Start Server ====================

app.listen(PORT, () => {
  console.log(`[SocialShield] AI Server running on http://localhost:${PORT}`);
  console.log(`[SocialShield] OpenAI configured: ${!!process.env.OPENAI_API_KEY}`);
  console.log(`[SocialShield] Endpoints:`);
  console.log(`  POST /analyze-text  - Analyze text for security risks`);
  console.log(`  GET  /health        - Health check`);
});
