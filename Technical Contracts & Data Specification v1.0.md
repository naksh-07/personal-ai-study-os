# Personal AI Study OS

## Technical Contracts & Data Specification

**Document Version:** 1.0.0
**Status:** Contract Draft for Build Readiness Review
**Contract Type:** Domain, Data, Event, API, MCP and Integration Boundary Specification
**Primary Runtime:** Cloudflare Worker + Cloudflare D1
**Architecture:** Shared-State Coordination Model

---

# 1. Purpose

This document defines the technical contracts that must remain stable while implementing the Personal AI Study OS.

It converts the architectural baseline into explicit contracts for:

* domain entities
* canonical events
* state transitions
* ownership
* data representation
* identifiers
* timestamps
* validation
* idempotency
* REST API
* MCP
* synchronization
* external-system relationships
* errors
* security boundaries
* versioning

This document is intentionally implementation-independent where possible.

The implementation must conform to these contracts rather than allowing individual integrations to redefine the core model.

---

# 2. Architectural Contract

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

---

# 3. Source-of-Truth Contract

| Domain                              | Owner           |
| ----------------------------------- | --------------- |
| Task existence                      | Google Tasks    |
| Task completion                     | Google Tasks    |
| Calendar events and time allocation | Google Calendar |
| Human-readable knowledge            | Notion          |
| Curated history                     | Notion          |
| Canonical machine events            | D1              |
| Machine-readable study state        | D1              |
| Cross-system relationships          | D1              |
| Scheduling decisions                | Gemini Spark    |
| Reasoning and planning              | ChatGPT         |
| Technical execution                 | Antigravity     |
| Source ingestion                    | Antigravity     |
| Synchronization state               | D1              |

No component may silently become authoritative for another component's domain.

A cached external representation inside D1 is never authoritative unless an explicit architectural change is approved.

---

# 4. Core Domain Entities

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

Not every entity is necessarily exposed through a public API.

Internal entities may exist solely to support reliable coordination.

---

# 5. Identifier Contract

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

Identifiers must:

* be unique
* remain stable
* never encode mutable display names
* never depend on human-readable titles
* remain safe for external references

Example:

```text
chapter_id = chap_01KABC...
display_name = "Current Electricity"
```

If the display name changes to:

```text
Current Electricity & Circuits
```

the identifier remains unchanged.

---

# 6. Time Contract

All persisted timestamps use ISO 8601-compatible UTC timestamps internally.

Example:

```text
2026-09-10T15:30:00Z
```

Where user-local interpretation matters, the originating timezone must be preserved as contextual metadata.

Events distinguish:

```text
occurred_at
recorded_at
```

Example:

```text
User actually studied:
21:00 IST

User reported it:
23:00 IST
```

Then:

```text
occurred_at = 2026-09-10T15:30:00Z
recorded_at = 2026-09-10T17:30:00Z
```

Historical interpretation must use `occurred_at`.

Audit and ingestion analysis uses `recorded_at`.

---

# 7. Canonical Event Contract

Every meaningful state-changing action must be representable as a canonical event.

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
  "subject_id": "subj_01J...",
  "chapter_id": "chap_01J...",
  "payload": {},
  "correlation_id": "corr_01J...",
  "causation_id": "cmd_01J..."
}
```

Required envelope fields:

```text
event_id
event_type
schema_version
occurred_at
recorded_at
actor
source
payload
```

Entity references are required where applicable.

---

# 8. Event Immutability

Canonical events are append-only.

An event must never be silently edited to reflect a later correction.

Incorrect historical information is handled through a new corrective event.

Example:

```text
Original:
63 correct

Correction:
67 correct
```

Representation:

```text
study result event
       ↓
correction event
       ↓
