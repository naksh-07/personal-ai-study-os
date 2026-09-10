# PERSONAL AI STUDY OS

## Technical Architecture, Data Flow, Engineering Standards & Implementation Blueprint

---

# 1. SYSTEM OBJECTIVE

Personal AI Study OS is a state-coordination system connecting existing productivity, knowledge, scheduling, reasoning, and technical-execution platforms.

The system must provide:

```text
Natural Language
      ↓
Intent / Event
      ↓
Validation
      ↓
Canonical State
      ↓
Derived State
      ↓
Human Memory / Scheduling / Agent Context
```

The custom system must remain intentionally small.

Its purpose is not to replace Google Tasks, Google Calendar, Notion, Gemini Spark, ChatGPT, or Antigravity.

Its purpose is to provide the missing coordination layer between them.

---

# 2. NORTH STAR

The following responsibility model is an architectural invariant:

> Google manages your commitments.
>
> Spark manages your schedule.
>
> Notion remembers what matters to you.
>
> D1 remembers what machines need to know.
>
> ChatGPT helps you think.
>
> Antigravity gets technical work done.

Any future architectural change must preserve these roles unless there is strong evidence and an explicit architecture revision.

---

# 3. ARCHITECTURAL GOALS

The implementation must optimize for:

1. Simplicity
2. Reliability
3. Maintainability
4. Idempotency
5. Recoverability
6. Observability
7. Security
8. Extensibility
9. Low operational overhead
10. Cloud availability
11. Human readability
12. Machine efficiency
13. Provider independence
14. Backward-compatible evolution

The architecture must avoid premature complexity.

---

# 4. NON-GOALS

The system must not become:

* another task manager
* another calendar
* another note-taking platform
* another project-management platform
* a general-purpose distributed workflow engine
* a giant multi-agent framework
* a textbook storage system
* a raw conversation archive
* a mandatory ChatGPT automation platform
* a replacement for existing Google, Notion, Spark, or Antigravity capabilities

---

# 5. HIGH-LEVEL ARCHITECTURE

```text
                                  USER
                                    │
                  ┌─────────────────┼─────────────────┐
                  │                 │                 │
                  ▼                 ▼                 ▼
              ChatGPT          Antigravity         Spark
              THINK              BUILD              ACT
                  │                 │                 │
                  │                 │                 ├──── Google Tasks
                  │                 │                 └──── Google Calendar
                  │                 │
                  └─────────────────┼─────────────────┐
                                    │                 │
                                    ▼                 │
                         PERSONAL STATE SERVICE        │
                              REST + MCP              │
                                    │                 │
                                    ▼                 │
                             CLOUDFLARE WORKER         │
                                    │                 │
                         ┌──────────┴──────────┐      │
                         ▼                     ▼      │
                        D1                    Queue    │
                         │                     │       │
          ┌──────────────┼──────────────┐      │       │
          ▼              ▼              ▼      │       │
       Events          State         Metadata   │       │
          │              │              │       │       │
          └──────────────┼──────────────┘       │       │
                         │                      │       │
                         ▼                      │       │
                    Projections                 │       │
                         │                      │       │
                         └──────────┬───────────┘       │
                                    ▼                   │
                              Notion Sync ◄─────────────┘
                                    │
                                    ▼
                                  NOTION
```

The architecture uses a central shared-state model.

Agents do not depend on direct agent-to-agent communication.

---

# 6. ARCHITECTURAL LAYERS

The implementation should contain six logical layers.

## Layer 1: Clients

```text
ChatGPT
Gemini Spark
Antigravity
```

Responsibilities:

* user interaction
* reasoning
* scheduling
* technical execution
* intent generation

Clients should not directly manipulate D1 tables.

---

## Layer 2: Integration Interfaces

```text
Personal State REST API
Personal State MCP
```

Responsibilities:

* authentication
* authorization
* schema validation
* semantic operations
* request normalization

---

## Layer 3: Domain Layer

Core concepts:

```text
Event
StudySession
StudyProgress
Subject
Chapter
Source
TaskLink
CalendarLink
MemoryFact
AgentRun
SyncJob
ProjectEvent
```

The domain layer must remain provider-independent.

---

## Layer 4: Persistence

```text
Cloudflare D1
```

Responsibilities:

* canonical events
* structured state
* relationships
* projections
* synchronization metadata
* idempotency
* checkpoints

---

## Layer 5: Asynchronous Processing

```text
Cloudflare Queue
```

Responsibilities:

* Notion synchronization
* retryable external operations
* aggregation
* non-critical downstream processing

The synchronous request path must remain short.

---

## Layer 6: Human-Facing Systems

```text
Notion
Google Tasks
Google Calendar
```

Each remains authoritative only within its own domain.

---

# 7. SOURCE-OF-TRUTH MATRIX

| Domain                     | Source of Truth |
| -------------------------- | --------------- |
| Task existence             | Google Tasks    |
| Task completion            | Google Tasks    |
| Calendar time allocation   | Google Calendar |
| Human-facing knowledge     | Notion          |
| Curated notes              | Notion          |
| Canonical machine events   | D1              |
| Machine-readable progress  | D1              |
| Scheduling decisions       | Spark           |
| Reasoning/planning         | ChatGPT         |
| Technical execution        | Antigravity     |
| Cross-system relationships | D1              |
| Synchronization state      | D1              |

A cached representation inside D1 must never silently become authoritative for an external system.

---

# 8. DATA OWNERSHIP

Every important field must have a clear owner.

Example:

```text
Google Task:
    title
    completion
    due date
```

Google owns these.

D1 may store:

```text
external_task_id
cached_title
cached_status
last_seen_at
```

but these are integration metadata.

Similarly:

```text
Notion page
    human-written note
```

remains Notion-owned.

D1 may know that the page exists and what entity it represents.

---

# 9. CANONICAL EVENT MODEL

Events are the primary mechanism for recording meaningful state changes.

A canonical event contains:

```text
event_id
event_type
occurred_at
recorded_at
actor
source
entity references
payload
schema_version
correlation_id
idempotency_key
```

Example:

```json
{
  "event_id": "evt_01J...",
  "event_type": "questions_attempted",
  "schema_version": 1,
  "occurred_at": "2026-09-10T20:30:00+05:30",
  "recorded_at": "2026-09-10T20:31:02+05:30",
  "actor": {
    "type": "user",
    "id": "user_01"
  },
  "source": {
    "system": "chatgpt",
    "interface": "intent"
  },
  "entities": {
    "subject_id": "physics",
    "chapter_id": "magnetism"
  },
  "payload": {
    "total_questions": 80,
    "correct": 63,
    "accuracy": 0.7875
  },
  "correlation_id": "corr_01J..."
}
```

