# Personal AI Study OS — Technical Contracts & Data Specification v1.1

**Document Version:** 1.1.0
**Status:** READY FOR PRODUCTION IMPLEMENTATION SPECIFICATION
**Contract Type:** Domain, Data, Event, API, MCP and Integration Boundary Specification
**Primary Runtime:** Cloudflare Worker + Cloudflare D1
**Architecture:** Shared-State Coordination Model

---

## 1. Purpose

This document defines the technical contracts that must remain stable while implementing the Personal AI Study OS.

It converts the architectural baseline and the Gate 2 Integration Reality Audit findings into explicit contracts for domain entities, canonical events, state transitions, ownership, data representation, and system interfaces. 

This document is intentionally implementation-independent where possible. The implementation must conform to these contracts rather than allowing individual integrations to redefine the core model.

---

## 2. Architectural Contract

The system follows:

```text
Natural Language
       ↓
Intent Extraction
       ↓
Entity Resolution
       ↓
Semantic Validation
       ↓
Command
       ↓
Domain Validation
       ↓
Canonical Event
       ↓
D1
       ↓
State Projection
       ↓
Downstream Consequences
```

The intent is not canonical state.
The event is canonical historical state.
Derived state may be rebuilt from canonical events.

The architecture therefore follows:

```text
CANONICAL
    Events
       ↓
DERIVED
    Projections
       ↓
PRESENTATION
    Notion / AI Context / Scheduling
```

Commands represent requested actions. Events represent facts that have occurred. The system must never treat an unvalidated command or AI intent as canonical historical state.

---

## 3. Source-of-Truth Contract

| Domain | Owner |
| :--- | :--- |
| Task existence | Google Tasks |
| Task completion | Google Tasks |
| Task metadata & date-level state | Google Tasks |
| Calendar events & time allocation | Google Calendar |
| Start/end time & time blocks | Google Calendar |
| Study session allocation | Google Calendar |
| Human-readable knowledge | Notion |
| Curated history | Notion |
| Canonical machine events | D1 |
| Machine-readable study state | D1 |
| Cross-system relationships | D1 |
| Scheduling decisions | Gemini Spark |
| Reasoning and planning | ChatGPT |
| Technical execution | Antigravity |
| Source ingestion | Antigravity |
| Synchronization state | D1 |

No component may silently become authoritative for another component's domain. A cached external representation inside D1 is never authoritative unless an explicit architectural change is approved.

---

## 4. Core Domain Entities

The initial domain consists of:

```text
User
Subject
Chapter

StudyEvent
StudySession
StudyProgress

Source
SourceChapter
SourceMapping

TaskLink
CalendarLink

ResearchEvent
Decision
Project
ProjectEvent

MemoryFact
MemoryVersion

AgentRun

DailyState
StateSnapshot
Checkpoint

SyncJob
IdempotencyRecord
```

Not every entity is necessarily exposed through a public API. Internal entities may exist solely to support reliable coordination.

---

## 5. Identifier Contract

All persistent entities use stable opaque identifiers.

Recommended format:

```text
usr_01J...
subj_01J...
chap_01J...
evt_01J...
sess_01J...
src_01J...
srcchap_01J...
map_01J...
tasklink_01J...
callink_01J...
proj_01J...
agent_01J...
sync_01J...
snap_01J...
```

Identifiers must be unique, remain stable, never encode mutable display names, never depend on human-readable titles, and remain safe for external references.

---

## 6. Time Contract

All persisted timestamps use ISO 8601-compatible UTC timestamps internally.
Example: `2026-09-10T15:30:00Z`

Where user-local interpretation matters, the originating timezone must be preserved as contextual metadata.

Events distinguish:
* `occurred_at`: When the activity actually happened. (Used for historical interpretation).
* `recorded_at`: When the system recorded it. (Used for audit and ingestion analysis).

---

## 7. Canonical Event Contract

Every meaningful state-changing action must be representable as a canonical event. Canonical events are append-only. An event must never be silently edited to reflect a later correction. Incorrect historical information is handled through a new corrective event.

Minimum event envelope:

```json
{
  "event_id": "evt_01J...",
  "event_type": "study_completed",
  "schema_version": 1,
  "occurred_at": "2026-09-10T15:30:00Z",
  "recorded_at": "2026-09-10T17:30:00Z",
  "actor": {
    "type": "user",
    "id": "usr_01J..."
  },
  "source": {
    "system": "chatgpt",
    "interface": "natural_language"
  },
  "payload": {},
  "correlation_id": "corr_01J...",
  "causation_id": "cmd_01J..."
}
```

The `actor` identifies who performed the action (e.g., user, agent). The `source` identifies the provenance (e.g., chatgpt, spark). The source does not automatically grant authority or bypass authorization. 

---

## 8. Event Taxonomy

Initial event types:

```text
study_started
study_completed
study_session_recorded

chapter_started
chapter_progress_updated
chapter_completed

questions_attempted
assessment_completed

schedule_missed
schedule_adjusted

task_created
task_completed
task_reopened

research_started
research_completed

source_registered
source_mapped

project_started
project_updated
project_completed

decision_recorded

agent_started
agent_completed
agent_failed

memory_added
memory_updated
memory_invalidated

sync_started
sync_completed
sync_failed
```

A new event type should only be introduced when existing semantics cannot represent the event cleanly.

---

## 9. Event Schemas

Event-specific data belongs inside a versioned payload.

* **Study Completion:** Must not automatically imply question performance unless explicitly present.
* **Question Attempt:** Must enforce `0 <= correct <= total_questions`. Accuracy is mathematically derived and not strictly authoritative if present.
* **Study Session:** Enforces `ended_at >= started_at` and `duration_seconds >= 0`. Continuous activity should be aggregated rather than generating heartbeats.
* **Schedule Missed/Adjusted:** Records scheduling decisions/results, but Google Calendar remains authoritative for actual calendar state.
* **Task Events:** D1 stores coordination metadata. Google Tasks remains authoritative for task state.
* **Agent Lifecycle:** Internal reasoning traces or private chain-of-thought must not be stored.
* **Corrections:** Original events are preserved. Corrections create new events, and the projection layer recomputes state.

---

## 10. State and Projection Contract

D1 distinguishes between Canonical State (events), Derived State (study_progress, daily_state, aggregates), and Coordination State (sync_jobs, idempotency records).

* **Rebuildable:** Derived state must be deterministic and rebuildable from canonical events.
* **Atomic Boundary:** Operations requiring atomicity must execute within a Cloudflare D1 batch/atomic operation model. 
  ```text
  Cloudflare D1 coordinated writes must use the supported D1 batch/atomic operation model.
  Do not use explicit:
  BEGIN
  COMMIT
  ROLLBACK
  transaction control statements.
  ```
  The atomic boundary is strictly: `canonical event + critical projection updates + required coordination metadata`. 
  External provider API calls are **not** part of the same D1 atomic transaction.
* **Consistency:** Strong consistency is required for canonical event insertion, idempotency, and entity relationships. Eventual consistency is acceptable for Notion, daily summaries, and external cached metadata.

---

## 11. Study Data Contract

**Subject:** A canonical study domain (e.g., Physics, Mathematics). Names are display values, not identifiers.
**Chapter:** Belongs to a subject. Cannot belong to an unknown subject.
**Study Progress:** A projection derived from events containing fields like completion_status, progress_value, questions_attempted, etc. Must not become the only historical record.
**Accuracy:** Constrained strictly to `0 <= accuracy <= 1`.

---

## 12. Source Mapping Contract

A source represents an external study resource (e.g., book, PDF, syllabus). 
The system stores source metadata and structured mappings against the canonical study model. It does not require storing complete copyrighted source content in D1.

---

## 13. Task Contract

The contract strictly enforces Google Tasks semantics:

```text
Google Tasks = WHAT / task / date-level work
```

Tasks remain authoritative for:
* task existence
* task completion
* task metadata
* date-level task state

Google Tasks **must not** be used as the canonical source for precise intra-day scheduling or specific time blocks.

D1 stores TaskLinks mapping Google Tasks to internal entities (Chapters, Projects, etc.), but D1 must not silently override Google task state.

---

## 14. Calendar Contract

The contract strictly enforces Google Calendar semantics:

```text
Google Calendar = WHEN / precise time allocation
```

Calendar remains authoritative for:
* start time
* end time
* time block
* study session allocation