recomputed projection
```

This preserves auditability.

---

# 9. Event Taxonomy

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

New event types require justification.

A new event type should only be introduced when existing semantics cannot represent the event cleanly.

---

# 10. Event Schema: Study Completion

Example:

```json
{
  "event_type": "study_completed",
  "schema_version": 1,
  "payload": {
    "activity_type": "chapter",
    "completion_status": "completed"
  }
}
```

Optional references:

```text
subject_id
chapter_id
source_id
```

A study completion event must not automatically imply question performance unless question data is explicitly present.

---

# 11. Event Schema: Question Attempt

```json
{
  "event_type": "questions_attempted",
  "schema_version": 1,
  "payload": {
    "activity_type": "PYQ",
    "total_questions": 80,
    "correct": 67
  }
}
```

Domain constraints:

```text
total_questions >= 0
correct >= 0
correct <= total_questions
```

Accuracy is mathematically derived:

```text
accuracy = correct / total_questions
```

The canonical event may store accuracy for convenience only if the implementation guarantees consistency.

The authoritative raw values are:

```text
total_questions
correct
```

---

# 12. Event Schema: Study Session

```json
{
  "event_type": "study_session_recorded",
  "schema_version": 1,
  "payload": {
    "activity_type": "study",
    "started_at": "2026-09-10T13:00:00Z",
    "ended_at": "2026-09-10T15:00:00Z",
    "duration_seconds": 7200,
    "status": "completed"
  }
}
```

Constraints:

```text
ended_at >= started_at
duration_seconds >= 0
```

The system must avoid generating a separate session for every activity heartbeat.

Continuous activity should be aggregated.

---

# 13. Event Schema: Chapter Completion

```json
{
  "event_type": "chapter_completed",
  "schema_version": 1,
  "subject_id": "subj_01J...",
  "chapter_id": "chap_01J...",
  "payload": {
    "completion_status": "completed"
  }
}
```

A chapter must resolve to an existing canonical chapter.

Unknown chapters must fail validation.

---

# 14. Event Schema: Schedule Miss

```json
{
  "event_type": "schedule_missed",
  "payload": {
    "calendar_event_id": "external-calendar-id",
    "reason": "user_reported",
    "action_required": true
  }
}
```

This event records what happened.

It does not itself perform rescheduling.

Spark evaluates the scheduling consequence separately.

---

# 15. Event Schema: Schedule Adjustment

```json
{
  "event_type": "schedule_adjusted",
  "payload": {
    "reason": "missed_session",
    "calendar_event_ids": [
      "external-calendar-id"
    ],
    "adjustment_scope": "minimal"
  }
}
```

The event records the scheduling decision/result.

Google Calendar remains authoritative for actual calendar state.

---

# 16. Event Schema: Task Events

Task creation:

```json
{
  "event_type": "task_created",
  "payload": {
    "provider": "google_tasks",
    "external_task_id": "external-id"
  }
}
```

Task completion:

```json
{
  "event_type": "task_completed",
  "payload": {
    "provider": "google_tasks",
    "external_task_id": "external-id"
  }
}
```

D1 stores coordination metadata.

Google Tasks remains authoritative for task state.

---

# 17. Event Schema: Research

Research events:

```text
research_started
research_completed
```

Example:

```json
{
  "event_type": "research_completed",
  "payload": {
    "topic": "RRB ALP syllabus analysis",
    "result_reference": "notion-page-id",
    "status": "completed"
  }
}
```

Large research documents do not belong in event payloads.

The event should reference the resulting artifact.

---

# 18. Event Schema: Project Events

Project lifecycle:

```text
project_started
project_updated
project_completed
```

Example:

```json
{
  "event_type": "project_completed",
  "payload": {
    "project_id": "proj_01J...",
    "phase": "Phase 2",
    "status": "completed"
  }
}
```

Technical execution details remain with Antigravity/project tooling.

D1 records meaningful project state.

---

# 19. Event Schema: Agent Lifecycle

```text
agent_started
agent_completed
agent_failed
```

Minimum payload:

```json
{
  "agent_id": "agent_01J...",
  "agent_type": "antigravity",
  "operation": "source_ingestion",
  "status": "completed"
}
```

Private chain-of-thought or internal reasoning must not be stored.

---

# 20. Event Schema: Memory

Memory mutations use explicit semantic operations:

```text
ADD
UPDATE
INVALIDATE
NONE
```

Events:

```text
memory_added
memory_updated
memory_invalidated
```

Historical facts should not be silently overwritten.

Where temporal validity matters:

```text
valid_at
invalid_at
```

may be used by the memory model.

---

# 21. Event Source Contract

Every event identifies its originating system.

Allowed initial source identifiers:

```text
chatgpt
spark
antigravity
user
google_tasks
google_calendar
notion
system
```

The source identifies provenance.

It does not automatically grant authority.

For example:

```text
source = chatgpt
```

does not mean ChatGPT can bypass authorization.

---

# 22. Actor Contract

Actor types:

```text
user
agent
system
integration
```

Example:

```json
{
  "actor": {
    "type": "agent",
    "id": "spark"
  }
}
```

Actor and source are separate concepts.

Example:

```text
actor = user
source = chatgpt
```

means the user supplied the information through ChatGPT.

---

# 23. Command vs Event

Commands represent requested actions.

Events represent facts that have occurred.

Example:

```text
Command:
record 67 correct answers

        ↓

Validation

        ↓

