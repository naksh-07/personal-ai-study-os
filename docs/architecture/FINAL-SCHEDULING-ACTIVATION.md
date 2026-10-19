# Personal AI Study OS — Final Scheduling Activation Specification

**Document ID:** `FINAL-SCHEDULING-ACTIVATION.md`  
**System Version:** 1.2.3  
**Status:** **ACTIVATED & OPERATIONAL**  
**Authoritative Scope:** Final scheduling architecture, scheduled task triggers, on-demand replanning, and agent/skill runtime registry.  

---

## 1. Final Scheduling Architecture

The Personal AI Study OS scheduling lifecycle operates across three strictly partitioned execution paths, unified natively under **Antigravity CLI (`agy`) on Termux (Android ARM64)** powered by **Gemini 3.8 Flash**:

### 1.1 Normal Daily Scheduling
**Antigravity CLI (Termux Job / Native)**  
→ `personal-os-morning-scheduler` (Agent & Skill)  
→ **Personal State Service (PSS)**  
→ **Google Tasks** / **Google Calendar**  
→ **Notion Daily Study Journal**

- **Execution Flow:**
  1. Triggered daily at morning study start (07:00 AM IST) via `~/bin/study-os-morning-scheduler.sh` (or interactive `agy`).
  2. Spawns the autonomous `personal-os-morning-scheduler` agent executing the `personal-os-morning-scheduler` skill.
  3. Queries PSS via MCP (`get_study_state`) for authoritative day classification, cognitive capacity, timetable anchors, and syllabus workload.
  4. Allocates focus containers on Google Calendar (WHEN) and aligns pending tasks on Google Tasks (WHAT).
  5. Records the tactical schedule in the Notion Daily Study Journal under `## 🤖 Morning Tactical Schedule` and commits decisions to PSS (`record_schedule_decision`).
  6. Automatically mirrors tactical schedule summary to `/storage/emulated/0/Documents/Termux/Reports/` for mobile Obsidian review.

### 1.2 Dynamic / Disruption Replanning
**Antigravity CLI (Interactive On-Demand)**  
→ `personal-os-dynamic-replanner` (Agent & Skill)  
→ **PSS Dynamic Replanning Engine**  
→ **Google Calendar**  
→ **Notion**

- **Execution Flow:**
  1. Triggered on-demand when the user explicitly declares a disruption (late wake, early sleep, unexpected delay).
  2. Invokes the `personal-os-dynamic-replanner` agent executing the `personal-os-dynamic-replanner` skill.
  3. Passes explicit user declarations to the PSS `replan_day` MCP tool.
  4. PSS Dynamic Replanning Engine calculates capacity adjustments and priority evictions; agent applies the returned schedule changes to Google Calendar (maximum 5 mutations).
  5. Refreshes the Notion Daily Study Journal schedule section with dynamic status notes.
  6. Mirrors replan summary to mobile Obsidian vault.

### 1.3 Nightly Normalization
**Antigravity CLI (Termux Quiescent Job)**  
→ `personal-os-nightly-normalizer` (Agent & Skill)  
→ `personal-os-nightly-normalization`  
→ **Personal State Service (PSS)**  
→ **Cloudflare D1 Canonical State**

- **Execution Flow:**
  1. Triggered daily during the system quiescence window (00:00–02:00 IST) via `~/bin/study-os-nightly-normalizer.sh`.
  2. Deploys the autonomous `personal-os-nightly-normalizer` agent executing the `personal-os-nightly-normalization` skill.
  3. Reads human qualitative reflections from Notion Daily Study Journal and extracts machine telemetry from PSS.
  4. Commits canonical normalized study session to Cloudflare D1 via PSS MCP first (`record_study_session`).
  5. Patches machine-owned Notion properties (`[🤖]`) second, strictly preserving all human reflection properties (`[✍️]`) and body narrative notes.
  6. Reclaims background memory via the Universal Zero-Idle Lazy MCP Supervisor.

### 1.4 Frozen Ownership Model

| System Layer | Architectural Ownership | Authoritative Boundary |
| :--- | :--- | :--- |
| **Google Tasks** | **WHAT** | Task existence, completion status, syllabus action items (date-only precision). |
| **Google Calendar** | **WHEN** | Intra-day time allocation, scheduled focus containers, calendar events (prefixed `[Study OS]`). |
| **Personal State Service (PSS)** | **SCHEDULING GOVERNANCE** | Scheduling policy, Dynamic Day classification, capacity constraints, and Dynamic Replanning Engine authority. |
| **Cloudflare D1** | **CANONICAL MACHINE TRUTH** | Append-only event store, idempotency records, relational projections (27 tables), immutable history. |
| **Notion** | **HUMAN-FACING WORKSPACE** | Qualitative reflections, human journal entries, and long-term memory notes (`Daily Study Journal`). |
| **Antigravity CLI (`agy`)** | **AUTONOMOUS EXECUTION** | Unified mobile tactical scheduling, dynamic replanning, nightly normalization, and zero-idle MCP orchestration on Termux. |
| **Gemini 3.8 Flash** | **LLM REASONING ENGINE** | High-efficiency, zero-depreciation cognitive reasoning model powering all mobile OS agents. |

