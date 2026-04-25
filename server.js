// ============================================================
// FILE: server.js
// THE MAIN BACKEND FILE — runs on your computer, never in browser
//
// HOW IT WORKS (simple):
// Your browser (index.html) → asks this server → server uses API keys
// → calls OpenRouter/VirusTotal → sends result back to browser
// API keys NEVER touch the browser. They stay here, in this file's env.
//
// ── NEW: 5-KEY AUTO-ROTATION ─────────────────────────────────
// You can add up to 5 OpenRouter keys in your .env file.
// The server uses Key 1 first. When Key 1 reaches 90% of its
// token limit, it WARNS you in the terminal AND auto-switches
// to Key 2. When Key 2 reaches 90%, it switches to Key 3, etc.
// YOU DON'T NEED TO DO ANYTHING MANUALLY. It all happens by itself.
// ============================================================

// ── Load packages ─────────────────────────────────────────────
const express  = require('express');
const cors     = require('cors');
const dotenv   = require('dotenv');
const multer   = require('multer');
const fetch    = require('node-fetch');
const path     = require('path');
const pdfParse = require('pdf-parse');

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only image or PDF files are allowed'), false);
  }
});

// ============================================================
// ── KEY ROTATION SYSTEM ──────────────────────────────────────
//
// HOW IT WORKS:
// 1. We read all 5 keys from .env on startup.
// 2. We track how many tokens each key has used (in memory).
// 3. Before every API call, we pick the CURRENT active key.
// 4. After every API call, OpenRouter sends back how many tokens
//    were used (in the response header "x-ratelimit-remaining-tokens").
// 5. When a key reaches 90% of its limit → print a WARNING to terminal
//    → automatically switch to the next key.
// 6. If ALL 5 keys are over 90%, we still use the last available one
//    and warn you to add new keys.
// ============================================================

// ── STEP 1: Read all 5 keys from .env ────────────────────────
// Filter out any keys that are still the placeholder text.
const ALL_OPENROUTER_KEYS = [
  process.env.OPENROUTER_API_KEY_1,
  process.env.OPENROUTER_API_KEY_2,
  process.env.OPENROUTER_API_KEY_3,
  process.env.OPENROUTER_API_KEY_4,
  process.env.OPENROUTER_API_KEY_5,
].filter(k => k && k.startsWith('sk-or-v1-')); // only real keys, skip placeholder text

// ── STEP 2: Token limit per key (from .env or default 1,000,000) ─
const TOKEN_LIMIT = parseInt(process.env.OPENROUTER_TOKEN_LIMIT_PER_KEY) || 1_000_000;

// ── STEP 3: Track usage for each key ─────────────────────────
// This is an array like: [{ key: 'sk-or-...', usedTokens: 0, exhausted: false }, ...]
const keyStats = ALL_OPENROUTER_KEYS.map((key, index) => ({
  key,
  label:        `Key ${index + 1}`,   // for easy reading in logs
  usedTokens:   0,                     // how many tokens used so far
  exhausted:    false,                 // true when this key is over 90%
}));

// ── STEP 4: activeKeyIndex — which key we are currently using ─
let activeKeyIndex = 0;

// ── STEP 5: getActiveKey() — call this before every API call ──
// Returns the best available key, or null if all are exhausted.
function getActiveKey() {
  // Find a key that is not exhausted, starting from activeKeyIndex
  for (let i = activeKeyIndex; i < keyStats.length; i++) {
    if (!keyStats[i].exhausted) {
      activeKeyIndex = i; // update the active index
      return keyStats[i];
    }
  }
  // All keys are exhausted — return last key as last resort
  console.error('\n🚨🚨🚨 ALL 5 OPENROUTER KEYS ARE AT 90%+ USAGE! 🚨🚨🚨');
  console.error('   Please add fresh API keys to your .env file immediately.\n');
  return keyStats[keyStats.length - 1]; // use last key as fallback
}

