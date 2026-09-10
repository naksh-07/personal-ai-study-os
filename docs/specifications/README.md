# Production Implementation Specifications

This directory contains the production implementation specifications, database schemas, processing lease models, and build governance specifications for the **Personal AI Study OS**.

---

## Authoritative Status

> [!IMPORTANT]
> **Active Authoritative Specification:** [Personal AI Study OS Production Implementation Specification v1.2.3](./Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.3.md)
> 
> All engineering implementation, schema definitions, queue processing, provider synchronization, and CI/CD pipelines MUST strictly adhere to **v1.2.3**.
> Previous versions (v1.0 through v1.2.2) have been superseded and are preserved exclusively for audit and historical reference in [`archive/`](./archive/).

---

## Specification Version Registry

| Version | Status | Location | Description / Key Reconciliations |
| :--- | :--- | :--- | :--- |
| **v1.2.3** | **Authoritative (Active)** | [Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.3.md](./Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.3.md) | **Final Build Authorization Hardened**. Canonical single-increment attempt count semantics, stale PROCESSING CAS ownership preservation, Crash Scenario 7 loop termination, strict 5-attempt budget, deterministic DLQ routing, and Google Tasks search tier alignment. |
| **v1.2.2** | Superseded (Archived) | [archive/Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.2.md](./archive/Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.2.md) | Fully deterministic Google Tasks lost-ack expanding search windows, 120s PROCESSING lease, and CAS stale recovery. |
| **v1.2.1** | Superseded (Archived) | [archive/Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.1.md](./archive/Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.1.md) | Processing lease column additions (`processing_started_at`) and Notion webhook signature verification. |
| **v1.2.0** | Superseded (Archived) | [archive/Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.md](./archive/Personal_AI_Study_OS_Production_Implementation_Specification_v1.2.md) | Final Build Gate reconciliation: transactional outbox pattern, provider idempotency keys, Streamable HTTP MCP transport, and 24-table schema. |
| **v1.1.0** | Superseded (Archived) | [archive/Personal_AI_Study_OS_Production_Implementation_Specification_v1.1.md](./archive/Personal_AI_Study_OS_Production_Implementation_Specification_v1.1.md) | Build Readiness Reconciliation (Gate 3): D1 schema mapping, queue persistence, mathematical bounds on projections, OAuth 2.1 audience verification. |
| **v1.0.0** | Superseded (Archived) | [archive/Production_Implementation_Specification_v1.0.md](./archive/Production_Implementation_Specification_v1.0.md) | Initial baseline production implementation specification draft. |

---

## Contract Authority Reminder

Per system governance, **[`docs/contracts/Technical_Contracts_Data_Specification_v1.1.md`](../contracts/Technical_Contracts_Data_Specification_v1.1.md)** remains the highest-order architectural contract governing domain boundaries and canonical event structures. All production implementation specifications operate strictly within those non-negotiable contracts.
