# Personal AI Study OS — Final Implementation Preflight & Build Backlog
**Document Path:** `docs/implementation/FINAL-BUILD-BACKLOG.md`  
**Phase:** Phase 6 / Pre-Build Gate  
**System Status:** Production Hardened & Deployed (Release Baseline `f1750d2` / Tags `v1.2.3`, `v1.3.0`)  
**Authority Level:** Master Implementation Roadmap & Preflight Audit  
**Author:** Principal Architect + Staff Engineer (Antigravity Orchestrator)  
**Date:** September 2026  

---

## 1. Executive Verdict

### **READY TO BUILD**

The production codebase (`naksh-07/personal-ai-study-os`) is in a healthy, verified state. All **310 automated tests pass across 21 test suites**. The backend infrastructure (Cloudflare Worker, D1 relational store with 24 tables, Cloudflare Queues transactional outbox, Google Apps Script HMAC bridge, OAuth 2.1 authorization server, and Streamable HTTP MCP server) is already deployed and operationally hardened.

The remaining gaps to achieve full Personal AI Study OS capability are small, surgical, and well-bounded:
- **Zero** database migrations or new tables are required.
- **Zero** new queues or workers are required.
- **Zero** external architecture boundaries need to be reopened.
- Work is restricted to **2 BUILD** items, **2 EXTEND** items, **2 CONFIGURE** items, **3 DEFER** items, and **9 DO NOT BUILD** guardrails.

---

## 2. Current System Baseline

A comprehensive forensic audit of the local repository and branch state was conducted at commit `f1750d2`:

- **Branch & Tree:** Clean working tree on branch `main` (`nothing to commit, working tree clean`).
- **Recent Git History:**
  - `f1750d2` — `fix(auth): harden production OAuth configuration` (tagged `v1.3.0`)
  - `75aded6` — `fix(mcp): add CORS headers and protocol version negotiation for Gemini web client`
  - `41f57c6` — `feat(mcp): add Gemini Spark OAuth compatibility`
  - `2ca5713` — `docs(spark): align contract with Google Tasks @default, Calendar [Study OS], and headless execution matrix (Phase 4B)`
  - `f5ad357` — `feat(mcp): expose Personal State Service MCP domain tools for Gemini Spark`
  - `v1.2.3` — Frozen production release baseline.
- **Test Suite Verification:** 100% green:
  - **Test Files:** 21 passed (21 total).
  - **Tests:** 310 passed (310 total).
  - **Duration:** ~3.43s.
- **Database Reality:** Cloudflare D1 (`personal_study_os_db_prod`) has exactly 24 tables across 8 domains created via `0001_initial_schema.sql` (PRAGMA foreign_keys = ON).
- **Worker & Edge Reality:** Single Cloudflare Worker app (`apps/worker`) hosting Hono REST API (`/v1/*`), RFC 8414/9728 OAuth endpoints, Streamable HTTP MCP server (`/mcp`), Cron triggers (`* * * * *`, `0 */6 * * *`), and Queue consumers (`personal-sync-queue` bound to `personal-sync-dlq`).
- **External Provider Reality:**
  - Google Tasks: Authoritative for **WHAT** (accessed via `@default` task list through HMAC-signed Google Apps Script bridge).
  - Google Calendar: Authoritative for **WHEN** (accessed via `[Study OS]` secondary calendar through HMAC-signed bridge).
  - Notion: Authoritative for human-facing knowledge/memory (asynchronous transactional outbox via `sync_jobs`, 3 req/sec token bucket, and HMAC webhook receiver).

---

## 3. Gap Matrix

Every proposed item is classified into exactly one of: **BUILD**, **EXTEND**, **KEEP**, **CONFIGURE**, **DEFER**, or **DO NOT BUILD**.