// ── STEP 6: updateTokenUsage() — call this AFTER every API call ─
// response = the raw fetch() response from OpenRouter.
// This reads the token usage from response headers and updates stats.
function updateTokenUsage(response, tokensUsed = 0) {
  const stat = keyStats[activeKeyIndex];

  // OpenRouter returns remaining tokens in a header.
  // If available, use it to calculate exact usage.
  const remaining = parseInt(response.headers.get('x-ratelimit-remaining-tokens'));
  if (!isNaN(remaining)) {
    stat.usedTokens = TOKEN_LIMIT - remaining;
  } else {
    // If header not available, add the tokens used in this call
    stat.usedTokens += tokensUsed;
  }

  const usagePct = (stat.usedTokens / TOKEN_LIMIT) * 100;

  // ── 90% WARNING ───────────────────────────────────────────
  // If this key has used 90% or more of its tokens, warn and switch.
  if (usagePct >= 90 && !stat.exhausted) {
    stat.exhausted = true;

    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log(`║  ⚠️  WARNING: OpenRouter ${stat.label} is at ${usagePct.toFixed(1)}% usage!  ║`);
    console.log('║                                                      ║');
    console.log('║  Token usage is at 90%. Switching to next key now.  ║');
    console.log('║  You should add a fresh key to your .env file soon. ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');

    // Move to the next key automatically
    const nextIndex = activeKeyIndex + 1;
    if (nextIndex < keyStats.length) {
      activeKeyIndex = nextIndex;
      console.log(`✅ Switched to ${keyStats[nextIndex].label} automatically. No action needed.\n`);
    } else {
      console.error('❌ No more keys available! Add more keys to .env.\n');
    }
  } else if (usagePct >= 75 && usagePct < 90) {
    // ── 75% HEADS-UP (less noisy, just one line) ─────────────
    console.log(`⚡ ${stat.label} is at ${usagePct.toFixed(1)}% token usage. ${(90 - usagePct).toFixed(1)}% before auto-switch.`);
  }
}

// ── Print startup summary ─────────────────────────────────────
function printKeyStatus() {
  console.log('');
  console.log('🔑 OpenRouter Key Status:');
  if (keyStats.length === 0) {
    console.log('   ❌ No valid keys found! Add keys to .env file.');
  } else {
    keyStats.forEach((s, i) => {
      const active = i === activeKeyIndex ? ' ← ACTIVE' : '';
      console.log(`   ${s.label}: loaded${active}`);
    });
  }
  console.log(`   Token limit per key: ${TOKEN_LIMIT.toLocaleString()}`);
  console.log(`   Auto-switch at: 90% (${(TOKEN_LIMIT * 0.9).toLocaleString()} tokens)`);
  console.log('');
}

// ============================================================
// ROUTE 1: GET /api/health
// ── Check if server is running ───────────────────────────────
// Open: http://localhost:3000/api/health
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({
    status:                'ok',
    message:               'Rakshak server is running',
    virustotal_key_loaded: !!process.env.VIRUSTOTAL_API_KEY,
    openrouter_keys_loaded: keyStats.length,  // how many keys are loaded
    active_key:            keyStats[activeKeyIndex]?.label || 'none',
    key_usage:             keyStats.map(s => ({  // shows usage % for each key
      label:      s.label,
      used_pct:   ((s.usedTokens / TOKEN_LIMIT) * 100).toFixed(1) + '%',
      exhausted:  s.exhausted,
    })),
  });
});

