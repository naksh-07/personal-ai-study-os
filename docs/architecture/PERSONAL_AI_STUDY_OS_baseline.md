# PERSONAL AI STUDY OS

## 1. Purpose

Personal AI Study OS is a lightweight coordination layer that connects ChatGPT, Gemini Spark, Google Tasks, Google Calendar, Notion, Antigravity, and Cloudflare D1 without replacing the capabilities already provided by those systems.

The system converts natural-language activity and agent actions into structured, auditable state and events, then uses that state to improve planning, scheduling, memory, study tracking, and technical workflows.

The architecture is based on six fixed responsibilities:

> **Google manages your commitments.**
> **Spark manages your schedule.**
> **Notion remembers what matters to you.**
> **D1 remembers what machines need to know.**
> **ChatGPT helps you think.**
> **Antigravity gets technical work done.**

The custom infrastructure exists only to connect these responsibilities.

---

# 2. Architectural Principles

The implementation must preserve the following principles:

1. **Shared state over direct agent coupling**
2. **Event-first state mutation**
3. **Google Tasks remains authoritative for task completion**
4. **Google Calendar remains authoritative for time allocation**
5. **Notion remains human-facing**
6. **D1 remains machine-facing**
7. **Spark remains the scheduling engine**
8. **ChatGPT remains primarily a reasoning and intent-generation layer**
9. **Antigravity remains the technical execution and source-ingestion layer**
10. **ChatGPT write access must never be a required dependency**
11. **PC availability must not be required for persistent cloud state**
12. **Every important mutation must be idempotent and auditable**
13. **Historical events must not be silently overwritten**
14. **New infrastructure must solve a demonstrated problem**
15. **The smallest viable architecture is preferred**

---

# 3. System Architecture

```text
                                  USER
                                    │
                 ┌──────────────────┼──────────────────┐
                 │                  │                  │
                 ▼                  ▼                  ▼
             ChatGPT           Antigravity        Gemini Spark
             THINK               BUILD               ACT
                 │                  │                  │
                 │                  │                  ├── Google Tasks
                 │                  │                  └── Google Calendar
                 │                  │
                 └──────────────┬───┘
                                │
                                ▼
                     PERSONAL STATE SERVICE
                         REST + MCP
                                │
                                ▼
                       CLOUDFLARE WORKER
                                │
                                ▼
                              D1
                                │
             ┌──────────────────┼──────────────────┐
             │                  │                  │
             ▼                  ▼                  ▼
        Study State        Event History       Agent State
             │                  │                  │
             └──────────────────┼──────────────────┘
                                │
                         Derived / Curated
                                │
                                ▼
                           Sync Queue
                                │
                                ▼
                             NOTION
                                │
             ┌──────────────────┼──────────────────┐
             ▼                  ▼                  ▼
          Study              Knowledge          Projects
          History             & Research         & Decisions
```

The agents do not require direct communication with one another.

The Personal State Service is the shared coordination surface.

---

# 4. Responsibility and Ownership Model

| System          | Primary responsibility     | Authoritative data                                   |
| --------------- | -------------------------- | ---------------------------------------------------- |
| Google Tasks    | Action management          | Tasks, completion state                              |
| Google Calendar | Time management            | Events, time blocks, commitments                     |
| Gemini Spark    | Scheduling                 | Scheduling decisions and execution                   |
| Notion          | Human memory and knowledge | Notes, research, curated history, decisions          |
| Cloudflare D1   | Machine state              | Events, progress, relationships, sync state          |
| ChatGPT         | Thinking                   | Plans, reasoning, structured intent                  |
| Antigravity     | Technical execution        | Source ingestion, repositories, technical operations |

No subsystem should become authoritative for another subsystem's domain without an explicit architectural change.

---

# 5. Core Data Planes

The system uses two primary information planes.

## 5.1 Machine State Plane

Hosted in D1.

Contains:

* Current study state
* Historical events
* Study sessions
* Chapter progress
* Source metadata
* Task relationships
* Calendar relationships
* Agent executions
* Research events
* Project state
* Synchronization state
* Idempotency records
* Checkpoints

Optimized for:

* querying
* automation
* agents
* consistency
* structured reasoning
* state reconstruction

---

## 5.2 Human Memory Plane

