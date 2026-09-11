# Gemini Spark MCP Integration Contract v1.0

## 1. Executive Summary & Purpose

This contract establishes the formal machine and domain interface between **Gemini Spark** and the **Personal State Service** (Cloudflare Worker + D1).

The architecture and responsibility boundaries are frozen:
- **Google Tasks**: Authoritative for **WHAT** (task definitions, date-level commitments).
- **Google Calendar**: Authoritative for **WHEN** (precise time allocation, study blocks).
- **Gemini Spark**: Autonomous worker for **SCHEDULE + RECONCILE + TIME ALLOCATION**.
- **Cloudflare D1**: Canonical machine-readable state and immutable event history.
- **Personal State Service**: Cloudflare Worker REST + domain coordination + MCP boundary.
- **Antigravity**: Technical execution, repository management, and normalization client.
- **ChatGPT**: Intent generator, planner, and reasoning agent.

---

## 2. Core Architectural Rule

Gemini Spark **must never** use the Cloudflare Management API or arbitrary/raw SQL statements as a substitute for the Personal State Service.

### Supported Invariant
$$\text{Gemini Spark} \longrightarrow \text{Personal State Service MCP} \longrightarrow \text{Domain / Service Layer} \longrightarrow \text{Cloudflare D1}$$

### Strictly Prohibited
$$\text{Gemini Spark} \mathrel{\rlap{\hskip.5em/}\longrightarrow} \text{Cloudflare Management API} \mathrel{\rlap{\hskip.5em/}\longrightarrow} \text{Raw SQL} \mathrel{\rlap{\hskip.5em/}\longrightarrow} \text{D1}$$

---

## 3. Remote MCP Architecture & Transport

The Personal State Service exposes a compliant **Model Context Protocol (MCP)** server over HTTP at:
- **Staging**: `https://personal-ai-study-os-staging.riyasaksena502.workers.dev/mcp`
- **Production**: `https://personal-ai-study-os-production.riyasaksena502.workers.dev/mcp` (Locked behind release gate)

### Supported Transport Modes
1. **Streamable HTTP Transport (MCP 2026-07-28 Spec)**:
   - `POST /mcp` — Accepts single or batched JSON-RPC 2.0 requests.
   - If `Accept: text/event-stream` is requested, responses are chunked via Server-Sent Events (`event: message\ndata: {...}\n\n`).
2. **Legacy SSE Transport (Fallback)**:
   - `GET /mcp/sse` — Handshake endpoint establishing SSE stream.
   - `POST /mcp/messages?sessionId=...` — Method dispatch endpoint.

---

## 4. Authentication & Security Invariants

### 4.1 Security Boundary Invariants
1. **OAuth 2.0 / 2.1 Bearer Tokens**:
   Every MCP request must provide a valid JWT via the `Authorization: Bearer <token>` header or `token` query parameter.
2. **Audience Validation**:
   The token `aud` claim **must** strictly match one of the allowed audiences:
   - `https://api.personal-os.com/mcp`
   - `personal-ai-study-os`
   - `personal-study-os-api`
   Tokens with mismatched audiences are rejected with `403 Forbidden` (`AUDIENCE_MISMATCH`).
3. **Scope Gating**:
   - `read`: Permits read-only inspection (`get_study_state`, `get_today_state`, `get_schedule_context`, etc.).
   - `write`: Required for state mutations (`record_schedule_decision`, `record_study_session`, etc.).
4. **Strict Raw SQL Gate**:
   Calls containing raw SQL keywords (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `CREATE`) in tool names or argument strings are immediately blocked with `ForbiddenError`.

### 4.2 Standards-Compliant OAuth 2.0 Architecture (Phase 4C)
To ensure seamless compatibility with Gemini Spark Custom Connected Apps and modern MCP clients, the Personal State Service implements standards-compliant OAuth 2.0:

1. **RFC 8414 Authorization Server Metadata**:
   - `GET /.well-known/oauth-authorization-server`
   - `GET /.well-known/openid-configuration` (compatibility alias)
   Returns server endpoints, supported grant types (`authorization_code`, `refresh_token`), response types (`code`), PKCE methods (`S256`), and scopes (`read`, `write`).
2. **RFC 9728 Protected Resource Metadata & Discovery Challenge**:
   - `GET /.well-known/oauth-protected-resource`
   - When an unauthenticated request reaches `/mcp`, the server responds with `401 Unauthorized` and standard discovery headers:
     `WWW-Authenticate: Bearer realm="personal-ai-study-os", resource_metadata="<origin>/.well-known/oauth-protected-resource"`
     `Link: <<origin>/.well-known/oauth-protected-resource>; rel="oauth-protected-resource"`