// ============================================================
// ROUTE 2: POST /api/scan-image
// ── Accept image OR PDF → extract text → return result ──────
// ============================================================
app.post('/api/scan-image', upload.single('image'), async (req, res) => {

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Please select an image or PDF file.' });
  }

  // ── PDF branch: extract text directly, no vision model needed ──
  if (req.file.mimetype === 'application/pdf') {
    try {
      const pdfData = await pdfParse(req.file.buffer);
      const extractedText = pdfData.text || '';

      if (!extractedText.trim()) {
        return res.status(422).json({ error: 'No text found in this PDF. It may be a scanned/image-only PDF. Please use a text-based PDF or take a screenshot and upload as an image.' });
      }

      const urlPattern = /https?:\/\/[^\s\)\"\'\<\>]+|www\.[^\s\)\"\'\<\>]+/gi;
      const foundURLs  = [...new Set(extractedText.match(urlPattern) || [])];

      console.log(`✓ PDF text extracted | Pages: ${pdfData.numpages} | Chars: ${extractedText.length} | URLs found: ${foundURLs.length}`);

      return res.json({
        success:    true,
        text:       extractedText,
        urls:       foundURLs,
        char_count: extractedText.length,
        source:     'pdf',
        pages:      pdfData.numpages,
        active_key: 'N/A (PDF — no AI model used)',
      });
    } catch (err) {
      console.error('PDF parse error:', err.message);
      return res.status(500).json({ error: 'Failed to read PDF: ' + err.message });
    }
  }

  // ── Image branch (original logic) ──────────────────────────
  // Get the current active key (auto-rotates if needed)
  const keyStat = getActiveKey();
  if (!keyStat) {
    return res.status(500).json({ error: 'No OpenRouter API keys configured. Add keys to .env file.' });
  }

  try {
    const base64Data = req.file.buffer.toString('base64');
    const mimeType   = req.file.mimetype;

    const extractedText = await callOpenRouter(base64Data, mimeType, keyStat.key);

    const urlPattern = /https?:\/\/[^\s\)\"\'\<\>]+|www\.[^\s\)\"\'\<\>]+/gi;
    const foundURLs  = [...new Set(extractedText.match(urlPattern) || [])];

    res.json({
      success:    true,
      text:       extractedText,
      urls:       foundURLs,
      char_count: extractedText.length,
      active_key: keyStat.label,   // tells you which key was used (label only, not the actual key)
    });

  } catch (err) {
    console.error('Image scan error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ROUTE 3: POST /api/check-url
// ── Check a single URL with VirusTotal ───────────────────────
// ============================================================
app.post('/api/check-url', async (req, res) => {

  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'No URL provided. Send { "url": "https://..." }' });
  }

  const vtKey = process.env.VIRUSTOTAL_API_KEY;

  if (!vtKey || vtKey === 'paste_your_virustotal_key_here') {
    const localResult = analyzeURLLocally(url);
    return res.json({ ...localResult, source: 'local-analysis' });
  }

  try {
    const result = await checkURLwithVirusTotal(url, vtKey);
    res.json(result);
  } catch (err) {
    console.error('URL check error:', err.message);
    const localResult = analyzeURLLocally(url);
    res.json({ ...localResult, source: 'local-fallback', vt_error: err.message });
  }
});

// ============================================================
// ROUTE 4: POST /api/analyze-email
// ── Run full phishing analysis on email text ─────────────────
// ============================================================
app.post('/api/analyze-email', async (req, res) => {
  const { sender = '', subject = '', body = '', headers = '' } = req.body;

  if (!sender && !subject && !body) {
    return res.status(400).json({ error: 'Please provide at least sender, subject, or body.' });
  }

  try {
    const result = analyzeEmail(sender, subject, body, headers);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ROUTE 5: GET /api/key-status
// ── NEW: See token usage for all 5 keys in your browser ──────
// Open: http://localhost:3000/api/key-status
// ============================================================
app.get('/api/key-status', (req, res) => {
  res.json({
    total_keys: keyStats.length,
    active_key: keyStats[activeKeyIndex]?.label || 'none',
    token_limit_per_key: TOKEN_LIMIT,
    warn_at_pct: 90,
    keys: keyStats.map(s => ({
      label:       s.label,
      used_tokens: s.usedTokens,
      limit:       TOKEN_LIMIT,
      used_pct:    parseFloat(((s.usedTokens / TOKEN_LIMIT) * 100).toFixed(2)),
      exhausted:   s.exhausted,
      status:      s.exhausted ? '⚠️ Over 90% — switched away' : '✅ Active / Available',
    })),
  });
});

// ============================================================
// HELPER FUNCTION: callOpenRouter
// ── Calls OpenRouter API to extract text from image
// ── NOW TRACKS TOKEN USAGE and updates key stats after each call
// ============================================================
async function callOpenRouter(base64Data, mimeType, apiKey) {

  const modelsToTry = [
    'openrouter/free',
    'google/gemma-4-27b-it:free',
    'google/gemma-4-26b-a4b-it:free',
    'google/gemma-3-27b-it:free',
    'mistralai/mistral-small-3.1-24b-instruct:free',
    'qwen/qwen2.5-vl-32b-instruct:free',
    'qwen/qwen2.5-vl-72b-instruct:free',
    'moonshotai/kimi-vl-a3b-thinking:free',
  ];

  let lastError = '';

  for (const model of modelsToTry) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer':  'http://localhost:3000',
          'X-Title':       'Rakshak Email Analyzer',
        },
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: [
              {
                type:      'image_url',
                image_url: { url: `data:${mimeType};base64,${base64Data}` }
              },
              {
                type: 'text',
                text: 'Extract ALL text visible in this image exactly as it appears. Include every word, email address, URL, number, and sentence. Do not summarize. Output raw text only.'
              }
            ]
          }],
          max_tokens: 2000,
        })
      });

      // ── UPDATE TOKEN USAGE after every call ──────────────────
      // Read token usage from response body (available after parsing JSON)
      // We update here even for failed responses so we track accurately.
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        lastError = err.error?.message || `HTTP ${response.status}`;

        // Update token stats even on error (some tokens may have been consumed)
        updateTokenUsage(response, 0);

        if (response.status === 404 ||
            lastError.includes('no endpoints') ||
            lastError.includes('not a valid model')) {
          console.log(`Model ${model} unavailable, trying next...`);
          continue;
        }

        if (response.status === 401) {
          throw new Error(`Invalid OpenRouter API key (${keyStats[activeKeyIndex]?.label}). Check .env file.`);
        }

        if (response.status === 429) {
          // Rate limited — mark key as exhausted and switch
          console.log(`\n⚠️  ${keyStats[activeKeyIndex]?.label} hit rate limit. Forcing switch to next key.`);
          keyStats[activeKeyIndex].exhausted = true;
          const nextIndex = activeKeyIndex + 1;
          if (nextIndex < keyStats.length) {
            activeKeyIndex = nextIndex;
            console.log(`✅ Switched to ${keyStats[nextIndex]?.label}.\n`);
            // Retry with new key
            return await callOpenRouter(base64Data, mimeType, keyStats[activeKeyIndex].key);
          }
          throw new Error('All OpenRouter keys are rate-limited. Please wait or add new keys.');
        }

        continue;
      }

      const data        = await response.json();
      const text        = data.choices?.[0]?.message?.content || '';
      const tokensUsed  = data.usage?.total_tokens || 0;  // from response body

      // ── UPDATE USAGE WITH ACTUAL TOKEN COUNT ─────────────────
      updateTokenUsage(response, tokensUsed);

      if (!text.trim()) {
        lastError = 'Empty response from model';
        continue;
      }

      console.log(`✓ Text extracted using model: ${model} | Key: ${keyStats[activeKeyIndex]?.label} | Tokens used: ${tokensUsed}`);
      return text;

    } catch (err) {
      if (err.message.includes('API key') ||
          err.message.includes('rate-limited') ||
          err.message.includes('All OpenRouter')) {
        throw err;
      }
      lastError = err.message;
      continue;
    }
  }

  throw new Error(`All vision models unavailable. Last error: ${lastError}. Try again in a few minutes.`);
}

