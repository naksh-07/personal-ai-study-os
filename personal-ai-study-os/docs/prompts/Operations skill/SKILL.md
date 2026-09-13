---
name: personal-os-operations
description: >-
  Operational diagnostics, health checks, calendar drift analysis, reliability sync
  triage, checkpoint management, and test verification for the Personal AI Study OS ecosystem.
tools:
  - run_command
  - call_mcp_tool
  - view_file
  - write_to_file
---

# Personal OS Operations Runbook

## 1. Operational Context & Production Endpoints
The Personal AI Study OS technical operations skill governs administrative diagnostics, system health verification, calendar drift auditing, sync reliability triage, source registration, and automated test execution.

- **Production Worker URL**: `https://personal-ai-study-os-production.riyasaksena502.workers.dev`
- **Health Endpoint (Public)**: `https://personal-ai-study-os-production.riyasaksena502.workers.dev/health`
- **Status Endpoint (Public)**: `https://personal-ai-study-os-production.riyasaksena502.workers.dev/v1/status`
- **Production MCP Endpoint**: `https://personal-ai-study-os-production.riyasaksena502.workers.dev/mcp`
- **MCP Server Name**: `personal-study-os`
- **Notion MCP Server Name**: `notion-mcp-server`
- **Canonical Database**: Cloudflare D1 (`personal_study_os_db_prod`), frozen at **exactly 27 tables** across Migrations 0001, 0002, 0003. Zero DDL permitted.

---

## 2. Authentication & Governance Boundaries
1. **Public vs. Protected Endpoints**:
   - `/health` and `/v1/status` are unauthenticated monitoring endpoints.
   - All `/v1/*` REST state and mutation routes require `Authorization: Bearer <JWT>` with valid audience and matching scopes (`read`, `write`, or `admin`).
   - Remote MCP calls require OAuth 2.0 / 2.1 Bearer token authorization.
