# Personal AI Study OS — Documentation Index & Architecture Register

**System Version:** 1.2.3  
**Current Phase:** Production Deployed & Verified  
**Authoritative Implementation Specification:** [`docs/specifications/Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.3.md`](./docs/specifications/Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.3.md)  
**Production Build Status:** **PRODUCTION DEPLOYED & VERIFIED** (Release Tag `v1.2.3`)

---

## 1. Authoritative Precedence Hierarchy

In accordance with system governance, all implementation planning, code authoring, and operational procedures must strictly adhere to the following precedence order:

1. **[`docs/contracts/Technical_Contracts_Data_Specification_v1.1.md`](./docs/contracts/Technical_Contracts_Data_Specification_v1.1.md)**  
   *Domain boundaries, event definitions, ownership matrix, and non-negotiable architectural contracts. Authoritative and unchanged.*
2. **[`docs/audits/Integration_Reality_Audit_v1.0.md`](./docs/audits/Integration_Reality_Audit_v1.0.md)**  
   *Verified platform capabilities, operational limits, and constraints for Cloudflare, Google APIs, Notion, and MCP as of September 2026.*
3. **[`docs/specifications/Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.3.md`](./docs/specifications/Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.3.md)**  
   *The active, authoritative production implementation specification resolving all Gate 3 reconciliation and final hardening findings (including attempt_count single-increment semantics, attempt-preserving CAS recovery, crash loop termination, and deterministic DLQ routing).*
4. **[`docs/architecture/PERSONAL_AI_STUDY_OS_baseline.md`](./docs/architecture/PERSONAL_AI_STUDY_OS_baseline.md)**  
   *Foundational baseline architecture and system vision.*
5. **[`docs/architecture/engineering_blueprint.md`](./docs/architecture/engineering_blueprint.md)**  
   *Initial architectural blueprint and engineering design.*

### 1.1 Global Notion Governance Rule

> **Mandatory Workspace-Wide Directive:**  
> "Before any AI, agent, automation, MCP tool, or future client performs meaningful work in the Notion workspace, it must first read and follow the Universal Notion Workspace Operating Protocol. This protocol is the workspace-wide governance layer and applies regardless of which project, database, page, or workflow is being accessed."
>
> **Repository Source of Truth:** [`docs/governance/NOTION-WORKSPACE-OPERATING-PROTOCOL-v1.0.md`](./docs/governance/NOTION-WORKSPACE-OPERATING-PROTOCOL-v1.0.md)  
> **Published Notion Page:** `📜 Notion Workspace Operating Protocol` (`3daa86b6-95e7-8137-b57a-dc84e6d8049b`)

---

## 2. Project Documentation Directory

All authoritative specifications, baseline architectures, and audits are maintained in [`docs/`](./docs/):

```text
docs/
├── architecture/
│   ├── FINAL-SCHEDULING-ACTIVATION.md         # Final activated scheduling architecture & triggers
│   ├── PERSONAL_AI_STUDY_OS_baseline.md       # Foundational architectural baseline
│   └── engineering_blueprint.md               # 155-section technical engineering blueprint
├── audits/
│   └── Integration_Reality_Audit_v1.0.md      # Platform capabilities & operational limits audit
├── contracts/
│   ├── README.md                              # Contracts index & v1.0 -> v1.1 change history
│   ├── Technical_Contracts_Data_Specification_v1.1.md          # Active authoritative technical contracts
│   └── archive/
│       └── Technical_Contracts_Data_Specification_v1.0.md      # Historical superseded contracts
├── governance/
│   └── NOTION-WORKSPACE-OPERATING-PROTOCOL-v1.0.md             # Universal Notion workspace governance protocol
└── specifications/
    ├── README.md                              # Specifications index & reconciliation history
    ├── Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.3.md  # Active authoritative spec
    └── archive/
        ├── Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.2.md
        ├── Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.1.md
        ├── Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.md
        ├── Personal_AI_Study_OS_Production_Implementation_Specification_v1.1.md
        └── Production_Implementation_Specification_v1.0.md
```

---

## 3. Document Register & Version History