Event:
questions_attempted
```

The system must never treat an unvalidated command or AI intent as canonical historical state.

---

# 24. Intent Contract

AI clients may produce structured intent.

Example:

```json
{
  "intent_type": "record_question_result",
  "subject_reference": "Physics",
  "chapter_reference": "Current Electricity",
  "total_questions": 80,
  "correct": 67,
  "confidence": 0.98
}
```

Important:

```text
confidence ≠ validation
```

A confidence score can influence clarification behavior.

It cannot override domain constraints.

---

# 25. Entity Resolution Contract

Natural-language references must resolve to canonical IDs.

Examples:

```text
"Current Elec"
"Current Electricity"
"Current electricity chapter"
```

must resolve to one canonical chapter when the entity is unambiguous.

If multiple entities match:

```text
do not guess
```

The system must request clarification or preserve an unresolved intent.

---

# 26. Ambiguity Contract

Example:

```text
"Magnetism ho gaya."
```

Possible meanings:

```text
started
studied partially
completed
revised
```

The system must not convert this into:

```text
chapter_completed
```

without sufficient evidence.

Ambiguous input may result in:

```text
clarification_required
```

or a lower-confidence proposal requiring confirmation.

---

# 27. State Classification

D1 distinguishes:

## Canonical state

```text
events
```

## Derived state

```text
study_progress
daily_state
aggregates
project_state
```

## Coordination state

```text
sync_jobs
external IDs
checkpoints
idempotency records
```

Derived state must be rebuildable.

---

# 28. Study Progress Contract

Study progress is a projection.

Minimum conceptual fields:

```text
chapter_id
completion_status
progress_value
questions_attempted
questions_correct
accuracy
study_minutes
first_studied_at
last_studied_at
completed_at
updated_at
```

Progress must be derived from canonical events wherever practical.

The projection must not become the only historical record.

---

# 29. Accuracy Contract

Given:

```text
attempted = 80
correct = 67
```

the projection calculates:

```text
accuracy = 67 / 80
         = 0.8375
         = 83.75%
```

Constraints:

```text
0 <= correct <= attempted
0 <= accuracy <= 1
```

If attempted is zero:

```text
accuracy = null
```

rather than division by zero.

---

# 30. Study Session Contract

A session represents meaningful study activity.

Minimum fields:

```text
session_id
subject_id
chapter_id
activity_type
started_at
ended_at
duration_seconds
source
status
```

Possible status:

```text
planned
active
completed
cancelled
unknown
```

A session must not be used as a substitute for Calendar events.

Calendar represents allocated time.

Study session represents actual study activity.

---

# 31. Subject Contract

A subject represents a canonical study domain.

Minimum:

```text
subject_id
name
status
created_at
updated_at
```

Example:

```text
Physics
Mathematics
Reasoning
Biology
```

Names are display values, not identifiers.

---

# 32. Chapter Contract

A chapter belongs to a subject.

Minimum:

```text
chapter_id
subject_id
name
status
created_at
updated_at
```

Relationship:

```text
Subject
   │
   └── Chapter
```

A chapter cannot belong to an unknown subject.

---

# 33. Source Contract

A source represents an external study resource.

Examples:

```text
book
PDF
website
lecture
syllabus
question bank
```

Minimum conceptual fields:

```text
source_id
source_type
title
publisher_or_origin
reference
status
created_at
updated_at
```

The system stores source metadata and mappings.

It does not require storing complete copyrighted source content.

---

# 34. Source Mapping Contract

A source mapping connects source material to the canonical study model.

Conceptual fields:

```text
source_id
source_chapter_id
chapter_id
topic_reference
location_reference
mapping_confidence
mapping_status
```

Example:

```text
Book
 ↓
Chapter 7
 ↓
Current Electricity
 ↓
Pages 182–214
```

The source location must remain recoverable.

---

# 35. Task Link Contract

D1 stores relationships between external tasks and internal entities.

Example:

```text
Google Task
      ↕
D1 TaskLink
      ↕
Chapter / Study Session / Project
```

Conceptual fields:

```text
link_id
provider
external_task_id
entity_type
entity_id
relationship_type
created_at
updated_at
```

Google remains authoritative for:

```text
task title
completion
due state
provider-specific metadata
```

---

# 36. Calendar Link Contract

D1 stores relationships between Calendar events and internal entities.

Conceptual fields:

```text
link_id
provider
external_event_id
entity_type
entity_id
relationship_type
created_at
updated_at
```

Google Calendar remains authoritative for:

```text
event timing
event existence
calendar-specific metadata
```

---

# 37. Task vs Calendar Contract

The conceptual distinction is permanent:

```text
Google Tasks = WHAT
Google Calendar = WHEN
```

Example:

```text
Task:
Complete Current Electricity PYQs

