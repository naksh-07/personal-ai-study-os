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

---

## 2. Project Documentation Directory

All authoritative specifications, baseline architectures, and audits are maintained in [`docs/`](./docs/):

```text
docs/
├── architecture/
│   ├── PERSONAL_AI_STUDY_OS_baseline.md       # Foundational architectural baseline
│   └── engineering_blueprint.md               # 155-section technical engineering blueprint
├── audits/
│   └── Integration_Reality_Audit_v1.0.md      # Platform capabilities & operational limits audit
├── contracts/
│   ├── README.md                              # Contracts index & v1.0 -> v1.1 change history
│   ├── Technical_Contracts_Data_Specification_v1.1.md          # Active authoritative technical contracts
│   └── archive/
│       └── Technical_Contracts_Data_Specification_v1.0.md      # Historical superseded contracts
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
  - **Notion:** Human-facing long-term study memory and rich session notes.
  - **Cloudflare D1:** Authoritative machine truth, event log, and idempotency ledger.
  - **Antigravity:** Technical execution agent authorized for backend engineering, deployment, and operational tasks.
  - **Gemini Spark & ChatGPT:** Intermittent LLM intelligence for planning and scheduling (human-configured custom instructions; no continuous sync, no chat history stored).

---

## 5. Human Configuration Contract

The technical infrastructure, database, queues, bridge, and worker endpoints are fully deployed and verified. The remaining external UI integrations require manual human configuration via their respective web interfaces:

1. **Notion Integration:**
   - Create the target study database in your Notion workspace.
   - Configure integration token and database ID if Notion syncing is enabled.
2. **Gemini Spark (Deep Thinker / Daily Planner):**
   - Configure Custom Instructions in the Gemini web interface using the prompt specifications in `docs/specifications/Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.3.md`.
   - Access the remote MCP server (`/mcp` endpoint) or REST API (`/v1/*`) via OAuth 2.1 / Bearer token.
3. **ChatGPT (Intermittent Assistant):**
   - Configure custom GPT actions or workflow prompts using the OpenAPI / MCP schema.
   - Operates strictly on an on-demand, event-driven basis (no chat history or chain-of-thought stored in D1).
4. **Google Apps Script Bridge:**
   - Deployed and securely bound via HMAC-SHA256 signature verification for Google Tasks and Google Calendar synchronization.