---

# 10. EVENT IMMUTABILITY

Canonical events must be append-oriented.

An existing event should not normally be edited.

If an event was wrong:

```text
original event
      ↓
correction event
```

Example:

```text
questions_attempted
80 / 63
```

followed by:

```text
study_event_corrected
correct = 65
```

The event history remains auditable.

Derived state can then be recalculated.

---

# 11. EVENT SCHEMA VERSIONING

Every event type must have a version.

Example:

```text
questions_attempted:v1
questions_attempted:v2
```

When schemas evolve:

```text
old event
    remains v1

new events
    use v2
```

Consumers must be able to handle supported versions.

Historical events must not require destructive migration merely because the current schema changed.

---

# 12. EVENT CLASSIFICATION

Events should be classified into:

## User events

```text
study_completed
study_session_recorded
questions_attempted
chapter_completed
decision_recorded
```

## System events

```text
sync_started
sync_completed
sync_failed
checkpoint_created
projection_rebuilt
```

## Agent events

```text
agent_started
agent_completed
agent_failed
```

## External events

```text
task_completed
calendar_changed
notion_updated
```

This allows filtering and operational diagnostics.

---

# 13. COMMAND VS EVENT

The architecture must distinguish:

```text
COMMAND
```

from:

```text
EVENT
```

A command means:

> Please perform this operation.

An event means:

> This operation happened.

Example:

```text
Command:
complete_chapter(Magnetism)

↓

Validation

↓

Event:
chapter_completed(Magnetism)
```

The system should not record a successful event before the requested operation has actually succeeded.

---

# 14. INTENT MODEL

Natural-language input should first become structured intent.

Example:

```json
{
  "intent_type": "record_study_result",
  "confidence": 0.96,
  "entities": {
    "subject": "Physics",
    "chapter": "Magnetism"
  },
  "data": {
    "questions": 80,
    "correct": 63
  }
}
```

The intent is not itself canonical state.

It must pass validation before becoming an event.

---

# 15. INTENT PIPELINE

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
State Projection
```

This separation prevents an AI hallucination from directly becoming authoritative state.

---

# 16. ENTITY RESOLUTION

Natural language may use:

```text
"Current Elec"
"Current Electricity"
"Current electricity chapter"
```

The system should resolve these to one canonical entity:

```text
chapter_id = current-electricity
```

Canonical IDs should be stable.

Display names may change without breaking historical relationships.

---

# 17. DOMAIN IDENTIFIERS

Internal identifiers should be opaque stable IDs.

Example:

```text
subj_01J...
chap_01J...
evt_01J...
sess_01J...
src_01J...
```

Human-readable names should not be used as primary identifiers.

This prevents problems when:

* names change
* spelling is corrected
* subjects are renamed
* duplicate names exist

---

# 18. TIME MODEL

All stored timestamps should use:

```text
UTC internally
```

while preserving the user's relevant timezone context where necessary.

Events should distinguish:

```text
occurred_at
recorded_at
```

Example:

The user studies at 21:00 and reports it at 23:00.

```text
occurred_at = 21:00
recorded_at = 23:00
```

This distinction is important for historical analysis and scheduling.

---

# 19. STUDY SESSION MODEL

A study session represents meaningful continuous activity.

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

Sessions should not be generated from every activity heartbeat.

Heartbeats must be aggregated.

---

# 20. STUDY PROGRESS MODEL

Progress is a projection derived from events.

Example:

```text
chapter_completed
questions_attempted
study_session_recorded
```

can produce:

```text
chapter_progress
last_studied_at
completion_status
question_accuracy
study_minutes
```

The projection must be rebuildable.

---

# 21. DERIVED STATE

D1 should distinguish:

```text
CANONICAL
```

from:

```text
DERIVED
```

Canonical:

```text
events
```

Derived:

```text
daily_state
study_progress
aggregates
```

If a derived table becomes corrupted:

```text
events
 ↓
rebuild
 ↓
derived state
```

---

# 22. PROJECTION ENGINE

The projection engine converts events into state.

```text
Event
 ↓
Event Handler
 ↓
Validate event semantics
 ↓
Update projection
```

Example:

```text
questions_attempted
80 / 63
```

updates:

```text
questions_attempted += 80
questions_correct += 63
accuracy = 63 / 80
last_activity_at = event.occurred_at
```

Projection handlers must be deterministic.

---

# 23. D1 SCHEMA ORGANIZATION

The schema should be grouped logically.

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

External Systems
├── tasks
├── calendar_events
└── schedule_links

Memory
├── memory_facts
└── memory_versions

Projects / Agents
├── projects
├── project_events
└── agent_runs

Operations
├── daily_state
├── state_snapshots
├── sync_jobs
├── idempotency_keys
└── checkpoints
```

---

# 24. DATABASE NORMALIZATION

The schema should remain relational for core entities.

Do not place the entire system into giant JSON blobs.

Use normalized columns for frequently queried fields:

```text
subject_id
chapter_id
event_type
occurred_at
status
created_at
```

Use JSON only for flexible event-specific payloads.

This provides both:

```text
queryability
+
schema flexibility
```

---

# 25. JSON PAYLOAD RULE

JSON payloads should contain event-specific information.

Example:

```json
{
  "total_questions": 80,
  "correct": 63,
  "accuracy": 0.7875
}
```

Fields needed frequently for filtering, joining, sorting, or constraints should remain relational.

Do not hide important query dimensions inside JSON.

---

# 26. DATABASE CONSTRAINTS

Where possible, enforce invariants at the database level.

Examples:

```text
unique external IDs
foreign keys
non-null required fields
valid status values
unique idempotency keys
```

Application validation remains necessary, but database constraints provide the final safety boundary.

---

# 27. INDEX STRATEGY

Initial indexes should prioritize:

```text
events:
    event_type
    occurred_at
    subject_id
    chapter_id

study_progress:
    subject_id
    chapter_id

sessions:
    started_at
    subject_id
    chapter_id

sync_jobs:
    status
    next_attempt_at

agent_runs:
    status
    started_at

external IDs:
    provider + external_id
```

Indexes should be introduced based on actual query patterns.

Avoid indexing every column.

---

# 28. PERSONAL STATE API