3. **Authorization Endpoint (`GET /oauth/authorize`)**:
   - Validates `response_type=code`, `client_id`, `redirect_uri` (allowing Google/Gemini callback domains `*.google.com`, `*.googleusercontent.com`), `state`, and optional PKCE `code_challenge` / `code_challenge_method=S256`.
   - Generates an HMAC-SHA256 signed stateless authorization code (5-minute lifetime) and issues an HTTP 302 Found redirect to `<redirect_uri>?code=...&state=...`.
4. **Token Endpoint (`POST /oauth/token`)**:
   - Supports confidential client authentication via `client_secret_basic` (`Authorization: Basic ...`) and `client_secret_post`.
   - Validates authorization code signature, expiration, client binding, redirect URI binding, and single-use replay protection (enforced in-memory and via `idempotency_records`).
   - Verifies PKCE `code_verifier` (S256 SHA-256 base64url).
   - Issues standard signed JWT `access_token` (1 hour, audience `https://api.personal-os.com/mcp`, scopes `read write`) and `refresh_token` (30 days).

### 4.3 Gemini Spark Connected App Configuration Guide
In Gemini's Custom Connected App modal:
- **Server URL**: `https://personal-ai-study-os-staging.riyasaksena502.workers.dev/mcp`
- **Client ID**: `gemini-spark` (or configured `SPARK_CLIENT_ID`)
- **Client Secret**: `personal-study-os-spark-secret` (or configured `SPARK_CLIENT_SECRET`)
- **Redirect URI**: Provided by Gemini via "Copy redirect URI" button (pre-authorized for `*.google.com` / `*.googleusercontent.com` domains)
- **Requested Scopes**: `read write`

---

## 5. Domain MCP Tools Exposed to Gemini Spark

### 5.1 `get_study_state`
- **Scope**: `'read'`
- **Purpose**: Exposes the minimum useful state Gemini Spark needs to perform intelligent scheduling, conflict detection, and reconciliation without exposing database internals.

#### Input Schema
```json
{
  "type": "object",
  "properties": {
    "date": {
      "type": "string",
      "description": "YYYY-MM-DD format target date for study windows and daily context (defaults to current date in operator timezone)"
    },
    "timezone": {
      "type": "string",
      "description": "IANA timezone string (e.g. 'UTC', 'Asia/Kolkata')"
    }
  }
}
```

#### Output Structure
```json
{
  "totalStudyMinutes": 120,
  "completedChaptersCount": 5,
  "activeChaptersCount": 3,
  "totalChaptersCount": 18,
  "questionsAttempted": 45,
  "questionsCorrect": 38,
  "accuracy": 0.8444,
  "subjectSummaries": [
    {
      "subjectId": "subj_pathology",
      "name": "General Pathology",
      "completedChapters": 2,
      "totalChapters": 6,
      "progressPercent": 0.3333
    }
  ],
  "pendingWorkload": [
    {
      "chapterId": "chap_inflammation",
      "subjectId": "subj_pathology",
      "subjectName": "General Pathology",
      "name": "Acute & Chronic Inflammation",
      "status": "in_progress",
      "progressPercent": 0.45
    }
  ],
  "upcomingTasks": [
    {
      "taskLinkId": "tasklink_01J...",
      "taskId": "gtask_987654",
      "tasklistId": "tlist_med_study",
      "title": "Revise Robbins Chapter 3",
      "entityType": "chapter",
      "entityId": "chap_inflammation",
      "status": "needsAction"
    }
  ],
  "targetStudyWindows": [
    {
      "calendarLinkId": "callink_01J...",
      "calendarEventId": "cal_evt_12345",
      "title": "Deep Work: Pathology Revision",
      "startsAt": "2026-09-11T14:00:00.000Z",
      "endsAt": "2026-09-11T15:30:00.000Z",
      "status": "confirmed",
      "entityType": "study_session",
      "entityId": "chap_inflammation"
    }
  ],
  "currentOrNextWindow": {
    "calendarLinkId": "callink_01J...",
    "calendarEventId": "cal_evt_12345",
    "title": "Deep Work: Pathology Revision",
    "startsAt": "2026-09-11T14:00:00.000Z",
    "endsAt": "2026-09-11T15:30:00.000Z",
    "status": "confirmed"
  },
  "recentActivity": [ ... ]
}
```

---

### 5.2 `record_schedule_decision`
- **Scope**: `'write'`
- **Purpose**: Accepts a validated structured scheduling decision from Gemini Spark. Atomically persists a durable decision record, updates Google Calendar and Google Tasks linkages, and emits immutable canonical events into D1.