D1 stores CalendarLinks connecting Calendar events to internal entities. D1 does not replace Google Calendar, and Spark mutations must act upon actual Calendar state verified through the integration.

---

## 15. Project Contract

A project represents meaningful multi-step work. It has a status (planned, active, paused, completed, cancelled). Project events provide the history of execution. Technical execution details remain with Antigravity/project tooling, while D1 records only meaningful, high-level project state.

---

## 16. Memory Contract

Memory mutations use explicit semantic operations (`ADD`, `UPDATE`, `INVALIDATE`, `NONE`). Historical facts should not be silently overwritten. Temporal validity fields (`valid_at`, `invalid_at`) may be used to track changes over time.

---

## 17. Sync Contract

Sync operations are asynchronous. D1 canonical state does not depend on successful external synchronization.

For **Notion Synchronization**, the contract prefers:

```text
Notion Webhook
      ↓
sync event
      ↓
Personal State / Queue
      ↓
controlled synchronization
```

This ensures event-driven primary sync from Notion. However, if a specific Notion state cannot be reliably represented through webhook events, polling remains a bounded reconciliation mechanism. The goal is: `event-driven primary sync + bounded reconciliation`.

Notion syncs must respect rate limits using aggregation, batching, and queued synchronization with backoff and dead-letter handling.

---

## 18. Queue Contract

Cloudflare Queues provide at-least-once delivery. Therefore, queue consumers must be safe against duplicate delivery. 

The consumer flow must be:

```text
Queue Consumer
      ↓
IdempotencyRecord verification
      ↓
external API mutation
```

A duplicate delivery must not blindly repeat an external mutation.

---

## 19. Idempotency Contract

Every mutation must support idempotency. The system records the idempotency key, operation, and result.
The queue delivery ID must be distinguished from the application mutation idempotency key.

The strict contract is:

```text
same job + same idempotency identity = one effective external mutation
```

If the same operation is requested with the same key, it returns the original result. If the payload differs under the same key, it rejects as a conflict. Idempotency keys must be scoped appropriately.

---

## 20. REST API Contract

The public API is versioned (e.g., `/v1/`). Breaking contract changes require a new version (e.g., `/v2/`). Existing endpoint semantics must never be silently changed. 

The API uses semantic interfaces (e.g., `GET /v1/state/today`, `POST /v1/events`). It must not expose arbitrary SQL-like querying. Every mutation must authenticate, authorize, validate, check idempotency, execute atomically where required, and enqueue downstream work.

All requests receive a `request_id`. Related operations share a `correlation_id` for traceability without exposing private reasoning.

---

## 21. MCP Contract

MCP exposes semantic operations over the Personal State Service. Agents must not receive raw D1 access. The MCP surface remains intentionally small and semantically focused. 

MCP tools must validate input, respect authorization, support idempotency, and return structured output. They must not expose raw SQL, arbitrary deletes, or secret access. 

---

## 22. Authentication Contract

Every externally accessible Personal State operation must establish identity (user, client, request). 

Crucially, for MCP OAuth Audience Validation:
The Personal State Service must explicitly validate the intended audience of incoming bearer tokens. 

```text
valid token ≠ automatically authorized Personal State request
```

Validation must include the `issuer`, `audience`, `scope`, `expiration`, and `authorization context` where supported by the selected authentication architecture.

---

## 23. Authorization Contract

Authorization establishes permissions. Permission classes include: read, write, external_mutation, destructive, and administrative. 

High-risk operations (e.g., bulk deletion, mass calendar modification) require stronger controls.

---

## 24. Provider Adapter Contract

Provider-specific behavior must remain isolated in dedicated adapters (e.g., `GoogleTasksAdapter`, `NotionAdapter`). Adapters translate external representations to the canonical domain representation. The core domain layer must not contain provider-specific API logic.

---

## 25. Notion Contract

Notion is the human-facing memory and knowledge layer. D1 may contain Notion IDs and sync metadata. Notion contains curated representations and must not receive raw telemetry, private AI reasoning, every low-level event, or large internal traces.

---

## 26. Google Tasks Contract

Google Tasks is authoritative for task existence and completion. D1 maps task logic to the domain via TaskLinks. Time-of-day execution or intra-day scheduling must not be inferred from Google Tasks.