---

## 2. Antigravity Nightly Scheduled Task

- **Task Name:** `Personal OS Nightly Normalizer`
- **Frequency:** Daily
- **Approximate Time:** 12:00 AM (quiescence window: 00:00–02:00 IST)
- **Agent:** `personal-os-nightly-normalizer`
- **Skill:** `personal-os-nightly-normalization`
- **Headless Trigger Script:** `~/bin/study-os-nightly-normalizer.sh`

### Exact Configured Prompt
```text
Use the personal-os-nightly-normalizer agent and its personal-os-nightly-normalization skill.

Run the complete nightly normalization workflow for today's Personal AI Study OS state. Follow the Skill exactly, use the existing production PSS/MCP and Notion contracts, preserve all human-owned Notion content, and make only necessary idempotent machine-state updates.

Report only the final result and any actual failure.
```

---

## 3. Antigravity Morning Scheduled Task

- **Task Name:** `Personal OS Morning Scheduler`
- **Frequency:** Daily
- **Approximate Time:** 7:00 AM IST
- **Agent:** `personal-os-morning-scheduler`
- **Skill:** `personal-os-morning-scheduler`
- **Headless Trigger Script:** `~/bin/study-os-morning-scheduler.sh`

### Exact Configured Prompt
```text
Use the personal-os-morning-scheduler agent and skill.

Create today's tactical study schedule using the current Personal AI Study OS state. Follow the skill exactly, use PSS as the scheduling authority, coordinate Google Tasks and Calendar, and update the Notion Morning Tactical Schedule. Make only necessary schedule changes and do not invent any workload or study data.

Report the final schedule briefly and mention any actual failure.
```

---

## 4. Antigravity Dynamic Replanner (On-Demand Disruption Recovery)

The `personal-os-dynamic-replanner` is an **on-demand/emergency capability**, strictly separated from the normal morning scheduler. It is **NOT** a scheduled recurring task.

### 4.1 Use Cases & Triggers
- **Late Wake:** User wakes up later than nominal timetable start.
- **Early Sleep:** User declares an earlier sleep target than planned.
- **Unexpected Disruption:** Interruption consumes scheduled study time.
- **Missed Study Time:** Specific study blocks missed or abandoned.
- **Explicit Current-Day Replan Request:** User requests midday or evening schedule repair.

### 4.2 Architectural Constraints
- Invokes the Personal State Service `replan_day` MCP capability.
- Does **NOT** recreate Dynamic Day classification or Dynamic Replanning logic locally.
- PSS owns priority eviction order (P8 secondary activity → P7 rotation B → P5 rotation A, defending core P2 Maths and P3 Reasoning).
- Restricts Calendar churn to a maximum of 5 mutations per replan.

### 4.3 Intended Invocation Pattern
```text
Use the personal-os-dynamic-replanner agent and skill to replan today's schedule based on my declared disruption.
```

---

## 5. Skills / Agent Locations & Mobile Runtime Registry

The physical paths and mobile runtime mirrors on Termux (Android ARM64):

| Component Identifier | Component Type | Global Runtime Path | Role & Model |
| :--- | :--- | :--- | :--- |
| `personal-os-morning-scheduler` | Agent | `~/.gemini/config/agents/personal-os-morning-scheduler/agent.md` | Tactical Morning Planning (Gemini 3.8 Flash) |
| `personal-os-morning-scheduler` | Skill | `~/.gemini/config/skills/personal-os-morning-scheduler/SKILL.md` | Tactical Study Sizing & Notion Logging |
| `personal-os-dynamic-replanner` | Agent | `~/.gemini/config/agents/personal-os-dynamic-replanner/agent.md` | Disruption Recovery Agent (Gemini 3.8 Flash) |
| `personal-os-dynamic-replanner` | Skill | `~/.gemini/config/skills/personal-os-dynamic-replanner/SKILL.md` | PSS Replan Execution & Priority Defense |
| `personal-os-nightly-normalizer` | Agent | `~/.gemini/config/agents/personal-os-nightly-normalizer/agent.md` | Quiescent Reconciler (Gemini 3.8 Flash) |
| `personal-os-nightly-normalization`| Skill | `~/.gemini/config/skills/personal-os-nightly-normalization/SKILL.md`| Canonical D1 Commit + Notion Reconciliation |
| `personal-os-operations` | Skill | `~/.gemini/config/skills/personal-os-operations/SKILL.md` | System Diagnostics & Drift Analysis |
| `lazy_mcp_supervisor` | Runtime Script | `~/.gemini/config/scripts/lazy_mcp_supervisor.py` | Universal Zero-Idle Auto-Harvester (Reclaims ~750MB RAM) |