// ============================================================
// HELPER FUNCTION: checkURLwithVirusTotal (unchanged)
// ============================================================
async function checkURLwithVirusTotal(url, apiKey) {
  const urlId = Buffer.from(url).toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const response = await fetch(`https://www.virustotal.com/api/v3/urls/${urlId}`, {
    method:  'GET',
    headers: { 'x-apikey': apiKey }
  });

  if (response.status === 404) {
    return await submitURLtoVirusTotal(url, apiKey);
  }

  if (!response.ok) {
    throw new Error(`VirusTotal error: ${response.status}`);
  }

  const data       = await response.json();
  const stats      = data.data?.attributes?.last_analysis_stats || {};
  const malicious  = stats.malicious  || 0;
  const suspicious = stats.suspicious || 0;
  const harmless   = stats.harmless   || 0;
  const undetected = stats.undetected || 0;
  const total      = malicious + suspicious + harmless + undetected;
  const risk       = total > 0 ? Math.round(((malicious + suspicious) / total) * 100) : 0;

  return {
    url,
    safe:              malicious === 0 && suspicious === 0,
    risk,
    malicious_engines: malicious,
    total_engines:     total,
    flags:             malicious > 0
      ? [`Flagged by ${malicious} of ${total} security engines`]
      : ['Clean — no security engines flagged this URL'],
    source: 'virustotal',
  };
}