| Document | Version | Status | Role |
| :--- | :--- | :--- | :--- |
| [`NOTION-WORKSPACE-OPERATING-PROTOCOL-v1.0.md`](./docs/governance/NOTION-WORKSPACE-OPERATING-PROTOCOL-v1.0.md) | **v1.0** | **ACTIVE AUTHORITATIVE** | Universal Notion workspace operating protocol governing human memory, anti-slop, and multi-agent coordination across all AI clients. |
| [`FINAL-SCHEDULING-ACTIVATION.md`](./docs/architecture/FINAL-SCHEDULING-ACTIVATION.md) | **v1.2.3** | **ACTIVE AUTHORITATIVE** | Final scheduling activation: Unified Antigravity CLI on Termux (Android ARM64), Gemini 3.8 Flash agents (`personal-os-morning-scheduler`, `personal-os-dynamic-replanner`, `personal-os-nightly-normalizer`), headless scripts, and Zero-Idle Lazy MCP Supervisor. |
| [`Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.3.md`](./docs/specifications/Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.3.md) | **v1.2.3** | **ACTIVE AUTHORITATIVE** | Complete production specification governing schema (24 tables), transactional outbox, 120s processing lease, single-increment attempt_count semantics, attempt-preserving CAS recovery, crash loop termination, deterministic Google Tasks lost-ack expanding window, provider idempotency, Streamable HTTP MCP, and CI/CD promotion. |
| [`Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.2.md`](./docs/specifications/archive/Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.2.md) | v1.2.2 | Superseded | Historical pre-build gate correction document. Preserved for auditability. |
| [`Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.1.md`](./docs/specifications/archive/Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.1.md) | v1.2.1 | Superseded | Historical pre-build gate correction document. Preserved for auditability. |
| [`Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.md`](./docs/specifications/archive/Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.md) | v1.2 | Superseded | Historical document (Gate 3 Reconciled). Preserved for auditability. |
| [`Personal_AI_Study_OS_Production_Implementation_Specification_v1.1.md`](./docs/specifications/archive/Personal_AI_Study_OS_Production_Implementation_Specification_v1.1.md) | v1.1 | Superseded | Historical document (Gate 3 Reconciled). Preserved for auditability. |
| [`Production_Implementation_Specification_v1.0.md`](./docs/specifications/archive/Production_Implementation_Specification_v1.0.md) | v1.0 | Superseded | Historical initial draft. Preserved for auditability. |
| [`Technical_Contracts_Data_Specification_v1.1.md`](./docs/contracts/Technical_Contracts_Data_Specification_v1.1.md) | v1.1 | **AUTHORITATIVE CONTRACT** | Master architectural contract. Unchanged. |
| [`Technical_Contracts_Data_Specification_v1.0.md`](./docs/contracts/archive/Technical_Contracts_Data_Specification_v1.0.md) | v1.0 | Superseded | Historical initial contract draft. Preserved for auditability. |
| [`Integration_Reality_Audit_v1.0.md`](./docs/audits/Integration_Reality_Audit_v1.0.md) | v1.0 | **AUTHORITATIVE AUDIT** | Master integration reality audit. |

---

## 4. Production Operational Reality & Architecture Boundaries

- **Single-Tenant Deployment:** Scoped as a single-user personal operating system for study workflows.
- **Immutable Ledger:** Canonical events in Cloudflare D1 (`personal_study_os_db_prod`) are strictly append-only; derived projections are 100% rebuildable.
- **Provider Authority:**
  - **Google Tasks:** Owns task existence and completion status (**WHAT**).
  - **Google Calendar:** Owns schedule blocks and calendar slots (**WHEN**).
  - **Notion:** Human-facing long-term study memory and rich session notes. Governed workspace-wide by [`docs/governance/NOTION-WORKSPACE-OPERATING-PROTOCOL-v1.0.md`](./docs/governance/NOTION-WORKSPACE-OPERATING-PROTOCOL-v1.0.md).
  - **Cloudflare D1:** Authoritative machine truth, event log, and idempotency ledger.
  - **Antigravity CLI (`agy`) on Termux:** Unified autonomous execution engine on mobile ARM64. Directly executes tactical scheduling, disruption recovery, and nightly normalization.
  - **Gemini 3.8 Flash:** Cognitive intelligence engine powering all autonomous agent decisions. Zero external web prompt dependency.
  - **Universal Zero-Idle Lazy MCP Supervisor:** Process governor eliminating background Node.js memory drain across all MCP servers (saving ~750MB RAM).

---

## 5. Mobile Runtime & Headless Execution Contract

The technical infrastructure, database, queues, bridge, and mobile agents are fully deployed and operational natively on Termux (Android):

1. **Tactical Morning Scheduling (07:00 AM IST):**
   - Triggered autonomously via `~/bin/study-os-morning-scheduler.sh` (or interactive `agy`).
   - Powered by `personal-os-morning-scheduler` agent & skill using `personal-study-os` MCP state.
2. **Dynamic Day Recovery (On-Demand Disruption):**
   - Triggered interactively via `personal-os-dynamic-replanner` whenever schedule disruptions occur.
   - PSS Dynamic Replanning Engine evicts lower priorities while defending core P2 Maths and P3 Reasoning.
3. **Quiescent Nightly Normalization (12:00 AM IST):**
   - Triggered autonomously via `~/bin/study-os-nightly-normalizer.sh`.
   - Powered by `personal-os-nightly-normalizer` reconciling Notion reflections with Cloudflare D1.
4. **Google Apps Script Bridge:**
   - Deployed and securely bound via HMAC-SHA256 signature verification for Google Tasks and Google Calendar synchronization.
5. **Mobile Obsidian Mirroring:**
   - All generated schedules, audit ledgers, and walkthrough reports automatically mirror to `/storage/emulated/0/Documents/Termux/Reports/` for comfortable mobile reading.