Calendar:
19:00–21:00 Study Session
```

D1 may connect them.

D1 does not replace either system.

---

# 38. Project Contract

A project represents meaningful multi-step work.

Minimum:

```text
project_id
name
status
created_at
updated_at
```

Possible status:

```text
planned
active
paused
completed
cancelled
```

Project events provide history.

---

# 39. Agent Run Contract

An agent run represents meaningful execution.

Minimum:

```text
agent_run_id
agent_type
operation
status
started_at
completed_at
correlation_id
result_reference
error_code
```

Internal reasoning traces are excluded.

---

# 40. Daily State Contract

`daily_state` is derived state.

It may contain:

```text
date
planned_minutes
actual_minutes
completed_sessions
missed_sessions
tasks_completed
tasks_pending
study_progress_summary
important_changes
updated_at
```

Daily state must be rebuildable.

It must never be treated as the canonical event history.

---

# 41. Snapshot Contract

Snapshots provide faster reconstruction.

A snapshot may contain:

```text
snapshot_id
snapshot_type
state_version
created_at
payload
```

Snapshots are optimization artifacts.

If a snapshot conflicts with canonical events:

```text
canonical events win
```

---

# 42. Checkpoint Contract

Checkpoints support reliable long-running workflows.

Example:

```text
source ingestion
project execution
sync processing
```

Conceptual fields:

```text
checkpoint_id
workflow_type
workflow_id
state
cursor
updated_at
```

Checkpoint state must be safe to resume.

---

# 43. Sync Job Contract

A sync job represents asynchronous downstream work.

Minimum:

```text
sync_job_id
target
entity_type
entity_id
status
attempt_count
available_at
last_attempted_at
completed_at
error_code
created_at
updated_at
```

Status:

```text
pending
processing
completed
failed
dead_letter
cancelled
```

---

# 44. Sync Job Payload

Queue messages should contain stable references rather than duplicated large state.

Example:

```json
{
  "job_id": "sync_01J...",
  "target": "notion",
  "entity_type": "study_day",
  "entity_id": "2026-09-10"
}
```

The worker retrieves current state from D1.

This prevents stale duplicated payloads.

---

# 45. Consistency Contract

## Strong consistency required for

```text
canonical event insertion
idempotency
entity relationships
state transitions
```

## Eventual consistency acceptable for

```text
Notion
cached Google metadata
daily summaries
human-facing dashboards
non-critical aggregations
```

External provider failure must not destroy canonical D1 history.

---

# 46. Idempotency Contract

Every mutation must support idempotency.

Request:

```text
Idempotency-Key: <stable-key>
```

The system records:

```text
key
operation
request_hash
result
created_at
```

Repeated identical requests:

```text
return original result
```

Same key with different request content:

```text
reject as conflict
```

Idempotency keys must be scoped appropriately to the authenticated user/client.

---

# 47. Duplicate Event Contract

If the same natural-language statement is processed twice:

```text
same logical operation
+
same idempotency key
```

must produce one mutation.

If two genuinely separate study sessions have identical payloads:

```text
different idempotency keys
```

they remain separate events.

Payload similarity alone must never deduplicate real events.

---

# 48. Concurrency Contract

Multiple clients may act simultaneously.

Example:

```text
Spark → Calendar
User → Calendar
Antigravity → Project state
ChatGPT → Study event
```

The system must use appropriate:

```text
idempotency
optimistic version checks
transaction boundaries
ownership rules
event ordering
```

No client may assume that previously read state is still current.

---

# 49. Event Ordering Contract

Events contain:

```text
event_id
occurred_at
recorded_at
```

Timestamp alone is not sufficient for strict ordering.

Where strict ordering matters, the persistence layer must provide a monotonic ordering mechanism.

Historical ordering must remain deterministic.

---

# 50. Correction Contract

Corrections create new events.

Example:

```text
Event A:
80 attempted, 63 correct

Event B:
Correction:
80 attempted, 67 correct
```

The projection layer interprets the correction according to event semantics.

The original event remains immutable.

---

# 51. REST API Contract

Public API version:

```text
/v1/
```

Breaking contract changes require:

```text
/v2/
```

Non-breaking additions remain under the existing version.

Existing endpoint semantics must never be silently changed.

---

# 52. REST Read Operations

Initial semantic endpoints:

```text
GET /v1/state/today

GET /v1/state/study

GET /v1/state/subjects/{id}

GET /v1/state/chapters/{id}

GET /v1/state/activity

GET /v1/state/work

GET /v1/state/schedule

GET /v1/state/projects/{id}

GET /v1/memory/search

GET /v1/sync/status
```

These are semantic interfaces.

The API must not expose arbitrary SQL-like querying.

---

# 53. REST Mutation Operations

Initial operations:

```text
POST /v1/events

POST /v1/study/sessions

POST /v1/study/progress

POST /v1/chapters/{id}/complete

POST /v1/research

POST /v1/decisions

POST /v1/projects/events

POST /v1/links/tasks

POST /v1/links/calendar
```

Every mutation must:

```text
authenticate
authorize
validate
check idempotency
execute transactionally where required
produce canonical state
update required projections
enqueue downstream work
return stable result
```

---

# 54. Request ID Contract

Every API request receives:

```text
request_id
```

Example:

```text
req_01J...
```

The identifier must be available in:

```text
logs
errors
agent execution records
sync operations
```

---

# 55. Correlation ID Contract

A correlation ID connects operations belonging to one workflow.

Example:

```text
User statement
 ↓
Intent
 ↓
Command
 ↓
Event
 ↓
Projection
 ↓