| ID | Capability | Current State | Classification | Priority | Files / Modules | Dependencies | Risk | Acceptance Criteria |
| :--- | :--- | :--- | :---: | :---: | :--- | :--- | :---: | :--- |
| **GAP-P0-1** | Schedule Blueprint Definition | Defined conceptually in docs; absent in codebase. | **BUILD** | P0 | `packages/core/src/blueprint.ts` | None | Low | Typed `ScheduleBlueprintConfig` exported with 3 daily focus containers and Sunday buffer day. |
| **GAP-P0-2** | Schedule Blueprint in Scheduling Context | `getScheduleContext` and `getStudyState` query `calendar_links`, but omit blueprint container bounds. | **EXTEND** | P0 | `packages/core/src/personal-state-service.ts`, `packages/domain/src/entities.ts` | GAP-P0-1 | Low | `getStudyState` and `getScheduleContext` return `blueprint` constraints to Spark without breaking schema. |
| **GAP-P0-3** | Gemini Spark Operating Configuration | Streamable HTTP `/mcp` & OAuth exist; Custom Gem instructions & client token require setup. | **CONFIGURE** | P0 | External Gemini Web UI & Worker Secrets | None | Low | Gemini Spark connects via OAuth 2.1 Bearer token, receives tools, and executes daily planning batch. |
| **GAP-P1-4** | Semantic Memory Mutation (`mutate_memory_fact`) | Tables `memory_facts`/`memory_versions` & domain schemas exist; MCP tool & service method absent. | **BUILD** | P1 | `packages/core/src/personal-state-service.ts`, `apps/worker/src/mcp/server.ts`, `packages/domain/src/entities.ts` | None | Low | `mutate_memory_fact` MCP tool executes `ADD`, `UPDATE`, and `INVALIDATE` with version logging and canonical event. |
| **GAP-P1-5** | Study Activity Evidence Provenance | `study_sessions` and `StudySessionRecordedPayloadSchema` lack explicit `evidenceTier` field. | **EXTEND** | P1 | `packages/domain/src/events.ts`, `packages/domain/src/entities.ts`, `packages/core/src/personal-state-service.ts` | None | Low | Optional `evidenceTier` (`user_reported`, `observed`, `derived`, `inferred`) captured in canonical event payload. |
| **GAP-P1-6** | Notion Database Bindings & Setup | Adapter, outbox queue consumer, and webhook handler implemented; database IDs not populated. | **CONFIGURE** | P1 | Cloudflare Worker Secrets (`wrangler secret put`) | None | Low | Operator creates 5 Notion databases, shares integration, and injects IDs/secrets into Worker environment. |
| **CORE-01** | Cloudflare Worker & D1 Engine | Fully implemented, 24 tables, ACID batch transactions, atomic projections. | **KEEP** | P0 | `apps/worker/*`, `packages/db/*` | None | None | Baseline preserved; 310 tests remain green. |
| **CORE-02** | Streamable HTTP MCP & OAuth 2.1 | RFC 8414/9728 discovery, PKCE S256, CORS headers, raw SQL block gate. | **KEEP** | P0 | `apps/worker/src/mcp/*`, `apps/worker/src/routes/oauth.routes.ts` | None | None | Baseline preserved; passes `mcp.test.ts` and `oauth.test.ts`. |
| **CORE-03** | Google Apps Script Bridge & Adapters | HMAC-SHA256 authenticated bridge, Tasks `@default`, Calendar `[Study OS]`. | **KEEP** | P0 | `apps/google-bridge/*`, `packages/adapters/src/google-bridge/*` | None | None | Baseline preserved; passes 25 bridge unit/integration tests. |
| **CORE-04** | Reliability Engine & Queue Consumer | Transactional outbox, CAS lease recovery, 120s timeout, exponential backoff, DLQ routing. | **KEEP** | P0 | `packages/core/src/reliability-engine.ts`, `apps/worker/src/queue/consumer.ts` | None | None | Baseline preserved; passes `reliability-*.test.ts` and `queue-consumer.test.ts`. |
| **DEF-01** | Automated Background Pattern Miner | Schema supports pattern facts; background heuristic mining daemon not implemented. | **DEFER** | P2 | External worker / Cron | V1 Pilot | Low | Manual fact recording and review-based pattern logging sufficient for V1. |
| **DEF-02** | Multi-Calendar Conflict Aggregator | Only primary + `[Study OS]` calendar supported; external iCal feed aggregation absent. | **DEFER** | P2 | Adapters / Core | V1 Pilot | Low | Single personal calendar sufficient for single-user V1. |
| **DEF-03** | In-Core FSRS Spaced Repetition | Anki package generation owned by StudySourceCore; no in-worker flashcard review engine. | **DEFER** | P3 | StudySourceCore external service | V1 Pilot | None | Preserves responsibility boundary (StudySourceCore owns Anki/FSRS). |
| **DNB-01** | Continuous Autonomous Rescheduler | Continuous background rescheduling (the "Motion" pattern) causes acute user anxiety. | **DO NOT BUILD** | Arch | Core / Worker | N/A | High | Replaced by batch morning forecast & evening reconciliation gates. |
| **DNB-02** | 1:1 Task-to-Calendar Sync | Mapping 5-15 minute subtasks directly onto calendar causes illegible clutter. | **DO NOT BUILD** | Arch | Adapters / Spark | N/A | High | Replaced by 45-90 minute Thematic Focus Containers (Model C). |
| **DNB-03** | Duplicate Calendar or Task UI | Rebuilding custom calendar/todo apps causes dual-master desync and high maintenance. | **DO NOT BUILD** | Arch | Apps | N/A | High | Google Calendar owns WHEN; Google Tasks owns WHAT. |
| **DNB-04** | Full Chat Transcripts & CoT Archival | Storing raw LLM conversations leaks sensitive data, inflates storage, and creates injection risks. | **DO NOT BUILD** | Arch | Worker / D1 | N/A | High | Only structured decisions, events, and facts are stored in D1. |
| **DNB-05** | Surveillance Telemetry (Keystrokes, Webcams) | Scraping open tabs, keystrokes, or screen time destroys trust and generates noise. | **DO NOT BUILD** | Arch | Worker / D1 | N/A | High | Only coarse study session start/end timestamps and self-reported metrics captured. |
| **DNB-06** | Direct Agent-to-Agent Shared Memory / IPC | Direct agent-to-agent messaging creates unobservable feedback loops. | **DO NOT BUILD** | Arch | Core / Agents | N/A | High | All communication mediated strictly via Personal State Service and D1 canonical events. |
| **DNB-07** | Autonomous Goal & Syllabus Rewriting | AI altering exam targets or syllabus scope violates human agency (Sycophancy Trap). | **DO NOT BUILD** | Arch | Prompt / Core | N/A | High | Goals and syllabi are human-immutable; AI only adjusts study pacing. |
| **DNB-08** | Automatic Rollover of Missed Study Blocks | Auto-rolling missed work forward creates an unmanageable wall of backlog. | **DO NOT BUILD** | Arch | Scheduling | N/A | High | Missed work elapses without guilt; tasks remain in Google Tasks for intentional replanning. |
| **DNB-09** | Unnecessary Infrastructure (Workers, Queues, DBs) | Adding micro-services or multiple DBs adds latency and hosting overhead. | **DO NOT BUILD** | Arch | Infrastructure | N/A | High | Single Worker, single D1 DB, and single Queue+DLQ handle all workloads cleanly. |