---

## 6. Production MCP & Backend Endpoints

The Personal State Service is live and operational:

- **Production MCP Endpoint:**  
  `https://personal-ai-study-os-production.riyasaksena502.workers.dev/mcp`
- **Production Worker Endpoint:**  
  `https://personal-ai-study-os-production.riyasaksena502.workers.dev`
- **Public Health Endpoint:**  
  `https://personal-ai-study-os-production.riyasaksena502.workers.dev/health`
- **Public Status Endpoint:**  
  `https://personal-ai-study-os-production.riyasaksena502.workers.dev/v1/status`

### Security Invariant
All MCP and REST mutations require valid OAuth 2.0 / 2.1 Bearer tokens validating the audience claim (`personal-ai-study-os`). No tokens, secrets, client credentials, or private keys are documented or committed.

---

## 7. Important Architectural Boundaries

1. **Trigger Prompts vs. Operational Rules:**
   - The scheduled task prompts in Sections 2 and 3 are intentionally brief trigger/orchestration instructions.
   - The **Skills** contain the complete operational rules, invariants, validation checks, error protocols, and rate-limiting guidelines.
   - Do **NOT** duplicate the full Skill instructions inside the Scheduled Task trigger prompts.
2. **No Local Algorithm Recreation:**
   - Spark and Antigravity must **never** independently recreate PSS scheduling algorithms, capacity calculations, or day classifications.
   - PSS is the sole authoritative intelligence engine for scheduling logic. Clients execute the decisions returned by PSS.
3. **Human Notion Field Immutability:**
   - Antigravity and Spark must never alter, overwrite, or delete Notion properties prefixed with `[✍️]` or human narrative journal blocks (`🎯 Today's Focus`, `📖 What I Studied`, `🧩 Important Problems / Errors`, `🧠 What I Learned`, `🔁 What Needs Revision`, `✍️ Reflection`).
   - Only machine-owned properties (`[🤖]`) and completion status (`[🔄] Day Status`) are programmatically updated.

---

## 8. Activation Status

| Component / Workflow | Execution Mode | Schedule | Activation & Verification Status |
| :--- | :--- | :--- | :--- |
| **Antigravity Nightly Normalizer** | Scheduled Task | Daily @ 12:00 AM IST | **Configured & Locally Verified** (Agent & Skill active in `.agents/` and global config; 382/382 unit/integration tests passing). |
| **Spark Morning Scheduler** | Scheduled Routine | Daily @ 7:00 AM IST | **User-Configured / Externally Activated** (Configured via Google Routines / Gemini Spark prompt interface). |
| **Spark Dynamic Replanner** | On-Demand Invocation | Interactive (Upon Disruption) | **User-Configured / Externally Activated** (Skill & Prompt available in `personal-ai-study-os/docs/prompts/Dynamic skill/`). |
| **Production MCP Connection** | Streamable HTTP / SSE | Continuous | **Locally Verified & Live** (Worker `/health` HTTP 200, remote `/mcp` tool execution validated). |
| **Notion Integration** | MCP API Integration | Daily / Quiescent | **Locally Verified & Live** (Bot `Antigravity` active in workspace `Riya Saxena's Notion`). |

---

## 9. Non-Negotiable System Invariants

This document records the finalized, frozen activation baseline. The following constraints remain immutable:
1. **Zero DDL Drift:** Cloudflare D1 schema is frozen at exactly 27 tables across migrations 0001, 0002, and 0003. No new tables, migrations, or DDL modifications are permitted.
2. **PSS-Only Boundary:** Direct raw SQL against Cloudflare D1 is strictly prohibited. All queries and mutations route via PSS REST routes or MCP tools.
3. **Deterministic Idempotency:** Every mutation requires a unique, deterministic idempotency key (`norm_${date}_${pageId}`, `ops_${action}_...`).
4. **Minimal Churn:** Calendar modifications must remain bounded (maximum 5 mutations per run) to prevent schedule disruption.