The REST API should expose semantic operations.

Example:

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

Mutation:

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

Version all public API routes.

---

# 29. API VERSIONING

Initial API:

```text
/v1/
```

Breaking changes require:

```text
/v2/
```

Non-breaking additions should remain within the existing version.

Do not silently change the meaning of an existing endpoint.

---

# 30. REQUEST ID

Every API request should receive:

```text
request_id
```

Example:

```text
req_01J...
```

This identifier must appear in:

* logs
* error responses
* relevant agent execution records
* sync operations

This makes debugging possible across system boundaries.

---

# 31. CORRELATION ID

A correlation ID tracks a complete workflow.

Example:

```text
User statement
 ↓
ChatGPT intent
 ↓
D1 event
 ↓
Notion sync
 ↓
Notion update
```

All operations may share:

```text
correlation_id = corr_01J...
```

This provides end-to-end traceability without storing private reasoning.

---

# 32. IDEMPOTENCY

Every mutation endpoint must support idempotency.

Request:

```text
Idempotency-Key: <stable-key>
```

The service stores:

```text
key
operation
request_hash
result
created_at
```

Repeated identical requests return the original result.

Repeated keys with different payloads are rejected.

---

# 33. RETRY MODEL

Retries must be safe because:

```text
network failure
worker restart
provider timeout
MCP retry
Spark retry
```

can happen after an operation actually succeeded.

Therefore:

```text
retry
≠
duplicate operation
```

Idempotency is mandatory.

---

# 34. SYNCHRONOUS VS ASYNCHRONOUS OPERATIONS

Synchronous:

```text
authentication
validation
event creation
basic projection update
```

Asynchronous:

```text
Notion update
large aggregation
external synchronization
retryable downstream work
```

The user-facing request should not wait unnecessarily for Notion.

---

# 35. QUEUE ARCHITECTURE

Example:

```text
D1 event
   ↓
Determine downstream work
   ↓
Create sync job
   ↓
Queue
   ↓
Worker
   ↓
External provider
```

Queue messages must contain stable identifiers rather than large duplicated state whenever possible.

Example:

```json
{
  "job_id": "job_01J...",
  "target": "notion",
  "entity_type": "study_day",
  "entity_id": "2026-09-10"
}
```

The worker can retrieve current state from D1.

---

# 36. SYNC JOB STATE MACHINE

```text
pending
   ↓
processing
   ├──→ completed
   │
   ├──→ retry_wait
   │        ↓
   │      pending
   │
   └──→ dead_letter
```

Every failed job should retain:

```text
attempt_count
last_error
last_attempt_at
next_attempt_at
```

---

# 37. NOTION SYNC MODEL

Notion synchronization must be derived from D1 state.

```text
D1
 ↓
Aggregation
 ↓
Human-readable representation
 ↓
Sync Job
 ↓
Notion
```

Notion should never be required for reconstructing machine state.

---

# 38. NOTION OWNERSHIP

Each Notion object must define:

```text
machine-owned fields
human-owned fields
derived fields
```

Example:

```text
Study Log

Machine-owned:
    date
    chapter
    accuracy

Human-owned:
    personal observation
    reflection

Derived:
    weekly summary
```

Automatic sync must never overwrite human-owned content.

---

# 39. NOTION CONFLICT HANDLING

If both D1 and Notion contain changed values:

```text
Do not blindly overwrite.
```

Instead:

```text
identify ownership
compare timestamps/version
apply defined merge rule
```

If no safe merge rule exists:

```text
mark conflict
retain both states
surface for resolution
```

---

# 40. GOOGLE TASKS MODEL

D1 should store only coordination metadata.

Example:

```text
task_link

task_id
provider
external_task_id
related_entity_type
related_entity_id
status_snapshot
last_synced_at
```

Google Tasks remains authoritative for task completion.

---

# 41. GOOGLE CALENDAR MODEL

D1 stores:

```text
calendar_event_link

external_event_id
provider
related_task_id
related_entity_id
start
end
status_snapshot
last_synced_at
```

Google Calendar remains authoritative for actual time allocation.

---

# 42. TASK-CALENDAR RELATIONSHIP

A task may have:

```text
zero
one
or multiple
```

calendar sessions over time.

Therefore the relationship should not assume one-to-one forever.

Example:

```text
Task:
Complete Magnetism

Calendar:
10 Sep 16:00–17:00
11 Sep 18:00–19:00
```

Both can refer to the same task.

---

# 43. SPARK EXECUTION MODEL

Spark should behave as a scheduling worker.

A scheduled workflow:

```text
Read D1 state
      ↓
Read Google Tasks
      ↓
Read Google Calendar
      ↓
Determine current reality
      ↓
Apply scheduling rules
      ↓
Modify Google systems
      ↓
Record scheduling event
```

Spark must not assume previous execution context is current.

---

# 44. SPARK SCHEDULING PRINCIPLES

Priority:

```text
1. Preserve hard commitments
2. Preserve completed work
3. Preserve valid existing blocks
4. Recover important missed work
5. Protect deep-work blocks
6. Minimize changes
7. Never destroy history
```

The scheduler should prefer local adjustments over global schedule reconstruction.

---

# 45. SCHEDULE CHANGE SAFETY

A scheduling workflow should define:

```text
maximum number of events it may modify
allowed calendar scopes
allowed date range
protected events
```

This prevents one faulty AI decision from rewriting an entire calendar.

---

# 46. CHATGPT EXECUTION MODEL

ChatGPT should primarily produce:

```text
reasoning
plans
intent
structured proposals
```

The system must not depend on:

```text
ChatGPT → D1 direct write
```

being available.

Where direct write is supported in the future, it becomes another client of the Personal State Service.

No domain architecture change should be necessary.

---

# 47. ANTIGRAVITY EXECUTION MODEL

Antigravity consumes the same state layer.

Responsibilities:

```text
source ingestion
technical execution
repository operations
project state
D1 operations
Notion documentation
```

Antigravity must use semantic Personal State operations rather than arbitrary database manipulation wherever possible.

---

# 48. SOURCE INGESTION PIPELINE

```text
Source
  ↓
Metadata extraction
  ↓
TOC/index extraction
  ↓
Structure detection
  ↓
Syllabus parsing
  ↓
Entity matching
  ↓
Relevance scoring
  ↓
Human-reviewable mapping
  ↓
D1 registration
  ↓
Notion Study Library
```

The complete source should not automatically enter D1.

---

# 49. SOURCE REFERENCES