// ============================================================
// HELPER FUNCTION: submitURLtoVirusTotal (unchanged)
// ============================================================
async function submitURLtoVirusTotal(url, apiKey) {
  const formData = new URLSearchParams();
  formData.append('url', url);

  const res = await fetch('https://www.virustotal.com/api/v3/urls', {
    method:  'POST',
    headers: { 'x-apikey': apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    formData.toString()
  });

  if (!res.ok) throw new Error('VirusTotal submit failed');

  const local = analyzeURLLocally(url);
  return {
    ...local,
    source: 'vt-submitted',
    flags:  ['Submitted to VirusTotal for scanning — local check used for now'],
  };
}

// ============================================================
// HELPER FUNCTION: analyzeURLLocally (unchanged)
// ============================================================
function analyzeURLLocally(url) {
  const PHISHING_PATTERNS = ['paypa1','paypai','amazon-secure','amazon-verify','microsoft-security','apple-id-verify','google-security','hdfc-bank','sbi-secure','icici-verify','rbi-kyc','income-tax-refund'];
  const SUSPICIOUS_TLDS   = ['.xyz','.tk','.ml','.ga','.cf','.top','.club','.click','.loan','.win','.gq'];
  const LEGIT_DOMAINS     = ['google.com','github.com','microsoft.com','apple.com','amazon.com','paypal.com','linkedin.com','hdfc.com','sbi.co.in'];

  let risk = 0;
  const flags = [];

  try {
    const u    = new URL(url.startsWith('http') ? url : 'https://' + url);
    const host = u.hostname.toLowerCase();

    if (/^\d+\.\d+\.\d+\.\d+$/.test(host))           { risk += 40; flags.push('IP-based URL (very suspicious)'); }
    PHISHING_PATTERNS.forEach(p => { if (host.includes(p)) { risk += 50; flags.push(`Phishing pattern: "${p}"`); } });
    SUSPICIOUS_TLDS.forEach(t   => { if (host.endsWith(t)) { risk += 30; flags.push(`Suspicious TLD: ${t}`); } });
    LEGIT_DOMAINS.forEach(d => {
      const brand = d.split('.')[0];
      if (host.includes(brand) && !host.endsWith(d) && !host.endsWith('.' + d)) {
        risk += 45; flags.push(`Brand impersonation: "${brand}"`);
      }
    });
    if ((host.match(/-/g) || []).length > 2)        { risk += 15; flags.push('Excessive hyphens in domain'); }
    if (host.split('.').length > 4)                 { risk += 20; flags.push('Too many subdomains'); }
    if (!url.startsWith('https'))                   { risk += 10; flags.push('No HTTPS'); }
    if (['bit.ly','tinyurl','t.co'].some(s => host.includes(s))) { risk += 25; flags.push('URL shortener (hides destination)'); }

  } catch (e) {
    risk += 20;
    flags.push('Malformed URL');
  }

  risk = Math.min(risk, 100);
  return { url, safe: risk < 30, risk, flags: flags.length ? flags : ['No suspicious patterns found'], source: 'local' };
}

// ============================================================
// HELPER FUNCTION: analyzeEmail (unchanged)
// ============================================================
function analyzeEmail(sender, subject, body, headers) {
  const senderL  = sender.toLowerCase();
  const bodyL    = body.toLowerCase();
  const subjectL = subject.toLowerCase();
  const allText  = senderL + ' ' + subjectL + ' ' + bodyL;

  const URGENCY_WORDS     = ['urgent','immediately','24 hours','48 hours','suspend','suspended','limited','verify now','act now','expire','locked','blocked','compromised','unauthorized','required immediately','permanently','restricted'];
  const SENSITIVE_WORDS   = ['credit card','cvv','ssn','social security','pin','password','otp','account number','ifsc','bank details','aadhaar','pan card'];
  const AI_PATTERNS       = ['as per rbi','rbi circular','rbi guidelines','kyc update','kyc verification','auto-generated','mandatory re-verification','compliance requirement','regulatory requirement'];
  const PHISHING_DOMAINS  = ['paypa1','paypai','amazon-secure','amazon-verify','microsoft-security','hdfc-bank','sbi-secure','icici-verify','rbi-kyc'];
  const SUSPICIOUS_TLDS   = ['.xyz','.tk','.ml','.ga','.cf','.top','.club','.click'];
  const URL_REGEX         = /https?:\/\/[^\s\)\"\'\<\>]+/gi;

  let scores     = { sender_legitimacy: 70, urgency_manipulation: 0, link_safety: 80, content_authenticity: 60, header_validity: 70 };
  let indicators = [];

  const domain = sender.split('@')[1] || '';
  PHISHING_DOMAINS.forEach(p => {
    if (domain.includes(p)) {
      scores.sender_legitimacy -= 50;
      indicators.push({ type: 'danger', title: 'Phishing domain detected', detail: `"${domain}" matches known phishing pattern.` });
    }
  });
  SUSPICIOUS_TLDS.forEach(t => {
    if (domain.endsWith(t)) {
      scores.sender_legitimacy -= 25;
      indicators.push({ type: 'danger', title: `Suspicious TLD: ${t}`, detail: 'This TLD is commonly used for phishing.' });
    }
  });

  let urgencyCount = URGENCY_WORDS.filter(w => allText.includes(w)).length;
  scores.urgency_manipulation = Math.min(urgencyCount * 15, 100);
  if (urgencyCount >= 3) indicators.push({ type: 'danger', title: `High urgency pressure (${urgencyCount} triggers)`, detail: 'Email uses fear/urgency tactics to rush you into action.' });

  const sensitiveFound = SENSITIVE_WORDS.filter(w => bodyL.includes(w));
  if (sensitiveFound.length >= 2) {
    scores.content_authenticity -= 40;
    indicators.push({ type: 'danger', title: 'Requests sensitive data', detail: `Asks for: ${sensitiveFound.slice(0,3).join(', ')}. Legitimate companies never ask for this by email.` });
  }

  const urls = (body.match(URL_REGEX) || []);
  urls.forEach(url => {
    const r = analyzeURLLocally(url);
    if (r.risk > 50) {
      scores.link_safety -= 40;
      indicators.push({ type: 'danger', title: 'Malicious URL', detail: `${url.substring(0,60)} — Risk: ${r.risk}/100` });
    }
  });

  const hL    = headers.toLowerCase();
  const spf   = hL.includes('spf: pass')   ? 'PASS' : hL.includes('spf: fail')   ? 'FAIL' : 'NONE';
  const dkim  = hL.includes('dkim: pass')  ? 'PASS' : 'FAIL/NONE';
  const dmarc = hL.includes('dmarc: pass') ? 'PASS' : hL.includes('dmarc: fail') ? 'FAIL' : 'NONE';
  if (spf === 'FAIL' || dkim !== 'PASS') {
    scores.header_validity -= 30;
    indicators.push({ type: 'danger', title: 'Email authentication failed', detail: `SPF: ${spf} | DKIM: ${dkim} | DMARC: ${dmarc}` });
  }

  const aiPatterns = AI_PATTERNS.filter(p => allText.includes(p));
  let aiScore      = Math.min(aiPatterns.length * 20, 100);
  if (aiScore > 40) indicators.push({ type: 'danger', title: `AI-generated content detected`, detail: `Patterns: ${aiPatterns.slice(0,2).join(', ')}` });

  Object.keys(scores).forEach(k => { scores[k] = Math.max(0, Math.min(100, scores[k])); });

  const threat_score = Math.round(
    (100 - scores.sender_legitimacy)     * 0.22 +
    scores.urgency_manipulation           * 0.18 +
    (100 - scores.link_safety)           * 0.22 +
    (100 - scores.content_authenticity)  * 0.20 +
    (100 - scores.header_validity)       * 0.18
  );

  const verdict    = threat_score >= 65 ? 'PHISHING' : threat_score >= 35 ? 'SUSPICIOUS' : 'LEGITIMATE';
  const confidence = Math.min(95, 55 + indicators.length * 7);

  return {
    verdict, threat_score, confidence,
    attack_type: threat_score >= 65
      ? (bodyL.includes('wire transfer') || bodyL.includes('ifsc')
          ? 'Business Email Compromise (BEC)'
          : aiScore > 40 ? 'AI-Generated Phishing' : 'Credential Harvesting')
      : 'Legitimate / Low Risk',
    mitre_technique: verdict === 'PHISHING' ? 'T1566.001 - Spear Phishing Link' : null,
    scores, indicators,
    header_analysis: { spf, dkim, dmarc },
    escalate: threat_score >= 70 && verdict === 'PHISHING',
    summary: verdict === 'PHISHING'
      ? `HIGH CONFIDENCE PHISHING. Score ${threat_score}/100. ${indicators.length} threat indicators found.`
      : verdict === 'SUSPICIOUS'
      ? `SUSPICIOUS. Score ${threat_score}/100. Verify before interacting.`
      : `Appears legitimate. Score ${threat_score}/100.`,
    recommended_action: verdict === 'PHISHING'
      ? 'DELETE IMMEDIATELY. Do not click any links. Report to SOC.'
      : verdict === 'SUSPICIOUS'
      ? 'Do not click links until verified. Contact sender by phone.'
      : 'No action needed. Stay vigilant.',
  };
}

// ── START THE SERVER ──────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('✅ Rakshak server is running!');
  console.log(`🌐 Open in browser:   http://localhost:${PORT}`);
  console.log(`🔑 Health check:      http://localhost:${PORT}/api/health`);
  console.log(`📊 Key usage status:  http://localhost:${PORT}/api/key-status`);
  printKeyStatus();
});