#### Input Schema
```json
{
  "type": "object",
  "properties": {
    "decisionType": {
      "type": "string",
      "enum": ["schedule_adjusted", "schedule_allocated", "schedule_missed", "decision_only"],
      "description": "Action category taken by Gemini Spark"
    },
    "decision": {
      "type": "string",
      "description": "Human-readable summary of the scheduling decision or reconciliation action"
    },
    "rationale": {
      "type": "string",
      "description": "Explicit reasoning context, constraints, or conflicts triggering this decision"
    },
    "calendarEventId": {
      "type": "string",
      "description": "Google Calendar event ID associated with the scheduled block"
    },
    "calendarId": {
      "type": "string",
      "description": "Google Calendar identifier (defaults to 'primary')"
    },
    "taskId": {
      "type": "string",
      "description": "Google Task ID allocated or linked to the study block (optional)"
    },
    "chapterId": {
      "type": "string",
      "description": "Canonical chapter ID (chap_...) being scheduled (optional)"
    },
    "projectId": {
      "type": "string",
      "description": "Canonical project ID (proj_...) if decision relates to a project (optional)"
    },
    "startTime": {
      "type": "string",
      "description": "ISO 8601 start datetime for the scheduled window"
    },
    "endTime": {
      "type": "string",
      "description": "ISO 8601 end datetime for the scheduled window"
    },
    "previousStart": {
      "type": "string",
      "description": "Previous ISO 8601 start datetime if adjusting an existing event (optional)"
    },
    "previousEnd": {
      "type": "string",
      "description": "Previous ISO 8601 end datetime if adjusting an existing event (optional)"
    },
    "title": {
      "type": "string",
      "description": "Title snapshot of the scheduled session or calendar block (optional)"
    },
    "idempotency_key": {
      "type": "string",
      "description": "Unique client idempotency key to guarantee safe at-least-once execution"
    }
  },
  "required": ["decision"]
}
```

#### Output Structure
```json
{
  "success": true,
  "operation": "record_schedule_decision",
  "eventId": "evt_01J...",
  "entityId": "dec_01J...",
  "data": {
    "decisionId": "dec_01J...",
    "decisionType": "schedule_adjusted",
    "calendarEventId": "cal_evt_12345",
    "scheduleLinkId": "schedlink_01J...",
    "calendarLinkId": "callink_01J...",
    "eventId": "evt_01J..."
  },
  "replayed": false
}
```

---

## 6. Execution Lifecycle & Ingestion Pipeline

When Spark calls `record_schedule_decision`, the Personal State Service executes:

1. **Input Validation**:
   - Validates schema bounds via `RecordScheduleDecisionInputSchema`.
   - Validates existence of `chapterId` or `projectId` if provided.
   - Enforces temporal ordering (`endTime >= startTime`).
2. **Idempotency Gate**:
   - Verifies `idempotency_records` in D1 using `ReliabilityRepository.claimIdempotency`.
   - If previously completed with the same payload, immediately returns the cached response with `replayed: true`.
   - If conflicting payload with identical key, raises `409 ConflictError`.
3. **Domain Persistence**:
   - Inserts audit decision into `decisions` table via `EntitiesRepository.insertDecision`.
   - Upserts `calendar_links` with validated timestamps and snapshot metadata via `EntitiesRepository.upsertCalendarLink`.
   - Inserts `schedule_links` establishing task-to-calendar correlation via `EntitiesRepository.insertScheduleLink`.
4. **Canonical Event Ingestion**:
   - Formats immutable event (`schedule_adjusted`, `schedule_missed`, or `decision_recorded`) with actor `agt_spark` and source `spark:mcp`.
   - Ingests atomically via `AtomicWriter.ingestAndProjectAtomic(d1, db, { event })` in a single D1 `batch()` operation.
5. **Idempotency Finalization**:
   - Records completed payload hash in `idempotency_records`.

---

## 7. Human-Only Gemini Spark Configuration Steps

To connect Gemini Spark to the Personal State Service without exposing secrets:

1. **Obtain Operator Token**:
   Generate an authorized JWT with `aud: "https://api.personal-os.com/mcp"`, `sub: "usr_operator"`, and `scp: ["read", "write"]` signed by `JWT_SECRET`.
2. **Configure Gemini Spark MCP Connection**:
   In the Gemini Spark Custom Actions / Integrations console, register a Remote MCP server:
   - **Server URL**: `https://personal-ai-study-os-staging.riyasaksena502.workers.dev/mcp`
   - **Authentication**: Bearer Token
   - **Token**: `<PASTE_OPERATOR_TOKEN>`
   - **Transport**: HTTP (Streamable HTTP / SSE)