Hosted in Notion.

Contains:

* curated study history
* notes
* research
* decisions
* study-source library
* revision information
* weak areas
* project documentation
* meaningful AI activity
* daily summaries

Optimized for:

* reading
* reviewing
* understanding
* long-term reference
* human navigation

Raw telemetry does not belong here.

---

# 6. Personal State Service

The Personal State Service is the central custom component.

It is implemented as a Cloudflare Worker exposing:

```text
REST API
+
Remote MCP
```

The service is intentionally small.

It is not an application framework, task manager, calendar, or replacement for Notion.

Its responsibility is to provide a stable interface over the canonical machine state.

---

# 7. API Architecture

## 7.1 Read API

Initial endpoints:

```text
GET /state/today
GET /state/study
GET /state/subjects/:subject
GET /state/chapters/:chapter
GET /state/activity/recent
GET /state/work/pending
GET /state/schedule/context
GET /state/projects/:project
GET /memory/search
GET /sync/status
```

---

## 7.2 Mutation API

Initial endpoints:

```text
POST /events
POST /study/sessions
POST /study/progress
POST /study/chapters/:chapter/complete
POST /research
POST /decisions
POST /projects/events
POST /links/tasks
POST /links/calendar
```

Mutation endpoints must:

* validate input
* authenticate the caller
* generate or validate an idempotency key
* write the canonical event
* update derived state
* enqueue required downstream synchronization
* return a stable result
* never silently duplicate an event

---

# 8. Personal State MCP

The MCP interface exposes a smaller surface than the REST API.

## 8.1 Read Tools

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

## 8.2 Mutation Tools

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

## 8.3 System Tools

```text
checkpoint
```

The MCP should not expose every database operation.

Agents should interact with semantic operations rather than raw SQL-like primitives.

---

# 9. Canonical Event Model

All meaningful state-changing activity should first become a canonical event.

Example:

```json
{
  "event_id": "evt_01...",
  "event_type": "study_completed",
  "occurred_at": "2026-09-10T20:30:00+05:30",
  "subject_id": "physics",
  "chapter_id": "current-electricity",
  "payload": {
    "activity": "PYQ",
    "total_questions": 80,
    "correct": 67,
    "accuracy": 0.8375
  },
  "source": {
    "system": "chatgpt",
    "actor": "user"
  }
}
```

The event is immutable.

Derived state can change.

The original event remains available for audit and reconstruction.

---

# 10. Event Types

The initial event taxonomy should include:

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

The taxonomy should remain extensible.

New event types should only be introduced when an existing type cannot represent the required semantics cleanly.

---

# 11. Event Lifecycle

Every meaningful natural-language statement follows:

```text
Natural Language
       ↓
Intent / Event Extraction
       ↓
Validation
       ↓
Canonical Event
       ↓
Idempotency Check
       ↓
D1 Event Store
       ↓
Derived State Projection
       ↓
Downstream Consequences
       ├── Notion
       ├── Scheduling
       └── Task relationships
```

The original event is never replaced by the derived representation.

---

# 12. Natural Language Interface

The user should never need to know the database schema.

Examples:

```text
"Aaj Current Electricity nipta diya."

"Magnetism ke 80 PYQ kiye, 67 sahi hue."

"Aaj schedule follow nahi hua."

"Aaj 4 ghante Physics aur 2 ghante Maths padha."

"Ye chapter complete ho gaya."

"Antigravity ne StudySourceCore Phase 2 complete kar diya."
```

The system extracts:

```text
what happened
when it happened
what entity it affected
what result occurred
what state changed
whether a scheduling consequence exists
whether the information belongs in human-facing memory
```

---

# 13. Event Validation

Before mutation, the service validates:

### Required fields

* event type
* event timestamp
* source
* entity reference where applicable
* payload according to event type

### Semantic validation

Examples:

```text
correct <= total_questions
accuracy = correct / total_questions
completion cannot reference an unknown chapter
study session must have a valid time range
task links must reference known external IDs
```

### Ambiguity

If an event cannot safely be interpreted, the system should not invent missing information.

It should preserve the unresolved intent or request clarification through the originating AI.

---

# 14. D1 Schema

The initial relational schema should be:

```text
users
subjects
chapters

sources
source_chapters
source_mappings

study_events
study_sessions
study_progress

tasks
calendar_events
schedule_links

activity_events
agent_runs
research_events
project_events

memory_facts
memory_versions

daily_state
state_snapshots

sync_jobs
idempotency_keys

checkpoints
```

---

# 15. Core Tables

## users

```text
id
created_at
updated_at
timezone
status
```

---

## subjects

```text
id
name
slug
description
status
created_at
updated_at
```

---

## chapters

```text
id
subject_id
name
slug
parent_id
status
progress
created_at
updated_at
```

The hierarchy must support:

```text
Subject
 └── Unit
      └── Chapter
           └── Topic
```

where required.

---

# 16. Study Events

```text
id
event_type
occurred_at
subject_id
chapter_id
session_id
payload_json
source_system
source_actor
created_at
```

Indexes:

```text
occurred_at
subject_id
chapter_id
event_type
session_id
```

The payload should remain flexible enough for different study event types while core queryable dimensions remain normalized.

---

# 17. Study Sessions

```text
id
subject_id
chapter_id
started_at
ended_at
duration_seconds
activity_type
source
status
created_at
updated_at
```

A session represents an aggregated meaningful activity period.

It should not create one database row for every application heartbeat.

---

# 18. Study Progress

```text
id
subject_id
chapter_id
status
progress_percent
confidence
last_studied_at
last_completed_at
questions_attempted
questions_correct
accuracy
updated_at
```

Progress is derived from events where practical.

Important historical facts should remain reconstructable from the event store.

---

# 19. Task and Calendar Relationships

The system does not duplicate Google Tasks or Calendar.

It stores only the identifiers and relationships required for coordination.

## tasks

```text
id
external_task_id
provider
title_snapshot
status_snapshot
last_synced_at
created_at
updated_at
```

## calendar_events

```text
id
external_event_id
provider
title_snapshot
starts_at
ends_at
status_snapshot
last_synced_at
created_at
updated_at
```

## schedule_links

```text
id
task_id
calendar_event_id
relationship_type
created_at
updated_at
```

The external Google systems remain authoritative.

D1 stores the relationship and synchronization context.

---

# 20. Source Registry

Antigravity should register source metadata rather than copy entire books into D1.

## sources

```text
id
title
source_type
author
publisher
edition
reference_uri
status
created_at
updated_at
```

## source_chapters

```text
id
source_id
title
chapter_number
location_reference
parent_id
created_at
updated_at
```

## source_mappings

```text
id
source_chapter_id
subject_id
chapter_id
mapping_type
relevance
confidence
notes
created_at
updated_at
```

The registry answers:

```text
Which source?
Which chapter?
Where?
Relevant to which syllabus entity?
How relevant?
How confidently mapped?
```

It does not become a textbook database.

---

# 21. Agent State

## agent_runs

```text
id
agent
run_type
started_at
completed_at
status
result_summary
error_code
metadata_json
created_at
```

Internal reasoning traces are not stored.

Only operational metadata and meaningful outcomes are retained.

Example:

```text
agent = antigravity
run_type = source_ingestion
status = completed
result_summary = "Mapped 18 relevant chapters"
```

---

# 22. Memory Model

Three information classes must remain separate.

## Operational State

```text
Current chapter progress
Pending work
Current task
Today's study state
Current schedule context
```

## Historical Events

```text
Study sessions
Completed chapters
Research events
Project events
Agent runs
Decisions
```

## Long-Term Memory

```text
Stable preferences
Durable conventions
Important recurring patterns
Long-lived decisions
```

Memory mutations use:

```text
ADD
UPDATE
DELETE / INVALIDATE
NONE
```

Important temporal facts should support:

```text
valid_at
invalid_at
```

where historical validity matters.

---

# 23. Memory Rules

The system must not automatically turn every conversation statement into long-term memory.

A candidate memory should pass:

```text
durability
usefulness
specificity
confidence
```

Examples that may qualify:

```text
stable study convention
stable project architecture decision
durable workflow preference
important recurring constraint
```

Examples that normally should not:

```text
temporary mood
one-off task
single study session
random conversation detail
temporary plan
```

Study events remain events even when they do not become long-term memory.

---

# 24. Daily State

D1 should maintain a compact projection for rapid agent queries.

Example:

```text
daily_state

date
study_minutes
completed_chapters
questions_attempted
questions_correct
accuracy
missed_sessions
completed_tasks
pending_tasks
major_events
updated_at
```

This avoids repeatedly reconstructing the entire event history for common daily queries.

The projection can be rebuilt from canonical events if necessary.

---

# 25. State Snapshots

Periodic snapshots provide recovery and efficient historical inspection.

```text
state_snapshots

id
snapshot_type
created_at
state_json
schema_version
```

Snapshots are derived artifacts.

They do not replace the canonical event history.

---

# 26. Idempotency

Every external mutation must be safely repeatable.

Each mutation receives an idempotency key.

## idempotency_keys

```text
key
operation
source_system
request_hash
result_hash
created_at
expires_at
```

If the same operation is received again:

```text
same key
+
same request
=
return previous result
```

If the same key is reused for a different request:

```text
reject
```

This is mandatory for:

* retries
* Spark scheduled executions
* network failures
* MCP retries
* Notion synchronization
* agent recovery

---

# 27. Notion Architecture

Notion should be structured around human usefulness.

```text
PERSONAL OS
│
├── Study
│   ├── Subjects
│   ├── Chapters
│   ├── Study Log
│   ├── Revision
│   └── Weak Areas
│
├── Knowledge
│   ├── Notes
│   ├── Research
│   └── Decisions
│
├── Study Library
│
├── Daily Journal
│
├── Projects
│
└── AI Activity
```

---

# 28. Notion Synchronization

Notion is not the immediate destination for every event.

The pipeline is:

```text
D1 Event
   ↓
Derived state
   ↓
Aggregation
   ↓
Curated representation
   ↓
Sync Queue
   ↓
Notion
```

Examples:

Ten internal activity events:

```text
09:00 started Physics
09:05 active
09:10 active
09:15 active
...
```

should become:

```text
Physics
09:00–10:23
2h 14m
```

in the human-facing layer.

---

# 29. Sync Queue

## sync_jobs

```text
id
target
entity_type
entity_id
operation
payload_json
status
attempt_count
next_attempt_at
last_error
created_at
completed_at
```

States:

```text
pending
processing
completed
failed
dead_letter
```

Retry strategy should use bounded exponential backoff.

Permanent failures should remain visible for recovery.

---

# 30. Notion Conflict Strategy

D1 should not blindly overwrite human-edited Notion content.

Each synchronized object must have a defined ownership model.

### Machine-owned fields

Safe to update automatically.

### Human-owned fields

Must not be overwritten.

### Derived fields

May be regenerated.

### Mixed fields

Require explicit merge rules.

The first implementation should minimize mixed-ownership fields.

---

# 31. Google Tasks Architecture

Google Tasks remains the system of record for:

```text
what needs to be done
what is pending
what is completed
```

D1 stores only:

```text
external ID
relationship
cached metadata
event linkage
sync status
```

The system must not create a parallel task list.

---

# 32. Google Calendar Architecture

Google Calendar remains the system of record for:

```text
when work happens
time blocks
study sessions
hard commitments
real-world schedule
```

Calendar events may contain:

```text
TaskID: <external-task-id>
```

when a task-to-session relationship exists.

The system must not build a replacement calendar.

---

# 33. Spark Architecture

Spark is the scheduling and maintenance worker.

A scheduled Spark workflow should explicitly retrieve current state.

It must not rely on previous scheduled execution context.

Core workflow:

```text
1. Read Personal State
2. Read Google Tasks
3. Read Google Calendar
4. Determine completed work
5. Determine pending work
6. Detect missed sessions
7. Detect conflicts
8. Calculate minimal adjustment
9. Update Calendar/Tasks
10. Record scheduling result
```

---

# 34. Spark Scheduling Rules

Spark should prefer minimal schedule changes.

Priority order:

```text
1. Preserve hard commitments
2. Preserve already-completed work
3. Preserve existing valid study blocks
4. Recover missed work where practical
5. Protect important deep-work blocks
6. Avoid unnecessary rescheduling
7. Never erase historical information
```

A missed study block should not cause uncontrolled schedule cascades.

---

# 35. Spark State Awareness

Every scheduled Spark workflow should begin with current-state retrieval.

Conceptually:

```text
CURRENT STATE
+
TASK STATE
+
CALENDAR STATE
+
SCHEDULING RULES
=
CURRENT DECISION
```

Spark's persistent role is the scheduling process, not permanent memory.

---

# 36. Antigravity Architecture

Antigravity is responsible for:

```text
source ingestion
technical execution
coding
repository operations
D1 operations
Notion documentation
GitHub workflows
structured extraction
agent/subagent execution
```

Its central integration surface is:

```text
Personal State MCP
```

supplemented by:

```text
Cloudflare tooling
Notion MCP
GitHub
Filesystem
```

where required.

---

# 37. Study Source Ingestion Workflow

Input:

```text
Book / PDF / Source
+
Official Syllabus
```

Pipeline:

```text
Source
 ↓
Inspect metadata
 ↓
Extract TOC / index
 ↓
Understand hierarchy
 ↓
Parse syllabus structure
 ↓
Map source chapters to syllabus
 ↓
Identify relevant sections
 ↓
Assign relevance/confidence
 ↓
Register source in D1
 ↓
Update Notion Study Library
 ↓
Preserve source references
```

Do not store the complete source content inside D1 merely for convenience.

---

# 38. Study Library Representation

Notion should provide a human-readable view such as:

```text
Physics

Source: Reference Book X

Relevant chapters

✓ Current Electricity
  Pages 120–158
  Syllabus relevance: High

✓ Magnetism
  Pages 201–245
  Syllabus relevance: High

△ Electromagnetic Waves
  Pages 300–315
  Syllabus relevance: Partial
```

D1 stores the structured equivalent.

---

# 39. ChatGPT Architecture

ChatGPT remains the reasoning layer.

Primary capabilities:

```text
research
planning
reasoning
architecture
prompt distillation
natural-language interpretation
structured intent generation
state-aware planning
```

ChatGPT should not be required to have autonomous write access.

The architecture must remain valid if ChatGPT can only:

```text
read
reason
generate structured intent
```

Future write capabilities may be added as an optional execution path.

They must not require architectural changes.

---

# 40. ChatGPT Interaction Model

Example:

```text
User
  ↓
ChatGPT
  ↓
Understand statement
  ↓
Retrieve relevant state
  ↓
Reason
  ↓
Generate structured intent
  ↓
Approved execution path
  ↓
Personal State Service
```

Where direct mutation is unavailable:

```text
ChatGPT
  ↓
Structured action proposal
  ↓
Execution-capable client
  ↓
Personal State Service
```

The system therefore separates:

```text
INTENT
```

from:

```text
MUTATION
```

---

# 41. Shared-State Coordination

No mandatory direct agent chain should exist.

Avoid:

```text
ChatGPT → Spark → Antigravity → Notion
```

Prefer:

```text
ChatGPT ───────┐
Spark ─────────┤
Antigravity ───┼──→ Personal State
               │
Notion Sync ───┘
```

Each system reads the state it needs and writes only what it owns.

This minimizes coupling and makes individual systems replaceable.

---

# 42. Example End-to-End Study Event

User says:

> "Magnetism ke 80 PYQ kiye, 63 sahi hue."

ChatGPT or another capable client extracts:

```json
{
  "event_type": "questions_attempted",
  "subject": "Physics",
  "chapter": "Magnetism",
  "total_questions": 80,
  "correct": 63,
  "accuracy": 0.7875
}
```

Personal State Service:

```text
validate
→ idempotency check
→ store event
→ update progress
→ update daily state
→ determine downstream actions
```

D1 becomes:

```text
Magnetism
questions_attempted = 80
questions_correct = 63
accuracy = 78.75%
```

Notion may later receive:

```text
Magnetism
80 PYQs
63 correct
78.75% accuracy
```

Spark can use the updated state during its next scheduling run.

---

# 43. Example Missed Schedule

User says:

> "Aaj schedule follow nahi hua."

The system records:

```text
schedule_missed
```

with relevant calendar/session references.

Spark later evaluates:

```text
What was missed?
What remains important?
What is already scheduled?
What hard commitments exist?
```

Then it performs only the necessary schedule adjustments.

Historical schedule information remains intact.

---

# 44. Example Project Event

User says:

> "Antigravity ne StudySourceCore ka Phase 2 complete kar diya."

