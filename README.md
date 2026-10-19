# 🛡️ Edge Security AI

An AI-powered edge security assistant built entirely on Cloudflare's developer platform. Paste firewall logs or describe a security incident — get instant threat analysis, severity ratings, and ready-to-deploy Cloudflare firewall rules.

**Live demo:** [edge-security-ai.anjalirajput394.workers.dev](https://edge-security-ai.anjalirajput394.workers.dev)

---

## What It Does

Users describe a security incident or paste raw logs. The AI analyzes the threat and responds with:

- **Threat type** — DDoS, Credential Stuffing, SQL Injection, Bot Scraping, WAF Bypass, etc.
- **Severity level** — Critical / High / Medium / Low
- **Plain-English explanation** of what is happening
- **Ready-to-use Cloudflare Firewall Rule** expression you can copy directly into your dashboard
- **Additional mitigations** — Rate Limiting, Bot Fight Mode, WAF managed rules

---

## Architecture

```
Browser (React)
     │  WebSocket (real-time streaming)
     ▼
Cloudflare Worker  ──── routeAgentRequest()
     │
     ▼
SecurityAgent (Durable Object)
     │  ├── SQLite  →  conversation memory per session
     │  └── Workers AI  →  Llama 3.1 8B (LLM)
     │
     ▼
Streaming response back to browser
```

| Requirement | Solution |
|---|---|
| LLM | Llama 3.1 8B via Cloudflare Workers AI (`@cf/meta/llama-3.1-8b-instruct-fp8`) |
| Workflow / coordination | Cloudflare Agents SDK (`AIChatAgent` on Durable Objects) |
| User input via chat | React frontend with real-time WebSocket streaming |
| Memory / state | SQLite auto-persisted inside Durable Object per session |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers (edge, serverless) |
| Agent framework | [`agents`](https://developers.cloudflare.com/agents/) + `@cloudflare/ai-chat` |
| LLM | Llama 3.1 8B FP8 via Workers AI |
| LLM adapter | `workers-ai-provider` + Vercel AI SDK v7 |
| State / memory | SQLite inside Durable Objects (auto-managed by `AIChatAgent`) |
| Streaming | WebSocket — resumable if client disconnects |
| Frontend | React 19 + `useAgentChat` hook |
| Build tool | Vite 8 + `@cloudflare/vite-plugin` |
| CI/CD | GitHub Actions → `wrangler deploy` on push to `main` |

---

## Example Usage

### Example 1 — DDoS Attack

**Input:**
```
I'm seeing 80,000 requests/second hitting my homepage from 500+ IPs spread
across China, Russia, and Brazil. All requests have the same User-Agent:
Mozilla/5.0. My origin server is going down.
```

**Response:**
```
## Threat Analysis
Type: Volumetric DDoS (Layer 7)
Severity: Critical
Summary: A distributed botnet is flooding your origin with spoofed browser
requests, overwhelming your server capacity.

## What's Happening
This is a Layer 7 DDoS attack using a botnet distributed across multiple
countries. The uniform User-Agent suggests automated traffic masquerading
as browsers. At 80,000 req/s your origin will be saturated.

## Recommended Firewall Rule
(ip.geoip.country in {"CN" "RU" "BR"} and not cf.client.bot_verified)
Action: managed_challenge

## Additional Mitigations
- Enable "Under Attack Mode" in the Cloudflare dashboard immediately
- Turn on Bot Fight Mode (Security → Bots)
- Set rate limit: 100 req/min per IP on all paths
```

---

### Example 2 — SQL Injection

**Input:**
```
WAF log: POST /search HTTP/1.1
User-Agent: sqlmap/1.7.8#stable
Body: q=1' UNION SELECT username,password FROM users--
IP: 45.33.32.156
```

**Response:**
```
## Threat Analysis
Type: SQL Injection
Severity: Critical
Summary: Automated SQL injection tool sqlmap is probing your search endpoint
to extract database credentials.

## Recommended Firewall Rule
(http.user_agent contains "sqlmap" or http.request.body contains "UNION SELECT")
Action: block

## Additional Mitigations
- Enable Cloudflare WAF managed ruleset (OWASP Core Rule Set)
- Block the specific IP: (ip.src eq 45.33.32.156)
- Enable anomaly score thresholding in WAF settings
```

---

### Example 3 — Credential Stuffing

**Input:**
```
3,000 POST requests/minute to /api/login. Each from a different IP.
98% return 401, 2% return 200. Looks like a bot list attack.
```

**Response:**
```
## Threat Analysis
Type: Credential Stuffing
Severity: High
Summary: A botnet is testing a leaked credential list against your login
endpoint, with a 2% success rate meaning accounts are being compromised.

## Recommended Firewall Rule
(http.request.uri.path eq "/api/login" and cf.threat_score gt 10)
Action: js_challenge

## Additional Mitigations
- Enable Turnstile (CAPTCHA replacement) on the login form
- Set rate limit: 5 req/min per IP on /api/login
- Force MFA for accounts that logged in during the attack window
```

---

## Project Structure

```
edge-security-ai/
├── src/
│   ├── server.ts        ← SecurityAgent: AIChatAgent + Llama 3.1 + system prompt
│   ├── client.tsx       ← React chat UI with streaming + markdown rendering
│   └── styles.css       ← Dark Cloudflare-themed UI
├── index.html           ← Entry point
├── wrangler.jsonc       ← Cloudflare config: AI binding, Durable Objects, assets
├── tsconfig.json        ← Extends agents/tsconfig
├── vite.config.ts       ← Cloudflare Vite plugin + React + agents decorator support
└── .github/
    └── workflows/
        └── deploy.yml   ← CI/CD: build + wrangler deploy on push to main
```

---

## Local Development

### Prerequisites
- Node.js 18+
- Cloudflare account with Workers AI enabled
- Wrangler CLI: `npm install -g wrangler`

### Setup

```bash
# Clone the repo
git clone https://github.com/Anjali394/edge-security-ai.git
cd edge-security-ai

# Install dependencies
npm install

# Authenticate with Cloudflare
wrangler login

# Start local dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## Deployment

### GitHub Actions (automatic)

Every push to `main` triggers a deploy via GitHub Actions.

Add these secrets to your repository (**Settings → Secrets → Actions**):

| Secret | Description |
|---|---|
| `CLOUDFLARE_API_TOKEN` | API token with Workers edit permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |

### Manual Deploy

```bash
export CLOUDFLARE_API_TOKEN=your_token
export CLOUDFLARE_ACCOUNT_ID=your_account_id
npm run deploy
```

---

## How the Agent Works

1. User sends a message via the React chat UI
2. Message is sent over **WebSocket** to the `SecurityAgent` Durable Object
3. `AIChatAgent` persists the message to **SQLite** (conversation memory)
4. `onChatMessage` calls **Llama 3.1 8B** via Workers AI with a security-expert system prompt
5. Response **streams back** in real-time over WebSocket — resumable if the client disconnects
6. Full conversation history is maintained per browser session (unique Durable Object instance)

---

## Cloudflare Products Used

- **Workers** — serverless edge runtime, routes HTTP + WebSocket requests
- **Durable Objects** — stateful agent instances with SQLite storage
- **Workers AI** — Llama 3.1 8B inference at the edge
- **Workers Assets** — serves the React frontend