3. **Verification in Spark**:
   Run the verification prompt in Spark:
   ```text
   Call get_study_state to inspect current study workload and today's schedule windows.
   ```
   Confirm that Spark receives the structured JSON response and reports available study blocks.

---

## 8. Safety Guardrails & Operational Ownership Conventions

### 8.1 Safety Guardrails for Autonomous Execution
To prevent rogue or excessive calendar rewriting:
- **Scope Limit**: Spark should not modify more than 5 calendar events in a single scheduled execution.
- **Minimal Mutation Rule**: Spark should prefer adjusting existing time blocks rather than recreating schedules from scratch.
- **Historical Immutability**: Spark cannot delete past calendar events or erase completed chapter records.
- **Idempotency Key Discipline**: Spark scheduled executions should use deterministic idempotency keys (e.g. `spark_sched_${date}_run_${runNumber}`).

### 8.2 Task & Calendar Ownership Conventions
- **Google Tasks (@default Tasklist)**: Gemini Spark integrates with the default task list (`@default`). Tasks managed by the Study OS are distinguished by the `[Study OS]` prefix in the title and/or metadata linkages in D1 `task_links`. Unrelated user tasks lack this identifier and must NEVER be modified, moved, or rescheduled.
- **Google Calendar (Primary Calendar & [Study OS] Prefix)**: All study blocks created or adjusted by Spark on the user's primary calendar MUST include the `[Study OS]` prefix in the event title (e.g., `[Study OS] Deep Work: Pathology Revision`). Personal, work, and unrelated non-study events must NEVER be altered, overwritten, or cancelled.
- **Conflict Avoidance Rule**: If an existing non-study event conflicts with a planned study window, Spark must find the next available free block rather than displacing the user's event.

### 8.3 Minimum Spark Tool Surface
Spark must receive ONLY the minimal set of capabilities necessary for its scheduling and reconciliation mandate:
- **MCP READ**: `get_study_state`
- **MCP WRITE**: `record_schedule_decision`
- **Native Google Workspace**: Google Calendar, Google Tasks
- **Strictly Prohibited Tools**: Spark must NOT be granted access to agent lifecycle tools, source ingestion tools, StudySourceCore tools, database administrative tools, or raw SQL query endpoints.

### 8.4 Headless Autonomous Execution & Confirmation Analysis
- **Read Pipeline**: Autonomous execution of `get_study_state`, Google Tasks reads, and Google Calendar reads operates headlessly without interactive friction.
- **Write Pipeline**: In interactive Gemini sessions, write actions (`record_schedule_decision`, Calendar mutations) may display an interactive confirmation prompt. For headless scheduled routines, actions require pre-authorized permissions configured during routine setup.
- **Verification Rule**: Antigravity verifies API endpoints, transport security, and schemas from the local environment, but does not claim end-to-end autonomous execution within proprietary Gemini Spark scheduling UI without human E2E validation.

---

## 9. Verification & Test Evidence

| Verification Category | Suite / Check | Result |
| :--- | :--- | :--- |
| **OAuth 2.0 & Security Suite** | `tests/oauth.test.ts` (20 tests) | **PASSED (20/20)** |
| **MCP Semantic Tools Suite** | `tests/mcp.test.ts` (24 tests) | **PASSED (24/24)** |
| **Domain & Service Tests** | `tests/personal-state-service.test.ts` (27 tests) | **PASSED (27/27)** |
| **Security & Boundary Tests** | `tests/security.test.ts` (44 tests) | **PASSED (44/44)** |
| **Complete Monorepo Test Suite**| 21 test files (310 tests total) | **PASSED (310/310, 100%)** |
| **Typecheck** | `npm run typecheck` (`tsc --noEmit`) | **CLEAN** (0 errors) |
| **Lint** | `npm run lint` | **PASSED** |
| **Build** | `npm run build` | **CLEAN** |
| **Staging Deployment** | Cloudflare Workers Staging | **STAGING DEPLOYED** |
| **OAuth Discovery Verification** | `GET /.well-known/oauth-authorization-server` | **200 OK (RFC 8414 metadata)** |
| **Resource Metadata Verification**| `GET /.well-known/oauth-protected-resource` | **200 OK (RFC 9728 metadata)** |
| **Staging Reachability** | `GET /health` | **200 OK (Healthy)** |
| **Staging Status Invariant** | `GET /v1/status` | **200 OK (System v1.2.3 online)** |
| **Production Release Lock** | `v1.2.3` Release Tag | **UNTOUCHED & FROZEN** |