The system records:

```text
project_completed
```

or:

```text
project_updated
```

depending on the project state.

D1 stores:

```text
project
phase
status
actor
timestamp
result
```

Notion may receive a curated project update.

No internal Antigravity execution trace is copied into Notion.

---

# 45. Authentication

The Personal State Service requires authenticated access.

Initial architecture:

```text
AI / client
   ↓
authenticated request
   ↓
Cloudflare Worker
   ↓
authorization
   ↓
operation
```

Authentication must identify:

```text
user
client
permission scope
request
```

Authorization must distinguish:

```text
read
write
destructive
administrative
```

---

# 46. Permission Model

## Read

Examples:

```text
get_today_state
get_progress
search_memory
get_schedule_context
```

Low-risk.

## Write

Examples:

```text
record_event
update_progress
record_session
```

Authenticated clients only.

## External mutation

Examples:

```text
modify Calendar
modify Tasks
update Notion
```

Must have explicit integration permissions.

## High-risk operations

Examples:

```text
delete state
mass calendar mutation
bulk deletion
deployment
external communication
```

Require stronger approval controls.

---

# 47. Secret Management

Secrets must never be stored in:

```text
D1 payloads
Notion
event logs
Git
MCP responses
agent prompts
```

Use Cloudflare secrets/environment configuration for:

```text
OAuth credentials
API tokens
Notion credentials
Google credentials
MCP authentication secrets
```

Rotate credentials without requiring schema changes.

---

# 48. Error Handling

Every operation should classify failures.

```text
validation_error
authentication_error
authorization_error
conflict_error
external_provider_error
rate_limit_error
temporary_error
internal_error
```

Responses should include stable error codes.

Transient failures should be retryable.

Permanent failures should not be endlessly retried.

---

# 49. Recovery

The system must support reconstruction through:

```text
canonical events
+
state projections
+
snapshots
+
sync jobs
```

If a derived table becomes corrupted:

```text
events
 ↓
rebuild projection
 ↓
restore state
```

If a Notion sync fails:

```text
D1 remains authoritative for machine state
sync job remains pending/failed
retry later
```

External system failure must not destroy canonical history.

---

# 50. Observability

The system should provide:

```text
sync status
recent errors
agent run status
event ingestion status
queue status
last successful sync
last failed operation
```

A minimal diagnostic endpoint:

```text
GET /sync/status
```

should expose enough information to diagnose failures without leaking secrets.

---

# 51. Auditability

Important mutations should record:

```text
who
what
when
from where
affected entity
result
```

Example:

```text
source_system = spark
actor = scheduled_job
event_type = schedule_adjusted
occurred_at = ...
```

The audit trail should be machine-readable.

Notion receives only meaningful human-facing summaries.

---

# 52. Search Strategy

Initial search:

```text
SQLite / D1 relational queries
+
FTS5 where supported
```

Do not introduce vector infrastructure in the first implementation.

Semantic embeddings should only be added if real search requirements demonstrate that SQL/FTS cannot solve the problem.

Potential future architecture:

```text
D1 relational state
+
FTS
+
optional vector index
```

The vector layer must remain secondary to canonical structured state.

---

# 53. Activity Aggregation

If activity telemetry is introduced, raw heartbeats should be aggregated.

Instead of:

```text
09:00 active
09:05 active
09:10 active
09:15 active
```

store:

```text
Physics
09:00–10:23
```

The same principle applies to agent activity.

D1 may retain concise execution metadata.

Notion should receive only the meaningful result.

---

# 54. Deployment Architecture

Initial cloud deployment:

```text
Cloudflare Worker
       │
       ├── REST API
       ├── MCP endpoint
       └── scheduled/maintenance handlers
       │
       ▼
      D1
       │
       └── Queue
             │
             ▼
        Notion synchronization
```

Optional:

```text
Cron
```

may be introduced only where Worker-side scheduled processing is genuinely useful.

Spark remains the primary scheduling intelligence for user schedule management.

---

# 55. Local Development Architecture

Recommended:

```text
Repository
│
├── worker/
├── src/
│   ├── api/
│   ├── mcp/
│   ├── domain/
│   ├── events/
│   ├── projections/
│   ├── sync/
│   ├── integrations/
│   └── auth/
│
├── db/
│   ├── migrations/
│   └── schema/
│
├── tests/
│
└── docs/
```

