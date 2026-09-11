# Google Apps Script Bridge — Production Integration Guide

## 1. Architectural Overview & Boundary
The Google Apps Script Bridge serves strictly as a **transport and Google credential boundary** for the Personal AI Study OS:
```text
Cloudflare Worker (Queue Consumer)
       │
       ▼ (HTTPS POST with HMAC-SHA256 Signed Body Envelope)
Google Apps Script Web App (Executes as Script Owner)
       │
       ▼ (Direct Internal Invocation via Google Advanced Services)
Google Calendar v3 API & Google Tasks v1 API
```

### Strict System Invariants
- **Google Tasks:** Authoritative for **WHAT** (task existence, title, notes, RFC 3339 date-only due date, completion status).
- **Google Calendar:** Authoritative for **WHEN** (exact start/end timestamps, study blocks).
- **Cloudflare D1:** Authoritative machine truth (`idempotency_records`, `sync_jobs`, `task_links`, `calendar_links`).
- **Cloudflare Queue:** Authoritative for asynchronous at-least-once delivery, 120s leases, exponential backoff, and DLQ routing.
- **Apps Script:** Stateless transport adapter. Does NOT own queues, state, leases, retries, or durable idempotency.

---

## 2. Security Model
1. **Authentication:** All requests must include an HMAC-SHA256 signature calculated over the canonical string:
   `v1:<timestamp>:<request_id>:<operation>:<canonical_json_payload>`
2. **Timing-Safe Verification:**apps/google-bridge/src/Code.js performs constant-time string comparison (`timingSafeEqual`) to prevent timing attacks.
3. **Replay & Skew Defense:** Requests with `|now - timestamp| > 300` seconds (5 minutes) are rejected with HTTP 401 `EXPIRED_TIMESTAMP`.
4. **Operation Allow-List:** Only strictly enumerated operations are permitted:
   - `calendar.get`, `calendar.create`, `calendar.update`, `calendar.delete`
   - `tasks.list`, `tasks.get`, `tasks.create`, `tasks.update`, `tasks.delete`
5. **No Secret Logging:** The HMAC secret is stored in Google Apps Script `Script Properties` and Cloudflare Worker Secrets. It is never logged or returned in responses.
6. **No OAuth Tokens Exposed:** The Cloudflare Worker never receives, stores, or refreshes Google OAuth tokens.

---

## 3. Setup & Deployment Instructions

### Prerequisites
- A Google Account with Google Calendar and Google Tasks enabled.
- Access to [Google Apps Script](https://script.google.com).

### Option A: Manual Web Editor Deployment (Quickest)
1. Open [script.google.com](https://script.google.com) and create a **New project**. Name it `personal-ai-study-os-google-bridge`.
2. Enable **Advanced Services**:
   - In the left sidebar, click **Services** (`+`).
   - Add **Google Calendar API** (Identifier: `Calendar`, Version: `v3`).
   - Add **Tasks API** (Identifier: `Tasks`, Version: `v1`).
3. Replace the contents of `Code.gs` with [`apps/google-bridge/src/Code.js`](file:///c:/Users/Suraj/Documents/Antigravity/Personal/personal-ai-study-os/apps/google-bridge/src/Code.js).
4. Configure the shared secret:
   - Click **Project Settings** (gear icon) in the left sidebar.
   - Under **Script Properties**, click **Add script property**.
   - Property: `BRIDGE_SECRET`
   - Value: `<GENERATE_HIGH_ENTROPY_RANDOM_SECRET_HEX>` (e.g. 64-character hex string)
   - Click **Save script properties**.
5. Deploy as Web App:
   - Click **Deploy** -> **New deployment**.
   - Select type: **Web app**.
   - Description: `Personal AI Study OS Bridge v1`.
   - **Execute as:** `Me (your-email@gmail.com)` *(CRITICAL: Runs under script owner credentials)*.
   - **Who has access:** `Anyone` *(Authentication is enforced via HMAC-SHA256 body signature)*.
   - Click **Deploy**. Authorize permissions when prompted by Google.
   - Copy the generated **Web App URL** (format: `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`).

### Option B: Clasp CLI Deployment
1. Install Clasp: `npm install -g @google/clasp`
2. Log in: `clasp login`
3. Initialize project inside `apps/google-bridge/`:
   ```bash
   cd apps/google-bridge
   clasp create --title "personal-ai-study-os-google-bridge" --type webapp --rootDir .
   clasp push
   clasp deploy --description "Production Release v1"
   ```
4. Set the `BRIDGE_SECRET` script property via Apps Script web console or clasp.

---

## 4. Cloudflare Worker Configuration
Configure the bridge URL and secret in the Cloudflare Worker environment:

### Local Development / Staging
In `apps/worker/.dev.vars` (or command line secrets):
```ini
GOOGLE_APPS_SCRIPT_BRIDGE_URL="https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec"
GOOGLE_APPS_SCRIPT_BRIDGE_SECRET="<YOUR_BRIDGE_SECRET>"
```

### Production Deployment
```bash
npx wrangler secret put GOOGLE_APPS_SCRIPT_BRIDGE_URL
npx wrangler secret put GOOGLE_APPS_SCRIPT_BRIDGE_SECRET
```

---

## 5. Zero-Downtime Rollback Strategy
The Worker queue consumer dynamically selects the adapter implementation based on the presence of the bridge environment variables:

```typescript
if (env.GOOGLE_APPS_SCRIPT_BRIDGE_URL && env.GOOGLE_APPS_SCRIPT_BRIDGE_SECRET) {
  // Routes to Google Apps Script Bridge
} else {
  // Seamlessly falls back to direct Google OAuth adapter
}
```

### To Roll Back:
1. Delete or unset the Worker secrets:
   ```bash
   npx wrangler secret delete GOOGLE_APPS_SCRIPT_BRIDGE_URL
   npx wrangler secret delete GOOGLE_APPS_SCRIPT_BRIDGE_SECRET
   ```
2. The Worker will automatically fall back to direct Google OAuth credentials (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`) without requiring a redeployment or causing state corruption.
