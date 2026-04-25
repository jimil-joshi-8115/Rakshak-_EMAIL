# Rakshak-_EMAIL 
# Rakshak — AI Email Threat Intelligence Platform

> SOC-grade phishing detection powered by AI, VirusTotal, and MITRE ATT&CK mapping.

---

## What is Rakshak?

Rakshak is a self-hosted email security tool built for analysts, developers, and anyone who wants to verify suspicious emails before clicking. It analyzes email text, screenshots, and PDFs for phishing signals, AI-generated content, malicious URLs, and social engineering tactics — then gives you a verdict with a threat score.

---

## Features

- **Email Analyzer** — Paste sender, subject, body, and headers. Get a full forensic breakdown with MITRE ATT&CK technique mapping, threat score (0–100), and recommended action.
- **URL Checker** — Check any URL against VirusTotal and local heuristics (brand impersonation, suspicious TLDs, IP-based URLs, URL shorteners).
- **Image / Screenshot Scan** — Upload a PNG, JPG, or WEBP screenshot of an email. AI (via OpenRouter) extracts all text and runs the full analysis pipeline.
- **PDF Scan** — Upload a PDF email export. Text is extracted server-side (no AI key needed) and run through the same full analysis pipeline.
- **SOC Stats Dashboard** — Live threat statistics sourced from FBI IC3, Verizon DBIR, IBM, Microsoft, and other 2025–2026 reports.
- **5-Key Auto-Rotation** — Configure up to 5 OpenRouter API keys. The server automatically switches to the next key when one reaches 90% token usage.
- **Light / Dark Mode** — Fully themed UI with persistent preference.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express |
| AI Vision (image scan) | OpenRouter API (Gemini, Qwen, Mistral — free models) |
| PDF Text Extraction | `pdf-parse` (server-side, no AI needed) |
| URL Intelligence | VirusTotal API v3 + local heuristics |
| Frontend | Vanilla HTML/CSS/JS (single file, no framework) |
| Deployment | Vercel (serverless) or local `node server.js` |

---

## Project Structure

```
rakshak/
├── server.js        # Express backend — all API routes and key rotation logic
├── index.html       # Frontend UI — single-file, no build step needed
├── package.json     # Node dependencies
├── vercel.json      # Vercel deployment config
├── .env             # Your API keys (never commit this)
└── .gitignore       # Excludes .env and node_modules
```

---

## Setup & Installation

### 1. Clone or download the project

```bash
git clone https://github.com/yourname/rakshak.git
cd rakshak
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create your `.env` file

Create a file named `.env` in the project root:

```env
# OpenRouter API keys (get free keys at openrouter.ai)
# Add up to 5 keys for auto-rotation
OPENROUTER_API_KEY_1=sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxx
OPENROUTER_API_KEY_2=sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxx
OPENROUTER_API_KEY_3=
OPENROUTER_API_KEY_4=
OPENROUTER_API_KEY_5=

# VirusTotal API key (optional — get free key at virustotal.com)
# If not set, URL checks fall back to local heuristic analysis
VIRUSTOTAL_API_KEY=your_virustotal_key_here

# Token limit per OpenRouter key before auto-switching (default: 1,000,000)
OPENROUTER_TOKEN_LIMIT_PER_KEY=1000000
```

> **At minimum you need one `OPENROUTER_API_KEY_1`** to use the image scan feature. All other keys and VirusTotal are optional.

### 4. Start the server

```bash
npm start
```

Or with auto-restart on file changes:

```bash
npm run dev
```

### 5. Open the app

```
http://localhost:3000
```

---

## API Routes

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Server health check — shows key count and VirusTotal status |
| `GET` | `/api/key-status` | Token usage stats for all 5 OpenRouter keys |
| `POST` | `/api/analyze-email` | Run phishing analysis on email text |
| `POST` | `/api/check-url` | Check a URL with VirusTotal or local heuristics |
| `POST` | `/api/scan-image` | Upload image or PDF → extract text → return for analysis |

### `POST /api/analyze-email`

```json
{
  "sender": "noreply@paypa1-secure.xyz",
  "subject": "Your account has been suspended",
  "body": "Click here immediately to verify...",
  "headers": "SPF: FAIL | DKIM: NONE | DMARC: FAIL"
}
```

### `POST /api/check-url`

```json
{
  "url": "https://amazon-secure-login.xyz/verify"
}
```

### `POST /api/scan-image`

Send as `multipart/form-data` with a field named `image`. Accepts:
- Images: `image/png`, `image/jpeg`, `image/webp`, etc.
- PDFs: `application/pdf` (text-based PDFs only; scanned/image PDFs are not supported)

---

## OpenRouter Key Auto-Rotation

The server loads all keys from `.env` on startup and tracks token usage per key:

- At **75% usage** — a heads-up warning is printed to the terminal.
- At **90% usage** — the key is marked exhausted and the server automatically switches to the next available key. No restart needed.
- If **all keys are exhausted** — the server continues using the last key and logs a critical warning to add fresh keys.

Check live key usage at: `http://localhost:3000/api/key-status`

---

## Deploying to Vercel

The included `vercel.json` routes all requests through `server.js`.

```bash
npm install -g vercel
vercel
```

Set your environment variables in the Vercel dashboard under **Project → Settings → Environment Variables**. Add the same keys from your `.env` file.

> Note: Vercel functions are stateless, so token usage tracking resets on each cold start. For persistent key rotation tracking, run on a persistent server (VPS, Railway, Render, etc.).

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `OPENROUTER_API_KEY_1` | Yes | Primary OpenRouter key |
| `OPENROUTER_API_KEY_2` through `_5` | No | Additional keys for auto-rotation |
| `VIRUSTOTAL_API_KEY` | No | VirusTotal v3 API key. Falls back to local analysis if not set. |
| `OPENROUTER_TOKEN_LIMIT_PER_KEY` | No | Token budget per key before switching. Default: `1000000` |
| `PORT` | No | Server port. Default: `3000` |

---

## Threat Detection Logic

The analyzer scores five dimensions and combines them into a final threat score (0–100):

| Dimension | Weight | What it checks |
|---|---|---|
| Sender Legitimacy | 22% | Domain reputation, phishing patterns, suspicious TLDs, brand impersonation |
| Urgency Manipulation | 18% | Fear/pressure keywords ("suspended", "act now", "24 hours") |
| Link Safety | 22% | URL heuristics + VirusTotal scan |
| Content Authenticity | 20% | Sensitive data requests, AI-generated pattern detection |
| Header Validity | 18% | SPF, DKIM, DMARC authentication results |

**Verdict thresholds:**
- `0–34` → ✅ LEGITIMATE
- `35–64` → ⚠️ SUSPICIOUS
- `65–100` → 🚨 PHISHING

---

## Getting Free API Keys

**OpenRouter** (required for image scan):
1. Go to [openrouter.ai](https://openrouter.ai)
2. Sign up and navigate to API Keys
3. Create a key — free tier is available with rate limits

**VirusTotal** (optional):
1. Go to [virustotal.com](https://www.virustotal.com)
2. Create a free account
3. Go to your profile → API Key
4. Free tier allows 4 requests/minute and 500/day

---

## License

MIT — free to use, modify, and self-host.

---

*Built for security awareness. Always verify suspicious emails through official channels.*