Every registered source should preserve:

```text
source URI
edition
chapter
section
page/range
location reference
```

This allows agents to retrieve the original material when required without duplicating it.

---

# 50. SOURCE MAPPING CONFIDENCE

Mappings should have:

```text
mapping_type
relevance
confidence
```

Example:

```text
exact
high
0.96
```

or:

```text
partial
medium
0.71
```

Low-confidence mappings should remain distinguishable from confirmed mappings.

---

# 51. MEMORY ARCHITECTURE

Memory is divided into:

```text
Operational State
Historical Events
Long-Term Facts
```

These must not be conflated.

---

# 52. MEMORY MUTATION MODEL

Long-term memory operations:

```text
ADD
UPDATE
INVALIDATE
NONE
```

A new fact should not automatically overwrite an older fact.

Where temporal history matters:

```text
valid_at
invalid_at
```

should be recorded.

---

# 53. MEMORY STORAGE

Example:

```text
memory_facts

id
fact_type
content
subject/entity reference
confidence
valid_at
invalid_at
created_at
updated_at
```

Version history:

```text
memory_versions

id
memory_id
operation
previous_value
new_value
changed_at
source_event_id
```

---

# 54. MEMORY SEARCH

Initial search:

```text
relational filters
+
full-text search
```

Potential future:

```text
semantic/vector search
```

Only introduce vector infrastructure when actual retrieval requirements justify it.

---

# 55. DAILY STATE

Daily state is a performance projection.

Example:

```text
daily_state

date
study_minutes
sessions_count
questions_attempted
questions_correct
accuracy
completed_chapters
missed_sessions
completed_tasks
pending_tasks
major_events
updated_at
```

This allows Spark and other clients to retrieve today's context efficiently.

---

# 56. STATE SNAPSHOTS

Snapshots should be used for:

```text
recovery
debugging
historical reconstruction
faster restoration
```

They must include:

```text
schema_version
created_at
snapshot_type
state
```

Snapshots are disposable derived artifacts.

---

# 57. CHECKPOINTS

Long-running technical workflows may create checkpoints.

Example:

```text
checkpoint

project_id
run_id
phase
state
created_at
schema_version
```

If Antigravity execution stops:

```text
last checkpoint
      ↓
resume
```

rather than restarting everything.

---

# 58. AGENT EXECUTION MODEL

Agent execution records should capture operational facts.

```text
agent
run_type
started_at
completed_at
status
result_summary
error_code
correlation_id
```

Do not store hidden chain-of-thought or raw internal reasoning.

---

# 59. PROJECT STATE

Projects should support:

```text
planned
active
blocked
completed
archived
```

Project events remain historical.

Current project state is derived.

Example:

```text
project_started
project_updated
project_completed
```

---

# 60. ERROR TAXONOMY

Standard error classes:

```text
VALIDATION_ERROR
AUTHENTICATION_ERROR
AUTHORIZATION_ERROR
NOT_FOUND
CONFLICT
IDEMPOTENCY_CONFLICT
RATE_LIMITED
EXTERNAL_PROVIDER_ERROR
TEMPORARY_ERROR
INTERNAL_ERROR
```

Errors must expose stable machine-readable codes.

Human-readable messages can change.

---

# 61. RETRY POLICY

Retry only errors that are likely transient.

Retry candidates:

```text
network timeout
provider temporary failure
rate limiting
temporary Worker failure
```

Do not automatically retry:

```text
invalid input
permission denied
unknown entity
schema violation
idempotency conflict
```

---

# 62. DEAD-LETTER HANDLING

After bounded retries:

```text
failed job
   ↓
dead_letter
```

Dead-letter jobs must remain inspectable.

They must not disappear.

---

# 63. OBSERVABILITY

The system must expose:

```text
request status
event ingestion
queue status
sync status
agent runs
recent failures
projection health
```

A diagnostic surface should answer:

```text
Is the state service healthy?
Are events being recorded?
Are queues processing?
Is Notion syncing?
Are integrations failing?
```

---

# 64. LOGGING

Logs should contain:

```text
timestamp
level
service
request_id
correlation_id
operation
status
duration
error_code
```

Logs must not contain:

```text
API secrets
OAuth tokens
passwords
private credentials
unnecessary personal data
raw AI reasoning
```

---

# 65. METRICS

Initial metrics:

```text
events_created_total
events_failed_total
api_requests_total
api_request_duration
sync_jobs_pending
sync_jobs_failed
sync_jobs_completed
agent_runs_total
agent_failures_total
projection_failures_total
```

Avoid building a huge analytics system.

These metrics exist for system health, not user-facing study analytics.

---

# 66. HEALTH CHECKS

Provide:

```text
GET /v1/health
```

and where useful:

```text
GET /v1/health/dependencies
```

The dependency health endpoint should distinguish:

```text
D1
Queue
Notion
Google
```

rather than returning one generic "everything is broken" status.

---

# 67. SECURITY ARCHITECTURE

Security boundaries:

```text
Client
 ↓
Authentication
 ↓
Authorization
 ↓
Domain operation
 ↓
Persistence
```

Every write must pass authorization.

---

# 68. PERMISSION SCOPES

Minimum conceptual scopes:

```text
state:read
state:write
tasks:read
tasks:write
calendar:read
calendar:write
notion:read
notion:write
project:write
admin
```

Clients should receive only required permissions.

---

# 69. CLIENT PERMISSION MODEL

Example:

### ChatGPT

```text
state:read
intent generation
```

Write permission only if explicitly supported and intentionally enabled.

### Spark

```text
state:read
state:write
tasks:read/write
calendar:read/write
```

### Antigravity

```text
state:read/write
project:write
source:write
notion:write
```

Permissions must remain configurable.

---

# 70. SECRET MANAGEMENT

Secrets must live outside source code and D1.

Examples:

```text
Google credentials
Notion token
MCP authentication secrets
OAuth secrets
Cloudflare credentials
```

Use platform secret storage.

Never write credentials into:

```text
events
logs
Notion
Git
database payloads
```

---

# 71. DATA MINIMIZATION

Store only information required for:

```text
state
coordination
history
recovery
auditing
```

Do not store complete conversations simply because storage is available.

Do not store complete books simply because D1 can technically hold references to them.

---

# 72. PRIVACY BOUNDARY

The system should classify data into:

```text
Operational
Historical
Human-facing
Integration metadata
Secrets
```

Secrets must never enter the normal data plane.

