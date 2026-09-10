# Personal AI Study OS — Documentation Index & Architecture Register

**System Version:** 1.2.3  
**Current Phase:** Final Build Authorization Review  
**Authoritative Implementation Specification:** [`docs/specifications/Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.3.md`](./docs/specifications/Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.3.md)  
**Production Build Status:** **NOT YET AUTHORIZED** (Pending Final Build Authorization Review)

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

## 4. Strict Pre-Build Gate Rules

- **No-Code Rule:** No production application code, migrations, or deployments may be executed until formal Build Authorization is granted.
- **Single-Tenant Deployment:** Version 1 is explicitly scoped as a single-user personal system.
- **Immutable Ledger:** Canonical events in Cloudflare D1 are strictly append-only; derived state is 100% rebuildable.
- **Provider Authority:** Google Tasks owns task status (WHAT); Google Calendar owns precise time allocation (WHEN); Notion owns human-readable notes; Cloudflare D1 owns machine truth.