---

## 4. Exact Build Order

To preserve the green test baseline, work must proceed in five strictly sequenced, minimally disruptive steps:

```text
BUILD-01 (Schedule Blueprint)
     ↓
BUILD-02 (Expose Blueprint in get_study_state & getScheduleContext)
     ↓
BUILD-03 (Semantic Memory Mutation: mutate_memory_fact)
     ↓
BUILD-04 (Study Activity Evidence Provenance Extension)
     ↓
BUILD-05 (Closed-Loop E2E Integration & Verification Suite)
```

---

### **BUILD-01: Schedule Blueprint Definition**
- **Objective:** Create a declarative, machine-readable Schedule Blueprint module establishing the standard focus containers and buffer days.
- **What Changes:**
  - `[NEW]` [`packages/core/src/blueprint.ts`](file:///c:/Users/Suraj/Documents/Antigravity/Personal/personal-ai-study-os/packages/core/src/blueprint.ts):
    - Export `FocusContainerDefinition` interface (`containerId`, `name`, `defaultStartTime`, `defaultEndTime`, `maxDurationMinutes`, `permittedActivityTypes`, `isOptional`).
    - Export `ScheduleBlueprintConfig` interface (`timezone`, `maxDailyFocusContainers`, `maxDailyDeepWorkMinutes`, `bufferDays`, `containers`).
    - Export `DEFAULT_SCHEDULE_BLUEPRINT`:
      - `morning_focus`: 09:00 – 11:30 (150 min, `deep_work`)
      - `afternoon_practice`: 14:30 – 17:00 (150 min, `pyq_practice`, `revision`)
      - `evening_consolidation`: 19:30 – 21:30 (120 min, `revision`, `lecture`)
      - Buffer Day: Sunday (Day 0) reserved for rest and spaced review.
      - Max daily deep work ceiling: 270 minutes (4.5 hours).
  - Export module from [`packages/core/src/index.ts`](file:///c:/Users/Suraj/Documents/Antigravity/Personal/personal-ai-study-os/packages/core/src/index.ts).
- **What Does NOT Change:**
  - Zero database tables, zero migrations, zero SQL schemas.
- **Dependencies:** None.
- **Tests Required:** Unit tests verifying container time bounds, duration constraints, and default export values.
- **Acceptance Criteria:** `npm test` passes; `DEFAULT_SCHEDULE_BLUEPRINT` accurately reflects `SCHEDULING-ARCHITECTURE-v1.0.md` §3.

---

### **BUILD-02: Expose Blueprint in Scheduling Context**
- **Objective:** Surface the Schedule Blueprint in `PersonalStateService.getStudyState` and `PersonalStateService.getScheduleContext` so Gemini Spark receives authoritative boundaries directly over MCP.
- **What Changes:**
  - [`packages/domain/src/entities.ts`](file:///c:/Users/Suraj/Documents/Antigravity/Personal/personal-ai-study-os/packages/domain/src/entities.ts):
    - Add optional `blueprint?: ScheduleBlueprintConfig` to `StudyState` and `ScheduleContextState` interfaces.
  - [`packages/core/src/personal-state-service.ts`](file:///c:/Users/Suraj/Documents/Antigravity/Personal/personal-ai-study-os/packages/core/src/personal-state-service.ts):
    - Import `DEFAULT_SCHEDULE_BLUEPRINT` from `./blueprint`.
    - Include `blueprint: DEFAULT_SCHEDULE_BLUEPRINT` in the return payload of `getStudyState` and `getScheduleContext`.
    - In `recordScheduleDecision`: Add soft validation warning if scheduled containers exceed `maxDailyFocusContainers` on target date.
- **What Does NOT Change:**
  - Existing `get_study_state` MCP tool signature and return fields are fully preserved (non-breaking backward compatibility).
  - No new MCP tools added for Spark (maintains Spark's 2-tool contract: `get_study_state` and `record_schedule_decision`).
- **Dependencies:** BUILD-01.
- **Tests Required:** Update `personal-state-service.test.ts` to assert `blueprint` presence in `getStudyState` and `getScheduleContext`.
- **Acceptance Criteria:** `get_study_state` response includes `blueprint` containing 3 daily containers; zero regressions across existing 310 tests.

---

### **BUILD-03: Semantic Memory Mutation (`mutate_memory_fact`)**
- **Objective:** Implement the explicit semantic memory mutation service method and register the corresponding MCP write tool.
- **What Changes:**
  - [`packages/domain/src/entities.ts`](file:///c:/Users/Suraj/Documents/Antigravity/Personal/personal-ai-study-os/packages/domain/src/entities.ts):
    - Export `MutateMemoryFactInputSchema`:
      - `operation`: `'ADD' | 'UPDATE' | 'INVALIDATE'`
      - `category`: `'convention' | 'preference' | 'constraint' | 'pattern'` (optional on INVALIDATE)
      - `fact`: `string` (required on ADD and UPDATE)
      - `factId`: `string` (required on UPDATE and INVALIDATE)
      - `reason`: `string` (optional justification)
      - `actorId`: `string` (defaults to caller ID)
  - [`packages/core/src/personal-state-service.ts`](file:///c:/Users/Suraj/Documents/Antigravity/Personal/personal-ai-study-os/packages/core/src/personal-state-service.ts):
    - Implement `mutateMemoryFact(rawInput: MutateMemoryFactInput, idempotency?: IdempotencyContext)`:
      - `ADD`: Generates `mem_...` ID, inserts row into `memory_facts` (`invalid_at = NULL`), logs version in `memory_versions`, emits canonical event `memory_added`.
      - `UPDATE`: Sets `invalid_at = now()` on existing fact, inserts new fact row, logs version in `memory_versions`, emits canonical event `memory_updated`.
      - `INVALIDATE`: Sets `invalid_at = now()` on existing fact, logs version in `memory_versions`, emits canonical event `memory_invalidated`.
      - Wraps execution in `withIdempotency` with 24-hour replay protection.
  - [`apps/worker/src/mcp/server.ts`](file:///c:/Users/Suraj/Documents/Antigravity/Personal/personal-ai-study-os/apps/worker/src/mcp/server.ts):
    - Register `mutate_memory_fact` in `MCP_TOOLS` with `'write'` scope.
- **What Does NOT Change:**
  - Existing `memory_facts` and `memory_versions` table schemas are untouched.
  - Existing `search_memory` tool remains unchanged.
  - Gemini Spark whitelist in `streamable-http.ts` remains restricted to `get_study_state` and `record_schedule_decision` (Spark does not author memory; ChatGPT and Antigravity use `mutate_memory_fact`).
- **Dependencies:** None (independent of BUILD-01/02).
- **Tests Required:** Add unit tests in `personal-state-service.test.ts` and `mcp.test.ts` validating `ADD`, `UPDATE`, and `INVALIDATE` workflows, idempotency deduplication, and scope checking.
- **Acceptance Criteria:** Clean mutation execution, version history preserved, canonical events emitted, raw SQL prevention enforced.

---

### **BUILD-04: Study Activity Evidence Provenance Extension**
- **Objective:** Add optional `evidenceTier` property to study session recording schemas and canonical event envelopes.
- **What Changes:**
  - [`packages/domain/src/events.ts`](file:///c:/Users/Suraj/Documents/Antigravity/Personal/personal-ai-study-os/packages/domain/src/events.ts):
    - Add `EvidenceTierSchema = z.enum(['user_reported', 'observed', 'derived', 'inferred'])`.
    - Add optional `evidenceTier: EvidenceTierSchema.default('user_reported')` to `StudySessionRecordedPayloadSchema`.
  - [`packages/domain/src/entities.ts`](file:///c:/Users/Suraj/Documents/Antigravity/Personal/personal-ai-study-os/packages/domain/src/entities.ts):
    - Add optional `evidenceTier?: EvidenceTier` to `RecordStudySessionInputSchema` (defaults to `'user_reported'`).
  - [`packages/core/src/personal-state-service.ts`](file:///c:/Users/Suraj/Documents/Antigravity/Personal/personal-ai-study-os/packages/core/src/personal-state-service.ts):
    - Pass `evidenceTier` through to `study_session_recorded` event payload in `recordStudySession`.
- **What Does NOT Change:**
  - Zero D1 schema migrations: `canonical_events.payload` is already stored as JSON text.
  - `study_sessions` relational table columns remain unchanged.
- **Dependencies:** None.
- **Tests Required:** Update `canonical-events.test.ts` and `domain.test.ts` to verify serialization and defaulting of `evidenceTier`.
- **Acceptance Criteria:** `recordStudySession` correctly stores `evidenceTier` in event payload; default `'user_reported'` applies when omitted.

---

### **BUILD-05: Closed-Loop Integration & Verification Test Suite**
- **Objective:** Validate the complete 10-stage cognitive loop end-to-end against all updated components.
- **What Changes:**
  - [`tests/e2e-integration.test.ts`](file:///c:/Users/Suraj/Documents/Antigravity/Personal/personal-ai-study-os/tests/e2e-integration.test.ts):
    - Add test scenario `E2E-07: Full Daily Lifecycle with Blueprint, Evidence, and Memory`:
      1. Fetch study state (asserts `blueprint` container bounds).
      2. Record schedule decision for Morning Focus block.
      3. Complete study session with `evidenceTier: 'observed'`.
      4. Mutate memory fact with `operation: 'ADD'`.
      5. Reconcile evening state (asserts calendar stability and progress projection).
- **What Does NOT Change:**
  - No application code changes.
- **Dependencies:** BUILD-01 through BUILD-04.
- **Tests Required:** Full suite execution (`npm test`).
- **Acceptance Criteria:** All test files pass (21/21), total test count increases from 310 to ~325+, zero regressions.

---

## 5. Human-Only Actions

The following operational actions must be performed exclusively by the human operator. **Antigravity and autonomous agents are strictly prohibited from performing these steps:**

```text
┌────────────────────────────────────────────────────────────────────────┐
│ HUMAN-ONLY OPERATIONAL CHECKLIST                                       │
├────────────────────────────────────────────────────────────────────────┤
│ [ ] 1. Google Workspace OAuth Consent:                                 │
│        Authorize Google Apps Script bridge on personal Google account  │
│        with Calendar and Tasks scopes.                                 │
│                                                                        │
│ [ ] 2. Notion Workspace Setup:                                         │
│        - Create parent page "Personal AI Study OS" in private Notion.  │
│        - Create 5 curated databases: Study History, Curriculum,        │
│          Weak Areas, Research Notes, Projects & Decisions.             │
│        - Create Internal Integration "Personal AI Study OS Core".      │
│        - Connect integration to the parent page.                       │
│        - Copy the 5 Database IDs and Integration Secret.               │
│                                                                        │
│ [ ] 3. Cloudflare Worker Secrets Injection:                            │
│        Execute via Wrangler CLI:                                       │
│        - npx wrangler secret put NOTION_API_KEY                        │
│        - npx wrangler secret put NOTION_WEBHOOK_SECRET                 │
│        - npx wrangler secret put NOTION_STUDY_HISTORY_DB_ID            │
│        - npx wrangler secret put NOTION_CURRICULUM_DB_ID               │
│        - npx wrangler secret put NOTION_WEAK_AREAS_DB_ID               │
│        - npx wrangler secret put NOTION_RESEARCH_DB_ID                 │
│        - npx wrangler secret put NOTION_PROJECTS_DB_ID                 │
│                                                                        │
│ [ ] 4. Gemini Spark Custom Connected App & Custom Instructions:       │
│        - Open Gemini Web UI -> Settings -> Connected Apps.             │
│        - Connect remote MCP server at /mcp with Client ID/Secret.      │
│        - Configure Custom Instructions using system prompt from        │
│          Gemini_Spark_MCP_Integration_Contract_v1.0.md.                │
│                                                                        │
│ [ ] 5. Real-World Blueprint Confirmation:                              │
│        Confirm personal daily study windows match default blueprint:   │
│        09:00-11:30, 14:30-17:00, 19:30-21:30 (or adjust if needed).    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Do-Not-Build List

The following architectural exclusions are permanently preserved:

1. **DO NOT BUILD a custom Calendar UI:** Google Calendar is the sole authority for physical time allocation (**WHEN**).
2. **DO NOT BUILD a custom Task Manager UI:** Google Tasks is the sole authority for deliverable checklists (**WHAT**).
3. **DO NOT BUILD continuous autonomous background rescheduling:** Rescheduling is strictly event-driven (morning forecast, evening review, or explicit human command). The "Motion" pattern is banned.
4. **DO NOT BUILD 1:1 task-to-calendar event mirroring:** Calendar receives coarse 45–90 minute focus containers only; micro-tasks live inside Google Tasks.
5. **DO NOT BUILD in-worker Anki / FSRS repetition engines:** Flashcard intervals and retention calculations are delegated externally to StudySourceCore and native Anki.
6. **DO NOT BUILD giant vector databases:** Single-tenant study assistance does not warrant vector database complexity; D1 with Kysely keyword search fully satisfies durable memory retrieval.
7. **DO NOT BUILD full chat or chain-of-thought archives:** Storing raw LLM conversations or hidden reasoning scratchpads in D1 is strictly forbidden.
8. **DO NOT BUILD surveillance telemetry:** Keystroke logging, webcam monitoring, and browser scraping are banned.
9. **DO NOT BUILD direct agent-to-agent IPC:** All coordination between ChatGPT, Spark, Antigravity, and StudySourceCore is mediated strictly via the Personal State Service and D1 canonical events.
10. **DO NOT BUILD autonomous syllabus or goal alteration:** Syllabus milestones and exam dates are human-immutable; AI only advises on pacing.
11. **DO NOT BUILD automatic rollover of missed study blocks:** Unfinished work returns to the Google Tasks backlog for intentional selection; it never cascades automatically into the next day.
12. **DO NOT BUILD unnecessary infrastructure:** No new Cloudflare Workers, microservices, databases, or queue pipelines are permitted.

---

## 7. Schema / Infrastructure Gate

| Question | Evaluation & Evidence | Verdict |
| :--- | :--- | :---: |
| **Are D1 database migrations required?** | No. All proposed additions (`ScheduleBlueprint`, `evidenceTier`, `mutate_memory_fact`) utilize static TypeScript configs, JSON payload storage in `canonical_events`, and existing `memory_facts`/`memory_versions` tables. | **NO** |
| **Are new database tables required?** | No. The existing 24 tables across 8 domains completely satisfy all requirements. | **NO** |
| **Are existing Cloudflare Queues sufficient?** | Yes. `personal-sync-queue` and `personal-sync-dlq` are fully bound and tested for staging and production. | **YES (Sufficient)** |
| **Is another Cloudflare Worker required?** | No. `apps/worker` handles REST (`/v1/*`), Streamable HTTP MCP (`/mcp`), Cron triggers, and Queue consumers in a single unified deployment. | **NO** |
| **Is another backend service required?** | No. `PersonalStateService` handles all domain logic and cross-system orchestration. | **NO** |

---

## 8. Release / Version Strategy

### Current Status
- Tag `v1.2.3`: Frozen production release baseline.
- Tag `v1.3.0`: Present on commit `f1750d2` (`fix(auth): harden production OAuth configuration`).
- **Rule:** Do **NOT** modify tag `v1.3.0` or retag existing commits.

### Next Release Justification (`v1.3.1` or `v1.4.0`)
A new release tag (e.g. `v1.3.1` if minor patch, or `v1.4.0` if formal minor release) is justified **ONLY** after the following milestones are achieved and verified:
1. **BUILD-01 through BUILD-05 are fully implemented.**
2. **Zero regressions:** Vitest suite passes 100% (target: $\ge 325$ tests passing).
3. **TypeScript build succeeds:** `npm run build` exits 0 across all workspaces.
4. **Clean Git commit:** Backlog implementation committed with conventional commits (`feat(core): ...`, `feat(mcp): ...`).
5. **Pre-Release Tag Gate:** All 5 human operational actions are acknowledged.

---

## 9. Final Acceptance Gate

Before proceeding from Preflight to Implementation, the following three conditions must be met:

1. **Preflight Approval:** The operator reviews and accepts this `FINAL-BUILD-BACKLOG.md` without reopening frozen architecture boundaries.
2. **Zero In-Flight Modifications:** Code and infrastructure remain unmodified during this preflight phase.
3. **Phase Transition Authorized:** Explicit user approval is given to proceed to execution wave (BUILD-01 through BUILD-05).