---

## 27. Google Calendar Contract

Google Calendar is authoritative for specific time blocks and event existence. D1 maps study sessions and scheduling logic via CalendarLinks. Time allocation is exclusively the domain of Google Calendar.

---

## 28. Spark Contract

Gemini Spark is the scheduling decision/execution layer. Spark retrieves current Personal State, Tasks, and Calendar contexts to make scheduling decisions. 

**Scheduling Safety:** 
Spark scheduling mutations must follow these constraints:
```text
minimal
scoped
traceable
```
Spark must avoid unnecessary bulk modifications. Large or highly destructive unattended Calendar mutations may encounter safety guardrails. Spark must not arbitrarily delete calendar history or modify unrelated calendars unless explicitly authorized.

---

## 29. Antigravity Contract

Antigravity is the technical execution and source-ingestion client. It performs source registration, source inspection, technical execution reporting, and checkpointing. Antigravity communicates through the Personal State MCP or REST API. It must not act as a permanent database.

---

## 30. ChatGPT Contract

The architecture enforces the following boundaries:

```text
ChatGPT
=
reasoning / planning / intent generation

Antigravity or other authorized execution client
=
actual mutation / technical execution
```

The architecture must remain valid even if ChatGPT cannot perform unattended mutations. ChatGPT is not a mandatory background execution dependency. It generates structured intents which are executed by an authorized client interacting with the Personal State Service.

---

## 31. Security Contract

The Personal State Service is the security boundary. Clients (ChatGPT, Spark, Antigravity) must access state through authorized interfaces. Clients do not receive direct database credentials.

Secrets (OAuth tokens, API credentials) must never appear in D1 payloads, Notion, Git, logs, MCP responses, or AI prompts. Credential rotation must not require database schema changes.

---

## 32. Error Contract

Errors use stable machine-readable codes (e.g., `VALIDATION_ERROR`, `IDEMPOTENCY_CONFLICT`). While error messages may change, error codes are stable contracts. 

Retryable errors (network failures, rate limits) should be handled gracefully. Permanent failures (invalid payload, unknown entity) must not enter infinite retry loops.

---

## 33. Recovery Contract

External provider failures must never roll back unrelated canonical history. If a projection fails to sync to Notion, the canonical D1 state is preserved, and the sync job can be retried. Repeated sync failures move to a dead-letter state rather than looping infinitely. 

Projections can be rebuilt entirely from canonical events if corrupted.

---

## 34. Versioning Contract

Event schemas, REST APIs, MCP tool contracts, and provider integrations are versioned independently. Breaking changes require explicit version changes. Historical events must remain interpretable; historical events must never become unreadable because the current schema evolved.

---

## 35. Testing Contract

The implementation must include contract tests for event schemas, REST inputs/outputs, MCP schemas, idempotency, and projection behavior. A contract change must cause a visible test change.

---

## 36. Architectural Invariants

The following are non-negotiable:
* D1 is not Notion. Notion is not D1.
* Google Tasks is not D1. Google Calendar is not D1.
* Spark is not D1.
* ChatGPT is not a mandatory background executor.
* Antigravity is not the permanent database.
* Canonical events are immutable.
* Derived state is rebuildable.
* External systems retain ownership of their domains.
* Personal State Service remains the shared coordination boundary.
* No agent-to-agent direct coupling is required.

---

## 37. Change Log

| Version | Change | Reason |
| :--- | :--- | :--- |
| 1.1 | D1 batch transaction contract | Gate 2 finding |
| 1.1 | Tasks/Calendar boundary clarified | Gate 2 finding |
| 1.1 | Queue consumer idempotency strengthened | Gate 2 finding |
| 1.1 | MCP audience validation added | Gate 2 finding |
| 1.1 | Notion event-driven sync clarified | Gate 2 finding |
| 1.1 | ChatGPT execution boundary clarified | Gate 2 finding |
| 1.1 | Spark minimal mutation safety clarified | Gate 2 finding |

---

## 38. Build Readiness

```text
CONTRACT STATUS

Version: 1.1
Gate 2: CLOSED
Architecture: GREEN
Build Blockers: 0
Contract Changes: Incorporated
Status: READY FOR PRODUCTION IMPLEMENTATION SPECIFICATION
```