Raw private content should not be copied across systems unless required.

---

# 73. PROVIDER ADAPTER ARCHITECTURE

External providers should be isolated behind adapters.

```text
GoogleTasksAdapter
GoogleCalendarAdapter
NotionAdapter
```

The domain layer should not depend directly on provider SDKs.

Example:

```text
Domain:
complete_task()

Adapter:
GoogleTasksAdapter.complete()
```

This makes provider replacement possible.

---

# 74. MCP ARCHITECTURE

MCP should expose domain-level tools.

Good:

```text
get_today_state
get_chapter_state
record_event
record_study_session
update_progress
```

Avoid:

```text
execute_sql
update_row
delete_row
run_query
```

Agents should not receive arbitrary database authority.

---

# 75. MCP TOOL DESIGN

Every tool should have:

```text
clear name
clear description
strict input schema
strict output schema
permission scope
idempotency semantics where relevant
error contract
```

Tool descriptions should explain when the tool should and should not be used.

---

# 76. MCP OUTPUT DESIGN

Prefer compact structured output.

Example:

```json
{
  "chapter": {
    "id": "chap_01",
    "name": "Magnetism",
    "status": "in_progress",
    "progress": 72
  },
  "recent_activity": {
    "questions": 80,
    "correct": 63,
    "accuracy": 0.7875
  }
}
```

Do not return the entire database when an agent asks for today's state.

---

# 77. CONTEXT EFFICIENCY

AI clients should receive:

```text
relevant state
+
small summaries
+
stable identifiers
```

rather than:

```text
entire history
+
entire Notion workspace
+
entire event log
```

The Personal State Service should perform the filtering.

---

# 78. API RESPONSE ENVELOPE

Responses should use a consistent shape.

Success:

```json
{
  "data": {},
  "request_id": "req_01J..."
}
```

Error:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid study result"
  },
  "request_id": "req_01J..."
}
```

This simplifies client implementations.

---

# 79. MIGRATION STRATEGY

Database migrations must be:

```text
versioned
ordered
repeatable
reviewable
```

Never manually alter production schema without a migration.

Migration files should be committed to version control.

---

# 80. BACKWARD COMPATIBILITY

When possible:

```text
add
migrate
deprecate
remove
```

Do not:

```text
remove immediately
```

Example:

```text
v1 field
 ↓
new field introduced
 ↓
dual-write if required
 ↓
backfill
 ↓
read switch
 ↓
deprecate old field
 ↓
remove later
```

---

# 81. DATA MIGRATION SAFETY

Every migration should define:

```text
preconditions
migration
verification
rollback/recovery strategy
```

For destructive migrations:

```text
backup/snapshot
+
verification
+
explicit approval
```

---

# 82. SCHEMA CHANGE RULE

A schema change must answer:

1. Why is it required?
2. What existing data is affected?
3. Can old clients still function?
4. Can state be reconstructed?
5. Does the event schema need a version?
6. Does the API version change?
7. Does the Notion sync contract change?

---

# 83. DEPLOYMENT ENVIRONMENTS

Use at least:

```text
development
staging
production
```

Development:

```text
local testing
fake/test integrations
```

Staging:

```text
production-like schema
controlled integration tests
```

Production:

```text
real data
real integrations
strict credentials
```

---

# 84. ENVIRONMENT ISOLATION

Never allow development credentials to point at production data by accident.

Environment-specific:

```text
D1 database
OAuth credentials
Notion workspace/database
queue
secrets
```

must be explicitly configured.

---

# 85. CI/CD

Every change should pass:

```text
format
lint
typecheck
unit tests
integration tests
migration validation
build
```

before deployment.

Production deployment should be versioned.

---

# 86. RELEASE STRATEGY

Use:

```text
development
 ↓
staging
 ↓
verification
 ↓
production
```

For high-risk changes:

```text
deploy
 ↓
observe
 ↓
verify
 ↓
continue
```

Do not bundle unrelated architectural changes into one release.

---

# 87. FEATURE FLAGS

Feature flags should be used for risky integrations where appropriate.

Example:

```text
notion_sync_enabled
spark_scheduler_enabled
automatic_progress_projection_enabled
```

This allows:

```text
code deployed
feature disabled
```

while testing.

---

# 88. TESTING PYRAMID

```text
          E2E
         /   \
   Integration
      /       \
     Unit Tests
```

Most behavior should be covered at the unit/domain level.

External integrations require focused integration tests.

---

# 89. UNIT TESTS

Required:

```text
event validation
entity resolution
accuracy calculation
progress calculation
projection logic
memory mutation
idempotency
state transitions
schedule decision rules
```

---

# 90. INTEGRATION TESTS

Required:

```text
Worker ↔ D1
Worker ↔ Queue
Worker ↔ Notion
MCP ↔ Worker
Google Tasks adapter
Google Calendar adapter
```

Use isolated test resources.

---

# 91. CONTRACT TESTS

Verify:

```text
REST schemas
MCP schemas
event schemas
database migrations
provider adapter contracts
```

Contract tests protect the system when clients evolve independently.

---

# 92. FAILURE TESTING

Explicitly test:

```text
duplicate event
duplicate request
network timeout
Notion unavailable
Google unavailable
queue retry
worker restart
partial sync
invalid entity
stale external state
schema mismatch
permission failure
```

---

# 93. RECOVERY TEST

A critical acceptance test:

```text
Delete/rebuild derived state
       ↓
Replay canonical events
       ↓
Reconstruct equivalent state
```

If this does not work, the event architecture is incomplete.

---

# 94. DISASTER RECOVERY

The recovery hierarchy is:

```text
Canonical Events
      ↓
Snapshots
      ↓
Derived State
      ↓
External Sync
```

The system must always prioritize preservation of canonical events.

---

# 95. EXTERNAL PROVIDER FAILURE

If Notion fails:

```text
D1 continues
events continue
sync job remains pending
retry later
```

If Google fails:

```text
machine state remains intact
external operation is marked failed/pending
retry or manual resolution
```

If Spark fails:

```text
state remains intact
future scheduling run can recover
```

If Antigravity stops:

```text
checkpoint remains
project state remains
```

---

# 96. EVENTUAL CONSISTENCY

Not all systems need immediate consistency.

The architecture intentionally uses:

```text
D1
= canonical machine state

