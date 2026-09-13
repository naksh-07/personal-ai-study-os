# AI Client Prompts, Skills & Custom Agents Registry

This directory serves as the documentation and prompt distribution registry for the Personal AI Study OS AI clients.

For the authoritative end-to-end activation specification, scheduled task definitions, exact trigger prompts, and frozen ownership model, refer to:  
👉 [`docs/architecture/FINAL-SCHEDULING-ACTIVATION.md`](../../docs/architecture/FINAL-SCHEDULING-ACTIVATION.md)

In accordance with **Technical Contracts & Data Specification v1.1** (DEC-001, DEC-007, DEC-014), the operational responsibilities are strictly partitioned between **Gemini Spark** and **Antigravity**.

---

## 1. Gemini Spark (Tactical Scheduling & Dynamic Recovery Client)

Gemini Spark operates as the tactical scheduling client for the Personal AI Study OS. It coordinates Google Tasks (**WHAT**), Google Calendar (**WHEN**), and the Personal State Service (**GOVERNANCE**).

| Directory | Primary Skill / Prompt File | Description |
| :--- | :--- | :--- |
| [`Tactical skill/`](./Tactical%20skill/) | `SKILL.md`<br>`SPARK-TACTICAL-SCHEDULER-v1.0.md`<br>`SPARK_TACTICAL_SCHEDULER_SKILL.md` | **Tactical Daily Scheduler**: Morning study scheduling, slot allocation, calendar mutation within strict boundaries. |
| [`Dynamic skill/`](./Dynamic%20skill/) | `SKILL.md`<br>`SPARK_DYNAMIC_REPLANNER_SKILL.md` | **Dynamic Day Replanner**: Disruption recovery, late wake-ups, early sleep declarations, capacity compaction via `personal-study-os:replan_day`. |

---

## 2. Antigravity (Technical Execution, Normalization & Operations)

Antigravity operates as the technical execution engine and normalization client. It executes repository changes, operational diagnostics, calendar drift audits, and the quiescent nightly reconciliation workflow bridging human qualitative Notion journals with canonical Cloudflare D1 telemetry.

| Directory | Primary Files | Component Type | Description |
| :--- | :--- | :--- | :--- |
| [`Nightly normalization skill/`](./Nightly%20normalization%20skill/) | `SKILL.md`<br>`PERSONAL_OS_NIGHTLY_NORMALIZATION_SKILL.md`<br>`ANTIGRAVITY_NIGHTLY_NORMALIZATION_SKILL.md` | **Skill** (`personal-os-nightly-normalization`) | Quiescent nightly reconciliation (00:30–02:00 IST). Preserves human Notion properties (`[✍️]`), commits canonical telemetry to PSS/D1 first, and updates machine properties (`[🤖]`). |
| [`Operations skill/`](./Operations%20skill/) | `SKILL.md`<br>`PERSONAL_OS_OPERATIONS_SKILL.md`<br>`ANTIGRAVITY_OPERATIONS_SKILL.md` | **Skill** (`personal-os-operations`) | Technical operations, system health checks, calendar drift analysis, reliability sync triage, checkpointing, and test suite execution. |
| [`Nightly normalizer agent/`](./Nightly%20normalizer%20agent/) | `agent.md`<br>`PERSONAL_OS_NIGHTLY_NORMALIZER_AGENT.md`<br>`ANTIGRAVITY_NIGHTLY_NORMALIZER_AGENT.md` | **Custom Agent** (`personal-os-nightly-normalizer`) | Specialized autonomous reconciliation agent executing the nightly normalization sequence with zero data loss and strict human field protection. |

---

## 3. Authoritative Source of Truth in Workspace

The authoritative working definitions of Antigravity components are maintained in the root workspace configuration:
- Skills: `.agents/skills/`
- Custom Agents: `.agents/agents/`

The copies in this `docs/prompts/` directory are maintained for documentation, architectural reference, and cross-platform client deployment.