2. **PSS-Only Boundary (DEC-001, DEC-007)**:
   - Antigravity MUST NEVER issue direct raw SQL (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`) against Cloudflare D1.
   - All state inspections and mutations must pass through the Personal State Service (PSS) REST API or `personal-study-os` MCP tools.
3. **Idempotency Mandate**:
   - All mutation operations require a deterministic `idempotency_key` (e.g., `ops_<action>_<date>_<uuid>`).
4. **Human Sovereignty & Notion Protection**:
   - Technical operations must never modify, delete, or overwrite human-owned Notion content (`[✍️]` properties or reflection notes).

---

## 3. Operational Procedures

### Procedure 1: System Health Check (`ops:health`)
Execute full ecosystem health inspection:
1. **Ping Worker Health**:
   ```bash
   curl -s https://personal-ai-study-os-production.riyasaksena502.workers.dev/health
   ```
   Verify HTTP 200: `{"status":"healthy","timestamp":"...","environment":"production"}`.
2. **Check System Status**:
   ```bash
   curl -s https://personal-ai-study-os-production.riyasaksena502.workers.dev/v1/status
   ```
   Verify HTTP 200: `{"system":"Personal AI Study OS","version":"1.2.3","status":"online","operatorConfigured":true,"eventsRecorded":...}`.
3. **Verify Remote MCP Gateway**:
   Call `personal-study-os:get_study_state` via MCP.
   Verify valid response containing `blueprint` constraints, `subjectSummaries`, and canonical `recentActivity`.
4. **Verify Notion Integration**:
   Call `notion-mcp-server:API-get-self`.
   Verify authenticated bot `Antigravity` in workspace `Riya Saxena's Notion`.
5. **Verify Database Integrity**:
   Confirm D1 SQLite master contains exactly 27 tables across the 9 relational domains.

### Procedure 2: Calendar Drift Audit (`ops:audit-drift`)
Audits synchronization alignment between Google Calendar and canonical machine truth:
1. **Query Google Calendar**:
   Retrieve calendar events for the active date range (`YYYY-MM-DD`), filtering for study blocks prefixed with `[Study OS]`.
2. **Retrieve Authoritative Schedule Context**:
   Call MCP tool `personal-study-os:get_schedule_context` with `{ "date": "YYYY-MM-DD", "timezone": "Asia/Kolkata" }` (or `GET /v1/schedule/context?date=YYYY-MM-DD`).
3. **Reconcile Against D1 `calendar_links`**:
   Compare Google Calendar event IDs, `startsAt`, and `endsAt` against D1 `calendar_links`:
   - Flag **Orphaned Calendar Events**: Events present on Google Calendar with `[Study OS]` prefix but missing in `calendar_links`.
   - Flag **Missing Calendar Events**: Active links in `calendar_links` that have been displaced or deleted on Google Calendar.
   - Flag **Timing Drift**: Mismatches between Google Calendar event times and canonical `startsAt`/`endsAt` timestamps.
4. **Emit Drift Diagnostics**:
   Generate an audit table summarizing discrepancies and recommended reconciliations.

### Procedure 3: Outbox & Sync Reliability Triage (`ops:sync-triage`)
Monitors asynchronous synchronization and dead-letter queues:
1. **Inspect Sync Status**:
   Call MCP tool `personal-study-os:get_sync_status`.
   Inspect:
   - Pending sync jobs in `sync_jobs`
   - Dead-letter queue (DLQ) entries
   - Provider linkage health (Google Tasks, Google Calendar, Notion)
2. **Handle Failed Sync Jobs**:
   - Inspect failure count and `error_message`.
   - Verify that consumer idempotency records (`idempotency_records`) terminated crash loops cleanly.
   - Report non-destructive remediation steps without manual event deletion.

### Procedure 4: Checkpoint Management (`ops:checkpoint`)
Inspects or saves workflow execution checkpoints for long-running processes:
1. **List Active Checkpoints**:
   Call MCP tool `personal-study-os:checkpoint` with `{ "action": "list" }`.
2. **Inspect Specific Checkpoint**:
   Call MCP tool `personal-study-os:checkpoint` with `{ "action": "get", "checkpointName": "<name>" }`.
3. **Persist State Checkpoint**:
   Call MCP tool `personal-study-os:checkpoint` with `{ "action": "set", "checkpointName": "<name>", "checkpointType": "workflow", "stateData": "<json_string>" }`.

### Procedure 5: Source Catalog Registration (`ops:source-registration`)
Registers external academic sources (books, syllabus guides) into StudySourceCore:
1. **Inspect Source State**:
   Call `personal-study-os:get_source_state` with `sourceId`.
2. **Register Source**:
   Call `personal-study-os:register_source` with `{ "title": "...", "sourceType": "book", "author": "...", "referenceUri": "..." }`.
   *Zero-Copyright Invariant*: Never store full-text copyrighted book pages or PDFs in D1 or Notion. Store structural TOC metadata only.
3. **Record Source Mapping**:
   Call `personal-study-os:record_source_mapping` to link source chapters (`srcchap_...`) to canonical syllabus chapters (`chap_...`).

### Procedure 6: Local Test Suite Verification (`ops:test`)
Executes full regression, typecheck, lint, and build verification:
```bash
# Run complete test suite (24+ test files)
npm test

# Verify strict TypeScript compilation (0 errors)
npm run typecheck

# Verify linting
npm run lint

# Verify production build
npm run build
```

---

## 4. Error Handling & Incident Protocols
- **HTTP 429 (Rate Limited)**: Notion API limits calls to 3 req/sec. Implement exponential backoff (1s, 2s, 4s) with jitter.
- **HTTP 5xx (Server Error)**: Abort operational mutations immediately. Write diagnostic incident record to `<appDataDir>/brain/<conversation-id>/scratch/`. Never attempt destructive force retries.
- **Circuit Breaker**: If PSS returns `DATABASE_LOCKED` or consecutive timeouts, halt automation and notify operator.