Notion sync
```

All related operations may share:

```text
corr_01J...
```

This enables end-to-end diagnosis without storing private reasoning.

---

# 56. REST Success Contract

Successful responses should have a stable envelope.

Example:

```json
{
  "ok": true,
  "request_id": "req_01J...",
  "data": {},
  "meta": {
    "schema_version": 1
  }
}
```

Exact resource-specific data is defined by endpoint contracts during implementation.

---

# 57. REST Error Contract

Errors use stable machine-readable codes.

Example:

```json
{
  "ok": false,
  "request_id": "req_01J...",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "correct cannot exceed total_questions",
    "retryable": false
  }
}
```

Error categories:

```text
VALIDATION_ERROR
AUTHENTICATION_ERROR
AUTHORIZATION_ERROR
NOT_FOUND
CONFLICT
IDEMPOTENCY_CONFLICT
EXTERNAL_PROVIDER_ERROR
RATE_LIMITED
TEMPORARY_ERROR
INTERNAL_ERROR
```

Error messages may change.

Error codes are stable contracts.

---

# 58. Retry Contract

Retryable failures include:

```text
temporary network failure
provider timeout
worker interruption
temporary provider outage
rate limit
```

Permanent failures include:

```text
invalid payload
unknown entity
authorization failure
invalid relationship
idempotency conflict
```

Permanent failures must not enter infinite retry loops.

---

# 59. MCP Contract

MCP exposes semantic operations over the Personal State Service.

Agents must not receive raw D1 access.

The MCP surface remains intentionally small.

---

# 60. MCP Read Tools

Initial read tools:

```text
get_today_state
get_study_state
get_subject_state
get_chapter_state
get_recent_activity
get_pending_work
get_schedule_context
get_project_state
search_memory
get_sync_status
```

---

# 61. MCP Mutation Tools

Initial mutation tools:

```text
record_event
record_study_session
update_progress
complete_chapter
record_research
record_decision
link_task
link_calendar_event
```

---

# 62. MCP System Tools

Initial system operation:

```text
checkpoint
```

Potential diagnostics:

```text
get_sync_status
```

The MCP must not expose:

```text
raw SQL
arbitrary table writes
arbitrary DELETE
database administration
secret access
```

---

# 63. MCP Tool Contract Principles

Each tool must:

```text
have a narrow semantic purpose
validate input
respect authorization
support idempotency where mutating
return structured output
avoid unnecessary context
avoid provider-specific details where possible
```

The MCP surface should remain small.

A large collection of tiny database-shaped tools is explicitly rejected.

---

# 64. Authentication Contract

Every externally accessible Personal State operation must identify:

```text
user
client
permission scope
request
```

Authentication establishes identity.

Authorization establishes permission.

These are separate checks.

---

# 65. Authorization Contract

Permission classes:

```text
read
write
external_mutation
destructive
administrative
```

Examples:

### Read

```text
get_today_state
get_progress
search_memory
```

### Write

```text
record_event
record_session
update_progress
```

### External mutation

```text
modify Google Calendar
modify Google Tasks
update Notion
```

### High-risk

```text
bulk deletion
mass calendar modification
administrative operations
```

High-risk operations require stronger controls.

---

# 66. Secret Contract

Secrets must never appear in:

```text
D1 event payloads
Notion
Git
logs
MCP responses
AI prompts
API responses
sync payloads
```

Secrets belong in the platform's secure secret/environment mechanism.

Expected secret categories include:

```text
OAuth credentials
API tokens
provider credentials
MCP authentication secrets
```

Credential rotation must not require database schema changes.

---

# 67. Notion Contract

Notion is the human-facing memory and knowledge layer.

D1 may contain:

```text
Notion page IDs
database IDs
sync status
last_synced_at
relationship metadata
```

Notion contains curated representations.

Notion must not receive:

```text
raw telemetry
private AI reasoning
every low-level event
large internal traces
```

---

# 68. Notion Synchronization Contract

Flow:

```text
Canonical Event
      ↓
Projection
      ↓
Determine presentation consequence
      ↓
Create/update Sync Job
      ↓
Queue
      ↓
Notion Worker
      ↓