Notion
= eventually synchronized human representation
```

This means a short delay between D1 and Notion is acceptable.

The user-facing architecture must make this distinction clear internally.

---

# 97. CONSISTENCY MODEL

### Strong consistency required for

```text
canonical event insertion
idempotency
entity relationships
state transitions
```

### Eventual consistency acceptable for

```text
Notion
cached Google metadata
daily summaries
human-facing dashboards
non-critical aggregations
```

---

# 98. STALE DATA HANDLING

External cached metadata must contain:

```text
last_synced_at
```

Consumers should know whether information is:

```text
fresh
stale
unknown
```

The system must not present stale cached external data as guaranteed current reality.

---

# 99. CONCURRENCY

Multiple agents may attempt operations around the same time.

Examples:

```text
Spark updates schedule
user manually changes Calendar
Antigravity updates project
ChatGPT records progress
```

Therefore mutations should use:

```text
idempotency
optimistic version checks where needed
event ordering
ownership rules
```

---

# 100. EVENT ORDERING

Events should contain:

```text
occurred_at
recorded_at
event_id
```

Ordering should not depend exclusively on timestamps.

Where strict ordering matters, use a monotonic database sequence or transaction-local ordering mechanism.

---

# 101. DUPLICATE EVENTS

If the same natural-language statement is processed twice:

```text
same idempotency key
```

must prevent duplicate mutation.

If two genuinely separate events occur with similar payloads:

```text
different idempotency keys
```

they remain separate.

---

# 102. USER CORRECTION

If the user says:

> "Nahi bhai, 63 nahi 67 correct the."

The system should create a correction rather than silently editing history.

```text
original result
      ↓
correction event
      ↓
recomputed projection
```

---

# 103. NATURAL-LANGUAGE AMBIGUITY

Example:

> "Magnetism ho gaya."

This could mean:

```text
started
completed
studied partially
revised
```

The system must not infer completion with unjustified confidence.

Ambiguous statements should either:

```text
request clarification
```

or create a lower-confidence intent that requires confirmation before authoritative mutation.

---

# 104. CONFIDENCE POLICY

AI-generated structured intent may contain:

```text
confidence
```

But confidence must not replace domain validation.

Example:

```text
confidence = 0.99
```

does not make:

```text
correct > total
```

valid.

Domain rules always win.

---

# 105. HUMAN APPROVAL POLICY

Low-risk:

```text
record study event
update progress
```

may be automated.

Higher-risk:

```text
mass calendar modification
delete memory
bulk Notion changes
external communications
destructive operations
```

should require stronger approval.

---

# 106. SCHEDULING SAFETY

Spark should never be allowed to:

```text
delete arbitrary calendar history
modify unrelated calendars
rewrite months of schedule
```

unless explicitly authorized.

Scheduling operations should be scoped.

---

# 107. RATE LIMIT PROTECTION

External integrations must assume:

```text
rate limits
timeouts
temporary outages
```

Queue-based processing should provide:

```text
backoff
retry
deduplication
dead-letter handling
```

---

# 108. NOTION RATE LIMIT STRATEGY

Avoid:

```text
one Notion write per tiny event
```

Prefer:

```text
event aggregation
daily batching
milestone updates
queued synchronization
```

This reduces API pressure and keeps Notion readable.

---

# 109. GOOGLE RATE LIMIT STRATEGY

Spark should make minimal changes.

Instead of:

```text
delete/recreate entire schedule
```

prefer:

```text
modify only affected blocks
```

---

# 110. OBSERVABILITY WITHOUT TELEMETRY BLOAT

The system should retain enough operational metadata to debug failures.

It should not retain every internal agent action indefinitely.

Use:

```text
run summary
status
duration
error
correlation ID
```

instead of raw execution traces.

---

# 111. DATA RETENTION

Retention policies should eventually distinguish:

```text
canonical events
operational logs
sync jobs
agent runs
snapshots
```

Canonical study/history events may require long retention.

Temporary operational logs can have shorter retention.

Retention periods should be configurable.

---

# 112. ARCHIVAL

If event volume becomes large:

```text
hot operational state
+
historical archive
```

can be introduced.

Do not implement archival infrastructure until actual volume requires it.

---

# 113. SCALABILITY MODEL

The initial system is expected to operate at personal scale.

The architecture should nevertheless scale structurally through:

```text
stateless Worker
relational D1
queued asynchronous work
indexed queries
append-oriented events
provider adapters
semantic APIs
```

Scaling should happen only when measurements show a bottleneck.

---

# 114. PERSONAL-SCALE OPTIMIZATION

Optimize first for:

```text
correctness
simplicity
reliability
debuggability
```

not theoretical million-user throughput.

The system should not become an enterprise distributed architecture for one user.

---

# 115. FUTURE MULTI-USER POSSIBILITY

The domain model should still isolate data by:

```text
user_id
```

from the beginning.

Every user-owned entity should be traceable to an owner.

This makes future expansion possible without requiring an immediate multi-tenant architecture.

---

# 116. TENANCY BOUNDARY

All user-scoped queries should include:

```text
user_id
```

Authorization must verify that a client can access the requested user's state.

Never rely only on the caller supplying a correct user ID.

---

# 117. PROVIDER INDEPENDENCE

The domain model must avoid assumptions such as:

```text
Google task ID = internal task ID
Notion page ID = entity ID
Calendar event ID = session ID
```

Instead:

```text
internal entity ID
        ↕
external provider mapping
```

---

# 118. INTERNAL VS EXTERNAL IDENTIFIERS

Example:

```text
chapter_id = chap_01J...

Google task:
task_id = external-google-id

Notion:
page_id = external-notion-id
```

Relationships are explicit.

This prevents provider lock-in.

---

# 119. API CONTRACT OWNERSHIP

The Personal State Service owns:

```text
semantic API contract
```

Providers own:

```text
provider API contracts
```

AI clients should consume the semantic contract.

This isolates AI clients from provider-specific changes.

---

# 120. DOCUMENTATION STRUCTURE

The repository should contain:

```text
docs/
├── architecture/
│   ├── overview.md
│   ├── data-flow.md
│   ├── ownership.md
│   ├── consistency.md
│   └── security.md
│
├── domain/
│   ├── events.md
│   ├── entities.md
│   └── state.md
│
├── api/
│   ├── rest.md
│   └── mcp.md
│
├── integrations/
│   ├── google.md
│   ├── notion.md
│   ├── spark.md
│   ├── chatgpt.md
│   └── antigravity.md
│
├── operations/
│   ├── deployment.md
│   ├── recovery.md
│   └── troubleshooting.md
│
└── decisions/
    └── ADRs
