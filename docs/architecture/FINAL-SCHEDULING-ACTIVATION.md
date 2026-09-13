# Personal AI Study OS — Final Scheduling Activation Specification

**Document ID:** `FINAL-SCHEDULING-ACTIVATION.md`  
**System Version:** 1.2.3  
**Status:** **ACTIVATED & OPERATIONAL**  
**Authoritative Scope:** Final scheduling architecture, scheduled task triggers, on-demand replanning, and agent/skill runtime registry.  

---

## 1. Final Scheduling Architecture

The Personal AI Study OS scheduling lifecycle operates across three strictly partitioned execution paths:

### 1.1 Normal Daily Scheduling
**Spark**  
→ `spark-study-scheduler`  
→ **Personal State Service (PSS)**  
→ **Google Tasks** / **Google Calendar**  
→ **Notion Daily Study Journal**

- **Execution Flow:**
  1. Triggered daily at morning study start.
  2. Invokes the `spark-study-scheduler` skill.
  3. Queries PSS via MCP (`get_study_state`) for authoritative day classification, cognitive capacity, timetable anchors, and syllabus workload.
  4. Allocates focus containers on Google Calendar (WHEN) and aligns pending tasks on Google Tasks (WHAT).
  5. Records the tactical schedule in the Notion Daily Study Journal under `## 🤖 Morning Tactical Schedule`.

### 1.2 Dynamic / Disruption Replanning
**Spark**  
→ `spark-dynamic-replanner`  
→ **PSS Dynamic Replanning Engine**  
→ **Google Calendar**  
→ **Notion**

- **Execution Flow:**
  1. Triggered on-demand when the user explicitly declares a disruption (late wake, early sleep, unexpected delay).
  2. Invokes the `spark-dynamic-replanner` skill.
  3. Passes explicit user declarations to the PSS `replan_day` MCP tool.
  4. PSS Dynamic Replanning Engine calculates capacity adjustments and priority evictions; Spark applies the returned schedule changes to Google Calendar (maximum 5 mutations).
  5. Refreshes the Notion Daily Study Journal schedule section with dynamic status notes.

### 1.3 Nightly Normalization
**Antigravity**  
→ `personal-os-nightly-normalizer`  
→ `personal-os-nightly-normalization`  
→ **Personal State Service (PSS)**  
→ **Cloudflare D1 Canonical State**

- **Execution Flow:**
  1. Triggered daily during the system quiescence window (00:00–02:00 IST).
  2. Deploys the autonomous `personal-os-nightly-normalizer` agent executing the `personal-os-nightly-normalization` skill.
  3. Reads human qualitative reflections from Notion Daily Study Journal and extracts machine telemetry from PSS.
  4. Commits canonical normalized study session to Cloudflare D1 via PSS MCP first (`record_study_session`).
  5. Patches machine-owned Notion properties (`[🤖]`) second, strictly preserving all human reflection properties (`[✍️]`) and body narrative notes.

### 1.4 Frozen Ownership Model

| System Layer | Architectural Ownership | Authoritative Boundary |
| :--- | :--- | :--- |
| **Google Tasks** | **WHAT** | Task existence, completion status, syllabus action items (date-only precision). |
| **Google Calendar** | **WHEN** | Intra-day time allocation, scheduled focus containers, calendar events (prefixed `[Study OS]`). |
| **Personal State Service (PSS)** | **SCHEDULING GOVERNANCE** | Scheduling policy, Dynamic Day classification, capacity constraints, and Dynamic Replanning Engine authority. |
| **Cloudflare D1** | **CANONICAL MACHINE TRUTH** | Append-only event store, idempotency records, relational projections (27 tables), immutable history. |
| **Notion** | **HUMAN-FACING WORKSPACE** | Qualitative reflections, human journal entries, and long-term memory notes (`Daily Study Journal`). |
| **Gemini Spark** | **TACTICAL SCHEDULING** | Tactical daily schedule construction and disruption execution client. |
| **Antigravity** | **TECHNICAL EXECUTION** | Engineering operations, calendar drift diagnosis, and quiescent nightly reconciliation. |

---

## 2. Antigravity Nightly Scheduled Task

- **Task Name:** `Personal OS Nightly Normalizer`
- **Frequency:** Daily
- **Approximate Time:** 12:00 AM (quiescence window: 00:00–02:00 IST)
- **Agent:** `personal-os-nightly-normalizer`
- **Skill:** `personal-os-nightly-normalization`

### Exact Configured Prompt
```text
Use the personal-os-nightly-normalizer agent and its personal-os-nightly-normalization skill.

Run the complete nightly normalization workflow for today's Personal AI Study OS state. Follow the Skill exactly, use the existing production PSS/MCP and Notion contracts, preserve all human-owned Notion content, and make only necessary idempotent machine-state updates.

Report only the final result and any actual failure.
```

*(Note: The prompt above is preserved verbatim without alteration or paraphrasing.)*

---

## 3. Spark Morning Scheduled Task

- **Task Name:** `Personal OS Morning Scheduler`
- **Frequency:** Daily
- **Approximate Time:** 7:00 AM IST
- **Skill:** `spark-study-scheduler`

### Exact Configured Prompt
```text
Use the spark-study-scheduler skill.

Create today's tactical study schedule using the current Personal AI Study OS state. Follow the skill exactly, use PSS as the scheduling authority, coordinate Google Tasks and Calendar, and update the Notion Morning Tactical Schedule. Make only necessary schedule changes and do not invent any workload or study data.

Report the final schedule briefly and mention any actual failure.
```

*(Note: The prompt above is preserved verbatim without alteration or paraphrasing.)*

---

## 4. Spark Dynamic Replanner (On-Demand / Emergency Recovery)

The `spark-dynamic-replanner` is an **on-demand/emergency capability**, strictly separated from the normal morning scheduler. It is **NOT** a scheduled recurring task.

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
Use the spark-dynamic-replanner skill to replan today's schedule based on my declared disruption.
```

*(Note: This is an example interactive on-demand user prompt, not a recurring scheduled task.)*

---

## 5. Skills / Agent Locations

The physical repository paths, documentation copies, and global runtime mirrors have been verified on disk:

| Component Identifier | Component Type | Repository Working Path | Repository Documentation Path | Global Runtime Mirror Path |
| :--- | :--- | :--- | :--- | :--- |
| `personal-os-operations` | Skill | `.agents/skills/personal-os-operations/SKILL.md` | `personal-ai-study-os/docs/prompts/Operations skill/SKILL.md` | `C:\Users\Suraj\.gemini\config\skills\personal-os-operations\SKILL.md` |
| `personal-os-nightly-normalization` | Skill | `.agents/skills/personal-os-nightly-normalization/SKILL.md` | `personal-ai-study-os/docs/prompts/Nightly normalization skill/SKILL.md` | `C:\Users\Suraj\.gemini\config\skills\personal-os-nightly-normalization\SKILL.md` |
| `personal-os-nightly-normalizer` | Agent | `.agents/agents/personal-os-nightly-normalizer/agent.md` | `personal-ai-study-os/docs/prompts/Nightly normalizer agent/agent.md` | `C:\Users\Suraj\.gemini\config\agents\personal-os-nightly-normalizer\agent.md` |
| `spark-study-scheduler` | Skill | N/A (External AI Client) | `personal-ai-study-os/docs/prompts/Tactical skill/SKILL.md` | Gemini Spark Custom Instructions / Google Routine |
| `spark-dynamic-replanner` | Skill | N/A (External AI Client) | `personal-ai-study-os/docs/prompts/Dynamic skill/SKILL.md` | Gemini Spark Custom Instructions / Prompt Registry |

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