Curated Notion update
```

Notion synchronization is asynchronous.

D1 canonical state does not depend on successful Notion synchronization.

---

# 69. Notion Rate-Limit Contract

Avoid:

```text
one Notion write per tiny event
```

Prefer:

```text
aggregation
batching
daily summaries
milestone updates
queued synchronization
```

The synchronization layer must support:

```text
retry
backoff
deduplication
dead-letter handling
```

---

# 70. Google Tasks Contract

Google Tasks remains authoritative for:

```text
task existence
task completion
task-specific metadata
```

D1 stores:

```text
external task ID
relationships
sync metadata
relevant event history
```

D1 must not silently override Google task state.

---

# 71. Google Calendar Contract

Google Calendar remains authoritative for:

```text
calendar event existence
actual time allocation
event timing
calendar metadata
```

D1 stores coordination metadata.

Spark may request scheduling changes, but actual Calendar state must be verified through the integration.

---

# 72. Spark Contract

Spark is the scheduling decision/execution layer.

A scheduling workflow must:

```text
1. Retrieve current Personal State
2. Retrieve current Tasks
3. Retrieve current Calendar
4. Determine completed/pending work
5. Detect conflicts or missed sessions
6. Calculate minimal adjustment
7. Mutate only authorized scope
8. Record scheduling result
```

Spark must not rely on stale assumptions about schedule state.

---

# 73. Scheduling Safety Contract

Spark must not arbitrarily:

```text
delete calendar history
modify unrelated calendars
rewrite large periods of schedule
```

unless explicitly authorized.

Scheduling adjustments should be:

```text
minimal
scoped
traceable
reversible where practical
```

---

# 74. Antigravity Contract

Antigravity is the technical execution and source-ingestion client.

Supported conceptual operations:

```text
source registration
source inspection
syllabus mapping
project updates
technical execution reporting
checkpointing
Notion documentation
```

Antigravity should communicate through:

```text
Personal State MCP
REST/API where appropriate
provider-specific integrations
```

It must not become the permanent database.

---

# 75. Source Ingestion Contract

Input:

```text
source
+
syllabus
```

Processing:

```text
inspect source
 ↓
extract TOC/index
 ↓
identify relevant chapters/topics
 ↓
map against syllabus
 ↓
register source
 ↓
store structured mapping
 ↓
curate Study Library
```

The system should preserve:

```text
source
chapter
topic
page/section
syllabus mapping
priority
```

It should not require storing complete source material inside D1.

---

# 76. ChatGPT Contract

ChatGPT is the reasoning/planning layer.

Core responsibilities:

```text
reasoning
planning
research synthesis
natural-language interpretation
structured intent generation
state-aware planning
```

The architecture must not depend on direct ChatGPT write access.

Supported path:

```text
ChatGPT
   ↓
structured intent/action proposal
   ↓
execution-capable client
   ↓
Personal State Service
```

If future capabilities change, the core contract remains unchanged.

---

# 77. Provider Adapter Contract

Provider-specific behavior must remain isolated.

Initial conceptual adapters:

```text
GoogleTasksAdapter
GoogleCalendarAdapter
NotionAdapter
SparkIntegration
ChatGPTIntegration
AntigravityIntegration
```

Adapters translate:

```text
external representation
        ↕
canonical domain representation
```

The domain layer must not contain provider-specific API logic where avoidable.

---

# 78. Ownership Enforcement

Every mutable field must have an owner.

Example:

```text
Google Task title
→ Google

Chapter progress
→ D1 projection

Human-readable study summary
→ Notion

Schedule adjustment decision
→ Spark
```

If two systems appear to own the same field, the design is incomplete.

---

# 79. Database Contract

The initial logical schema is grouped as:

```text
Identity
├── users

Study
├── subjects
├── chapters
├── study_events
├── study_sessions
└── study_progress

Sources
├── sources
├── source_chapters
└── source_mappings

Coordination
├── task_links
├── calendar_links
└── sync_jobs

Projects
├── projects
└── project_events

Research
├── research_events
└── decisions

Agents
└── agent_runs

Memory
├── memory_facts
└── memory_versions

State
├── daily_state
├── state_snapshots
└── checkpoints

Reliability
└── idempotency_records
```

Exact SQL types and indexes belong to the implementation specification, but they must implement these domain boundaries.

---

# 80. Foreign-Key Contract

Relationships that represent canonical domain ownership should enforce referential integrity where supported.

Examples:

```text
chapter → subject
study_progress → chapter
study_session → subject
study_session → chapter
source_mapping → source
source_mapping → chapter
```

External provider IDs are not treated as internal foreign keys unless explicitly represented through integration/link entities.

---

# 81. JSON Payload Contract

Flexible event-specific data belongs inside a versioned payload.

Example:

```json
{
  "event_type": "questions_attempted",
  "schema_version": 1,
  "payload": {
    "total_questions": 80,
    "correct": 67
  }
}
```

Core fields required for querying should not be buried unnecessarily inside JSON.

Use relational columns for stable high-value query dimensions.

Use payloads for event-specific details.

---

# 82. Indexing Contract

Indexes must support actual access patterns.

Primary expected query patterns:

```text
events by user
events by type
events by occurred_at
events by chapter
events by subject
recent activity
pending sync jobs
idempotency lookup
external ID lookup
current progress
```

Do not index every column.

---

# 83. Projection Contract

Projection handlers must be deterministic.

Example:

```text
questions_attempted
80 / 67
```

updates:

```text
questions_attempted += 80
questions_correct += 67
accuracy = 67 / 80
last_activity_at = event.occurred_at
```

A projection must produce the same result when rebuilt from the same canonical event sequence.

---

# 84. Projection Rebuild Contract

Every important derived projection must support rebuild.

Example:

```text
Canonical Events
       ↓