```

---

# 121. ARCHITECTURE DECISION RECORDS

Important decisions should be recorded as ADRs.

Example:

```text
ADR-001
Use D1 as canonical machine state

ADR-002
Use events as immutable historical records

ADR-003
Use Notion as curated human memory

ADR-004
Do not depend on ChatGPT write capability

ADR-005
Use shared state instead of agent-to-agent coupling
```

Every major architectural change should explain:

```text
context
decision
reason
consequences
```

---

# 122. CHANGE MANAGEMENT

Before changing architecture:

```text
1. Identify problem
2. Verify current behavior
3. Determine whether existing architecture already solves it
4. Identify affected ownership boundaries
5. Evaluate alternatives
6. Record decision
7. Update contracts
8. Implement
9. Test
10. Update documentation
```

---

# 123. ARCHITECTURE REVIEW RULE

Every proposed feature must answer:

```text
Which existing system should own this?
```

If the answer is:

```text
Google
Notion
Spark
ChatGPT
Antigravity
```

use that system rather than building a duplicate.

Only introduce custom infrastructure when the existing systems cannot provide the required coordination behavior.

---

# 124. MINIMUM VIABLE CUSTOM LAYER

The custom system should ultimately consist of:

```text
Cloudflare Worker
       +
D1
       +
Personal State API
       +
Personal State MCP
       +
Event/State Engine
       +
Sync Queue
```

Everything else is an integration.

---

# 125. IMPLEMENTATION ORDER

The technical execution order is:

```text
Phase 0
Architecture contracts

        ↓

Phase 1
Repository + development environment

        ↓

Phase 2
D1 schema + migrations

        ↓

Phase 3
Domain model + event engine

        ↓

Phase 4
State projections

        ↓

Phase 5
REST API

        ↓

Phase 6
Authentication + authorization

        ↓

Phase 7
Idempotency + error/retry model

        ↓

Phase 8
MCP interface

        ↓

Phase 9
Queue + sync infrastructure

        ↓

Phase 10
Notion integration

        ↓

Phase 11
Google Tasks + Calendar integration

        ↓

Phase 12
Spark workflows

        ↓

Phase 13
Antigravity workflows

        ↓

Phase 14
ChatGPT state-aware workflow

        ↓

Phase 15
Observability + hardening

        ↓

Phase 16
Production rollout
```

---

# 126. PHASE 0: CONTRACT FREEZE

Before coding:

Define:

```text
entities
event types
event schemas
state transitions
ownership
API contracts
MCP contracts
error codes
idempotency semantics
```

Deliverables:

```text
domain specification
event specification
ownership matrix
API specification
MCP specification
architecture diagrams
ADR set
```

No integration should begin before these contracts are sufficiently stable.

---

# 127. PHASE 1: REPOSITORY FOUNDATION

Create:

```text
src/
├── domain/
├── events/
├── projections/
├── api/
├── mcp/
├── auth/
├── integrations/
├── sync/
├── workers/
└── infrastructure/

db/
├── schema/
└── migrations/

tests/
├── unit/
├── integration/
├── contract/
└── e2e/

docs/
```

The exact framework can be chosen during implementation, but the domain boundaries should remain.

---

# 128. PHASE 2: DATABASE FOUNDATION

Implement:

```text
schema
migrations
foreign keys
indexes
constraints
```

Run:

```text
migration tests
fresh database initialization
migration upgrade tests
```

---

# 129. PHASE 3: DOMAIN ENGINE

Implement:

```text
event creation
validation
entity resolution
command handling
event persistence
```

No Notion, Google, Spark, or ChatGPT dependency should exist in this layer.

This is the core of the system.

---

# 130. PHASE 4: PROJECTIONS

Implement:

```text
study_progress
daily_state
project_state
```

Each projection should have:

```text
event handlers
rebuild capability
tests
```

---

# 131. PHASE 5: REST API

Implement:

```text
authentication
authorization
validation
request IDs
correlation IDs
idempotency
error contract
```

Expose only semantic operations.

---

# 132. PHASE 6: SECURITY

Before exposing the API externally:

```text
authentication
authorization
secret storage
rate limiting
scope validation
audit logging
```

must be operational.

---

# 133. PHASE 7: RELIABILITY

Implement:

```text
idempotency
retry semantics
conflict detection
transaction boundaries
recovery
```

Test duplicate requests aggressively.

---

# 134. PHASE 8: MCP

Expose the semantic API through MCP.

Initial tools:

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

record_event
record_study_session
update_progress
complete_chapter
record_research
record_decision

get_sync_status
checkpoint
```

Avoid unnecessary tools.

---

# 135. PHASE 9: QUEUE

Introduce asynchronous processing.

Initial consumers:

```text
Notion synchronization
```

Future consumers can be added without changing the core event model.

---

# 136. PHASE 10: NOTION

First implement:

```text
read existing structure
map D1 entities
define page/database ownership
implement curated sync
implement retries
implement conflict handling
```

Only then enable automatic synchronization.

---

# 137. PHASE 11: GOOGLE

Implement:

```text
Task adapter
Calendar adapter
external ID mapping
task/calendar relationship
sync metadata
```

Google remains authoritative.

---

# 138. PHASE 12: SPARK

Create explicit scheduling workflows.

Each workflow must:

```text
retrieve current state
retrieve Tasks
retrieve Calendar
calculate
mutate minimally
record result
```

---

# 139. PHASE 13: ANTIGRAVITY

Provide:

```text
Personal State MCP
source registry
project state
checkpointing
Notion documentation
technical execution reporting
```

---

# 140. PHASE 14: CHATGPT

Enable:

```text
state retrieval
intent extraction
planning
structured action proposals
```

Do not make direct ChatGPT write access a prerequisite.

---

# 141. PHASE 15: HARDENING

Run:

```text
failure tests
load tests appropriate to personal scale
security review
migration tests
recovery tests
integration tests
MCP contract tests
```

Resolve all critical failure paths before production use.

---

# 142. PHASE 16: PRODUCTION ROLLOUT

Roll out gradually:

```text
D1
 ↓
API
 ↓
MCP
 ↓
Study events
 ↓
Notion
 ↓
Google
 ↓
Spark
 ↓
Antigravity
 ↓
ChatGPT state-aware workflows
```

Each stage must remain functional before the next integration is enabled.

---

# 143. FIRST PRODUCTION USE CASE

The first fully operational workflow should be:

```text
"Aaj Physics mein Current Electricity complete ki.
80 PYQ kiye.
67 correct."
```

Expected:

```text
Natural Language
 ↓
Intent
 ↓
Validation
 ↓
Event
 ↓
D1
 ↓
Progress projection
 ↓
Daily state
 ↓
Notion summary
```

This single workflow validates the architecture's central idea.

---

# 144. SECOND PRODUCTION USE CASE

```text
"Aaj schedule follow nahi hua."
```

Expected:

```text
Natural Language
 ↓
schedule_missed event
 ↓
D1
 ↓
Spark next execution
 ↓
Google Calendar/Tasks inspection
 ↓
minimal schedule adjustment
 ↓
schedule_adjusted event
```

---

# 145. THIRD PRODUCTION USE CASE

```text
PDF + syllabus
```

Expected:

```text
Antigravity
 ↓
source inspection
 ↓
TOC extraction
 ↓
syllabus mapping
 ↓
source registry
 ↓
D1
 ↓
Notion Study Library
```

---

# 146. FOURTH PRODUCTION USE CASE

```text
"Antigravity completed StudySourceCore Phase 2."
```

Expected:

```text
agent/project event
 ↓
D1
 ↓
project state
 ↓
curated Notion project update
```

---

# 147. DEFINITION OF DONE

The system should not be considered production-ready merely because:

```text
the Worker deploys
```

Production readiness requires:

```text
schema versioned
API versioned
MCP contract stable
authentication working
authorization working
idempotency working
events immutable
projections rebuildable
sync retryable
errors observable
secrets protected
migrations tested
provider failures recoverable
documentation complete
```

---

# 148. ARCHITECTURAL INVARIANTS

The following must remain true:

```text
D1 is not Notion.

Notion is not D1.

Google Tasks is not D1.

Google Calendar is not D1.

Spark is not D1.

ChatGPT is not the required write engine.

Antigravity is not the permanent database.

No AI agent is required to directly call another AI agent.
```

---

# 149. FUTURE-PROOFING STRATEGY

Future-proofing must come from stable boundaries, not speculative infrastructure.

The stable boundaries are:

```text
Domain Model
Event Contract
State API
MCP Contract
Provider Adapters
Sync Queue
```

If a future AI platform replaces Spark:

```text
new scheduling client
       ↓
Personal State Service
```

If Notion is replaced:

```text
new human-memory adapter
       ↓
Personal State Service
```

If ChatGPT gains write capability:

```text
ChatGPT
       ↓
same Personal State Service
```

If another AI client appears:

```text
New AI
       ↓
MCP/API
```

No core rewrite should be required.

---

# 150. SCALABILITY STRATEGY

The architecture should scale in this order:

```text
Optimize queries
      ↓
Add indexes
      ↓
Optimize projections
      ↓
Batch external writes
      ↓
Use queue processing
      ↓
Archive old operational data
      ↓
Introduce advanced search only if required
```

Do not begin with:

```text
microservices
Kafka
Kubernetes
vector databases
distributed workflow engines
```

unless actual system requirements demand them.

---

# 151. MAINTAINABILITY STRATEGY

Maintainability depends on:

```text
small domain
small API
small MCP surface
clear ownership
versioned contracts
automated tests
documented decisions
provider isolation
```

The most dangerous architectural smell is:

```text
"Everyone can modify everything."
```

The system must prevent this structurally.

---

# 152. TECHNICAL GOLDEN RULE

Whenever adding a feature:

```text
1. Identify the owner.
2. Identify the canonical data.
3. Identify the event.
4. Identify the derived state.
5. Identify downstream consequences.
6. Identify failure modes.
7. Identify idempotency.
8. Identify security scope.
9. Identify test coverage.
10. Identify whether an existing platform already solves it.
```

Only then implement.

---

# 153. FINAL TECHNICAL ARCHITECTURE

```text
                                  USER
                                    │
             ┌──────────────────────┼──────────────────────┐
             │                      │                      │
             ▼                      ▼                      ▼
          ChatGPT              Antigravity              Spark
           THINK                 BUILD                    ACT
             │                      │                      │
             │                      │                      ├── Google Tasks
             │                      │                      └── Google Calendar
             │                      │
             └──────────────────────┼──────────────────────┐
                                    │                      │
                                    ▼                      │
                         PERSONAL STATE SERVICE             │
                              REST + MCP                   │
                                    │                      │
                    ┌───────────────┼───────────────┐      │
                    │               │               │      │
                    ▼               ▼               ▼      │
                 Auth           Domain Engine    Validation │
                                    │                      │
                                    ▼                      │
                              Canonical Events              │
                                    │                      │
                                    ▼                      │
                                   D1                      │
                          ┌─────────┼─────────┐             │
                          ▼         ▼         ▼             │
                       Events    Progress   State           │
                          │         │         │             │
                          └─────────┼─────────┘             │
                                    ▼                       │
                                Queue                       │
                                    │                       │
                                    ▼                       │
                             Notion Sync                    │
                                    │                       │
                                    ▼                       │
                                 NOTION                     │
                                                            │
                     Spark reads current state ◄────────────┘
```

---

# 154. FINAL DATA FLOW

```text
                    NATURAL LANGUAGE
                           │
                           ▼
                    INTENT EXTRACTION
                           │
                           ▼
                    ENTITY RESOLUTION
                           │
                           ▼
                     VALIDATION
                           │
                           ▼
                       COMMAND
                           │
                           ▼
                  CANONICAL EVENT
                           │
                           ▼
                      D1 EVENT LOG
                           │
                 ┌─────────┼─────────┐
                 ▼         ▼         ▼
             Progress   Daily State  History
                 │         │         │
                 └─────────┼─────────┘
                           │
                ┌──────────┼───────────┐
                ▼          ▼           ▼
             Spark      Notion      Agent Context
                │          │           │
                ▼          ▼           ▼
            Calendar     Human       Technical
            / Tasks      Memory      Execution
```

---

# 155. FINAL SYSTEM CHARACTER

The finished Personal AI Study OS should behave as:

```text
A small state engine
+
a semantic API
+
an MCP interface
+
a reliable synchronization layer
```

It should not feel like another application that must be operated.

The intended interaction remains:

```text
User speaks naturally.
```

The system handles:

```text
capture
→ normalize
→ validate
→ store
→ derive
→ synchronize
→ schedule
→ remember
```

The technical architecture exists to make that experience reliable, recoverable, maintainable, and extensible without forcing the user to manage the machinery underneath it.