The domain layer should remain independent of specific AI clients.

---

# 56. Domain Layer

Core domain concepts:

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

The domain layer should not contain provider-specific logic where avoidable.

For example:

```text
record_task_link()
```

should operate on the domain model.

Google-specific API handling belongs in an integration adapter.

---

# 57. Integration Layer

Provider-specific modules:

```text
GoogleTasksAdapter
GoogleCalendarAdapter
NotionAdapter
SparkIntegration
ChatGPTIntegration
AntigravityIntegration
```

Each adapter should translate external representations into the internal canonical model.

This allows providers to change without rewriting the domain layer.

---

# 58. Testing Strategy

Testing must occur at multiple levels.

## Unit Tests

Test:

```text
event validation
progress calculations
accuracy calculations
memory mutation
idempotency
state projection
schedule rules
source mapping
```

## Integration Tests

Test:

```text
Worker → D1
Worker → Queue
Worker → Notion
MCP → Worker
Google adapters
```

## Contract Tests

Verify:

```text
MCP tool schemas
REST response schemas
event schemas
database migrations
external ID handling
```

## Recovery Tests

Simulate:

```text
duplicate request
network retry
Notion failure
Google failure
partial sync
worker restart
projection rebuild
```

---

# 59. Acceptance Criteria

The MVP is successful when the following workflows work reliably.

### Study completion

```text
Natural language
→ event
→ D1
→ progress
→ daily state
→ curated Notion record
```

### Question performance

```text
80 attempted
67 correct
→ 83.75%
→ chapter performance updated
```

### Schedule miss

```text
missed session
→ event
→ Spark sees it
→ minimal rescheduling
```

### Task/session relationship

```text
Google Task
↔ Calendar Event
↔ D1 relationship
```

### Source ingestion

```text
PDF + syllabus
→ mapped source
→ D1 registry
→ Notion Study Library
```

### Agent completion

```text
Antigravity execution
→ project event
→ D1
→ curated Notion update
```

---

# 60. MVP Scope

The minimum implementation should contain:

```text
Cloudflare Worker
D1
REST API
Remote MCP
Canonical event model
Study progress model
Idempotency
Basic authentication
Notion sync queue
Google Task/Calendar relationship model
Basic Spark workflow
Antigravity source registry workflow
Basic ChatGPT structured-intent workflow
Observability
Tests
```

The MVP does not require:

```text
vector database
advanced autonomous memory
custom frontend
replacement task manager
replacement calendar
full textbook storage
complex multi-agent orchestration
distributed workflow engine
```

---

# 61. Implementation Phases

## Phase 0 — Contract Freeze

Define and freeze:

```text
event taxonomy
entity model
completion semantics
session semantics
memory semantics
task semantics
calendar relationship semantics
source model
ownership rules
```

Deliverables:

```text
event specification
domain specification
ownership matrix
API draft
```

---

## Phase 1 — D1 Foundation

Implement:

```text
schema
migrations
indexes
canonical events
study progress
sessions
task/calendar links
source registry
agent state
idempotency
```

Deliverables:

```text
working D1
migration system
projection tests
event validation tests
```

---

## Phase 2 — Personal State API

Implement:

```text
read state
read study state
read chapter
read activity
read pending work

record event
record session
update progress
complete chapter
```

Deliverables:

```text
REST API
authentication
validation
error model
idempotency
```

---

## Phase 3 — Personal State MCP

Expose:

```text
get_today_state
get_study_state
get_chapter_state
get_recent_activity
get_pending_work
get_schedule_context
search_memory
record_event
record_study_session
update_progress
complete_chapter
get_sync_status
```

Keep the tool surface intentionally small.

---

## Phase 4 — Notion Sync

Implement:

```text
sync queue
aggregation
daily summaries
study history
chapter progress
AI activity
study library
```

Establish ownership rules before enabling automatic writes.

---

## Phase 5 — Google Integration

Implement:

```text
Task IDs
Calendar IDs
Task/calendar relationships
completion linkage
schedule references
```

Do not duplicate task or calendar records beyond the minimum coordination metadata.

---

## Phase 6 — Spark Integration

Implement Spark workflows for:

```text
daily state inspection
task inspection
calendar inspection
missed-session detection
conflict detection
minimal schedule adjustment
schedule event recording
```

Spark should always inspect current state before making decisions.

---

## Phase 7 — Antigravity Integration

Implement:

```text
Personal State MCP access
source registration
syllabus mapping
source metadata extraction
Notion Study Library updates
project event reporting
technical execution state
```

---

## Phase 8 — ChatGPT Integration

Implement according to currently available capabilities:

```text
state reading
natural-language interpretation
structured intent generation
planning
```

If direct writes are unavailable:

```text
ChatGPT
→ structured intent
→ execution-capable client
→ Personal State Service
```

No architectural dependency on autonomous ChatGPT writes.

---

## Phase 9 — Reliability Hardening

Validate:

```text
idempotency
retries
authentication
authorization
sync recovery
projection rebuilding
rate limits
provider failures
auditability
observability
```

---

# 62. Rollout Strategy

Do not activate every integration simultaneously.

Recommended rollout:

```text
D1
 ↓
REST
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

Each phase should be independently testable.

A failure in a later integration must not compromise the already-working state layer.

---

# 63. Operational Rules

The following rules are permanent unless the architecture is explicitly revised.

### Rule 1

Google Tasks owns task completion.

### Rule 2

Google Calendar owns temporal allocation.

### Rule 3

Spark owns schedule adjustment.

### Rule 4

Notion owns human-readable memory and knowledge.

### Rule 5

D1 owns machine-readable state and canonical events.

### Rule 6

ChatGPT owns reasoning and planning.

### Rule 7

Antigravity owns technical execution and source ingestion.

### Rule 8

The Personal State Service owns cross-system state coordination.

### Rule 9

Canonical events are immutable.

### Rule 10

Derived state may be rebuilt.

### Rule 11

Notion receives curated information, not raw telemetry.

### Rule 12

The complete contents of external study sources are not copied into D1 without a demonstrated requirement.

### Rule 13

No AI client is required to directly communicate with another AI client.

### Rule 14

No AI client's write capability is a mandatory architectural dependency unless explicitly verified and incorporated as an optional execution path.

### Rule 15

Every architectural expansion must have a concrete operational reason.

---

# 64. Future Extensions

Only after the core system proves useful should the following be considered:

```text
advanced memory retrieval
semantic search
vector indexing
automatic weakness detection
adaptive revision generation
cross-project intelligence
richer study analytics
activity telemetry
additional AI clients
automatic source recommendation
advanced scheduling heuristics
```

These are extensions, not MVP dependencies.

---

# 65. Final Architecture

```text
                                   USER
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
              ▼                      ▼                      ▼
          ChatGPT              Antigravity             Spark
           THINK                  BUILD                  ACT
              │                      │                      │
              │                      │                      ├──── Google Tasks
              │                      │                      └──── Google Calendar
              │                      │
              └──────────────────────┼──────────────────────┐
                                     │                      │
                                     ▼                      │
                          PERSONAL STATE SERVICE             │
                              REST + MCP                    │
                                     │                      │
                                     ▼                      │
                              CLOUDFLARE WORKER             │
                                     │                      │
                                     ▼                      │
                                    D1                      │
                                     │                      │
             ┌───────────────────────┼──────────────────────┘
             │                       │
             ▼                       ▼
       Canonical Events        Derived State
             │                       │
             └──────────────┬────────┘
                            ▼
                       Sync Queue
                            │
                            ▼
                         NOTION
                            │
               ┌────────────┼────────────┐
               ▼            ▼            ▼
             Study       Knowledge     Projects
             Memory       Research      Decisions
```

The custom system remains deliberately small:

```text
Personal State Service
        +
D1
        +
Event/State Model
        +
Sync Layer
```

Everything else continues doing the job it already does well.

The resulting operating model is:

```text
USER
 ↓
Natural language
 ↓
Intent / Event
 ↓
Personal State
 ↓
D1
 ↓
Derived state
 ├── Notion memory
 ├── Spark scheduling consequences
 ├── Study progress
 ├── Project state
 └── Agent context
```

The architecture therefore creates a single machine-readable coordination layer without creating a second Google, second Notion, second calendar, second task manager, or unnecessary all-in-one agent platform.