Projection Engine
       ↓
Fresh study_progress
```

If derived state becomes corrupted:

```text
delete/reinitialize projection
       ↓
replay canonical events
       ↓
restore state
```

Canonical events are the recovery foundation.

---

# 85. Transaction Contract

Operations requiring atomicity must execute within a transaction boundary where supported.

Example:

```text
validate event
 ↓
idempotency check
 ↓
insert canonical event
 ↓
update required projection
 ↓
create sync job
```

The implementation must define exactly which steps are atomic and which are asynchronous.

External provider calls must not be embedded inside long database transactions unnecessarily.

---

# 86. Asynchronous Boundary

Synchronous path:

```text
authentication
validation
idempotency
canonical event creation
critical projection
```

Asynchronous path:

```text
Notion updates
large aggregation
external synchronization
retryable downstream work
```

The user-facing mutation should not wait unnecessarily for external presentation updates.

---

# 87. Freshness Contract

Cached external metadata must expose:

```text
last_synced_at
```

Consumers should be able to distinguish:

```text
fresh
stale
unknown
```

Stale provider metadata must not be presented as guaranteed current reality.

---

# 88. Observability Contract

Minimum observable system state:

```text
event ingestion status
sync status
queue status
recent errors
agent run status
last successful sync
last failed operation
```

Diagnostic responses must never expose secrets.

---

# 89. Audit Contract

Important mutations record:

```text
who
what
when
source
affected entity
correlation ID
result
```

Auditability must be achieved through structured metadata and immutable events.

Private AI reasoning is excluded.

---

# 90. Error Recovery Contract

Provider failure example:

```text
D1 event
   ↓
projection
   ↓
Notion sync job
   ↓
Notion failure
```

Required result:

```text
D1 canonical state = preserved
sync job = failed/pending
retry = possible
```

External failure must never roll back unrelated canonical history unless the domain transaction itself failed.

---

# 91. Dead-Letter Contract

A sync operation that repeatedly fails must eventually move to:

```text
dead_letter
```

rather than retry indefinitely.

Dead-letter records must preserve enough information to diagnose and replay the operation safely.

---

# 92. Rate-Limit Contract

External integrations must assume:

```text
rate limits
timeouts
temporary outages
partial failures
```

The integration layer must provide:

```text
backoff
retry
deduplication
bounded attempts
dead-letter handling
```

---

# 93. Security Boundary

The Personal State Service is the security boundary.

Clients:

```text
ChatGPT
Spark
Antigravity
other future clients
```

must access state through authorized interfaces.

Clients do not receive direct database credentials.

---

# 94. Data Minimization Contract

Do not store information merely because it is available.

D1 should contain information necessary for:

```text
coordination
state
history
automation
relationships
recovery
auditability
```

Notion should contain information useful for:

```text
human understanding
reference
curated history
knowledge
decisions
```

Raw telemetry and internal AI traces are excluded.

---

# 95. Versioning Contract

The following are versioned independently:

```text
event schema
REST API
MCP tool contract
database migrations
provider adapter contracts
```

Breaking changes require explicit version changes.

Existing historical events must remain interpretable.

---

# 96. Backward Compatibility

Historical events may use older schema versions.

Example:

```text
event_type = questions_attempted
schema_version = 1
```

A future implementation may introduce:

```text
schema_version = 2
```

The projection engine must either:

```text
support both versions
```

or:

```text
normalize old versions through a migration layer
```

Historical events must never become unreadable because the current schema evolved.

---

# 97. Contract Testing

The implementation must include contract tests for:

```text
event schemas
REST requests
REST responses
MCP tool schemas
database migrations
external ID handling
idempotency
error codes
projection behavior
```

A contract change must cause a visible test change.

---

# 98. Core Acceptance Scenario A

Input:

> "Aaj Physics mein Current Electricity complete ki. 80 PYQ kiye, 67 correct."

Expected conceptual flow:

```text
Natural Language
 ↓
Intent extraction
 ↓
Entity resolution
 ↓
Validation
 ↓
chapter_completed
+
questions_attempted
 ↓
D1
 ↓
study_progress projection
 ↓
daily_state projection
 ↓
Notion sync job
```

Expected derived accuracy:

```text
83.75%
```

---

# 99. Core Acceptance Scenario B

Input:

> "Aaj schedule follow nahi hua."

Expected:

```text
schedule_missed
 ↓
D1
 ↓
Spark reads current state
 ↓
Spark reads Tasks
 ↓
Spark reads Calendar
 ↓
minimal schedule adjustment if required
 ↓
schedule_adjusted
```

Historical calendar information remains intact.

---

# 100. Core Acceptance Scenario C

Input:

> "Antigravity ne StudySourceCore Phase 2 complete kar diya."

Expected:

```text
project_completed
 ↓
