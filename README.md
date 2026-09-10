# Personal AI Study OS — Documentation Index & Architecture Register

**System Version:** 1.2.3  
**Current Phase:** Final Build Authorization Review  
**Authoritative Implementation Specification:** [`Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.3.md`](./Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.3.md)  
**Production Build Status:** **NOT YET AUTHORIZED** (Pending Final Build Authorization Review)

---

## 1. Authoritative Precedence Hierarchy

In accordance with system governance, all implementation planning, code authoring, and operational procedures must strictly adhere to the following precedence order:

1. **[`Personal_AI_Study_OS_Technical_Contracts_Data_Specification_v1.1.md`](./Personal_AI_Study_OS_Technical_Contracts_Data_Specification_v1.1.md)**  
   *Domain boundaries, event definitions, ownership matrix, and non-negotiable architectural contracts. Authoritative and unchanged.*
2. **[`Integration_Reality_Audit_v1.0.md`](./Integration_Reality_Audit_v1.0.md)**  
   *Verified platform capabilities, operational limits, and constraints for Cloudflare, Google APIs, Notion, and MCP as of September 2026.*
3. **[`Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.3.md`](./Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.3.md)**  
   *The active, authoritative production implementation specification resolving all Gate 3 reconciliation and final hardening findings (including attempt_count single-increment semantics, attempt-preserving CAS recovery, crash loop termination, and deterministic DLQ routing).*
4. **[`PERSONAL AI STUDY OS.md`](./PERSONAL%20AI%20STUDY%20OS.md)**  
   *Foundational baseline architecture and system vision.*
5. **[`engineering blueprint.md`](./engineering%20blueprint.md)**  
   *Initial architectural blueprint and engineering design.*

---

## 2. Document Register & Version History

| Document | Version | Status | Role |
| :--- | :--- | :--- | :--- |
| `Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.3.md` | **v1.2.3** | **ACTIVE AUTHORITATIVE** | Complete production specification governing schema (24 tables), transactional outbox, 120s processing lease, single-increment attempt_count semantics, attempt-preserving CAS recovery, crash loop termination, deterministic Google Tasks lost-ack expanding window, provider idempotency, Streamable HTTP MCP, and CI/CD promotion. |
| `Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.2.md` | v1.2.2 | Superseded | Historical pre-build gate correction document. Preserved for auditability. |
| `Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.1.md` | v1.2.1 | Superseded | Historical pre-build gate correction document. Preserved for auditability. |
| `Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.md` | v1.2 | Superseded | Historical document (Gate 3 Reconciled). Preserved for auditability. |
| `Personal_AI_Study_OS_Production_Implementation_Specification_v1.1.md` | v1.1 | Superseded | Historical document (Gate 3 Reconciled). Preserved for auditability. |
| `Personal_AI_Study_OS_Production_Implementation_Specification_v1.0.md` | v1.0 | Superseded | Historical initial draft. Preserved for auditability. |
| `Personal_AI_Study_OS_Technical_Contracts_Data_Specification_v1.1.md` | v1.1 | **AUTHORITATIVE CONTRACT** | Master architectural contract. Unchanged. |
| `Technical Contracts & Data Specification v1.0.md` | v1.0 | Superseded | Historical initial contract draft. |
| `Integration_Reality_Audit_v1.0.md` | v1.0 | **AUTHORITATIVE AUDIT** | Master integration reality audit. |

---

## 3. Strict Pre-Build Gate Rules

- **No-Code Rule:** No production application code, migrations, or deployments may be executed until formal Build Authorization is granted.
- **Single-Tenant Deployment:** Version 1 is explicitly scoped as a single-user personal system.
- **Immutable Ledger:** Canonical events in Cloudflare D1 are strictly append-only; derived state is 100% rebuildable.
- **Provider Authority:** Google Tasks owns task status (WHAT); Google Calendar owns precise time allocation (WHEN); Notion owns human-readable notes; Cloudflare D1 owns machine truth.