D1 project state
 ↓
curated Notion project update
```

No internal execution trace is copied into Notion.

---

# 101. Core Acceptance Scenario D

Input:

```text
PDF + syllabus
```

Expected:

```text
source inspection
 ↓
TOC/index extraction
 ↓
syllabus mapping
 ↓
source registration
 ↓
source mapping
 ↓
D1
 ↓
Notion Study Library
```

Full source content does not need to be stored in D1.

---

# 102. Core Acceptance Scenario E

Duplicate request:

```text
same mutation
same Idempotency-Key
```

Expected:

```text
one canonical mutation
same stable result
no duplicate event
```

Same key with modified payload:

```text
IDEMPOTENCY_CONFLICT
```

---

# 103. Core Acceptance Scenario F

Correction:

Original:

```text
80 attempted
63 correct
```

Correction:

```text
Actually 67 correct
```

Expected:

```text
original event preserved
+
correction event
+
projection recomputation
```

No silent historical mutation.

---

# 104. Core Acceptance Scenario G

Ambiguous statement:

> "Magnetism ho gaya."

Expected:

```text
completion is NOT automatically recorded
```

The originating client must clarify or create an explicitly non-authoritative intent.

---

# 105. Architectural Invariants

The following are non-negotiable unless an explicit architecture revision is approved:

```text
D1 is not Notion.

Notion is not D1.

Google Tasks is not D1.

Google Calendar is not D1.

Spark is not D1.

ChatGPT is not the required write engine.

Antigravity is not the permanent database.

No AI agent requires direct agent-to-agent communication.

Canonical events are immutable.

Derived state is rebuildable.

External systems retain ownership of their domains.

Personal State Service is the shared coordination boundary.
```

---

# 106. Forbidden Shortcuts

The implementation must not introduce:

```text
raw SQL through MCP
direct client-to-D1 credentials
Notion as machine state
Google Calendar as study history database
Google Tasks as project database
ChatGPT as mandatory write engine
Antigravity as permanent storage
one database table per AI agent
one event type per tiny UI action
unbounded event payloads
silent historical edits
infinite retries
unscoped calendar mutation
```

---

# 107. Change Control

Any change to this contract must answer:

```text
1. What problem requires the change?
2. Which existing contract is insufficient?
3. Which owner is affected?
4. Does canonical state change?
5. Does event semantics change?
6. Does API/MCP compatibility change?
7. Does historical data remain readable?
8. Does idempotency remain valid?
9. Does security scope change?
10. What tests must change?
```

Architectural changes require an ADR.

---

# 108. Contract Freeze Criteria

This document is considered sufficiently frozen for implementation when:

```text
[ ] Core entities are accepted
[ ] Ownership matrix is accepted
[ ] Event taxonomy is accepted
[ ] Event envelope is accepted
[ ] Critical event payloads are defined
[ ] Identifier strategy is accepted
[ ] Time model is accepted
[ ] State/projection distinction is accepted
[ ] Correction semantics are accepted
[ ] Ambiguity policy is accepted
[ ] Idempotency semantics are accepted
[ ] API surface is accepted
[ ] MCP surface is accepted
[ ] Error categories are accepted
[ ] Security boundaries are accepted
[ ] Provider ownership is accepted
[ ] Sync semantics are accepted
[ ] Recovery semantics are accepted
[ ] Acceptance scenarios pass design review
```

---

# 109. Build-Readiness Rule

No production implementation should begin by inventing these semantics inside application code.

The correct sequence is:

```text
Technical Contracts
       ↓
Build Specification
       ↓
D1 Schema
       ↓
Domain Engine
       ↓
Projections
       ↓
REST
       ↓
Security
       ↓
MCP
       ↓
Queue
       ↓
Integrations
```

The implementation may refine low-level details.

It must not casually redefine the domain.

---

# 110. Final Contract Model

The Personal AI Study OS is therefore governed by:

```text
                    USER
                      │
                      ▼
             Natural Language
                      │
                      ▼
              Intent / Command
                      │
                      ▼
             Domain Validation
                      │
                      ▼
              Canonical Events
                      │
                      ▼
                     D1
                      │
             ┌────────┴────────┐
             ▼                 ▼
       State Projections    Event History
             │                 │
             ├────────┬────────┤
             ▼        ▼        ▼
          Notion    Spark    Agent Context
             │        │        │
             ▼        ▼        ▼
        Human Memory Schedule Technical Work
```

The central technical contract is:

```text
ONE CANONICAL MACHINE STATE
+
IMMUTABLE EVENTS
+
REBUILDABLE PROJECTIONS
+
SMALL SEMANTIC API
+
SMALL SEMANTIC MCP
+
EXPLICIT OWNERSHIP
+
IDEMPOTENT MUTATIONS
+
ASYNC EXTERNAL SYNC
+
PROVIDER ISOLATION
```

This is the foundation on which the implementation specification and actual system will be built.
