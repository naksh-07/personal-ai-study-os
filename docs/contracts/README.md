# Technical Contracts & Data Specifications

This directory contains the formal technical contracts, data models, event schemas, and integration boundary specifications for the **Personal AI Study OS**.

---

## Authoritative Status

> [!IMPORTANT]
> **Active Authoritative Contract:** [Technical Contracts & Data Specification v1.1.0](./Technical_Contracts_Data_Specification_v1.1.md)
> 
> All engineering implementations, schema migrations, and client integrations MUST adhere to **v1.1.0**.
> Version 1.0.0 has been superseded and is retained exclusively for historical and audit reference.

---

## Version Registry

| Version | Status | Location | Description / Audit Status |
| :--- | :--- | :--- | :--- |
| **v1.1.0** | **Authoritative (Active)** | [Technical_Contracts_Data_Specification_v1.1.md](./Technical_Contracts_Data_Specification_v1.1.md) | **Gate 2 Closed / GREEN**. Reconciled with verified platform constraints from `Integration_Reality_Audit_v1.0.md`. |
| **v1.0.0** | **Archived (Superseded)** | [archive/Technical_Contracts_Data_Specification_v1.0.md](./archive/Technical_Contracts_Data_Specification_v1.0.md) | Initial baseline contract draft prior to Gate 2 Integration Reality Audit. |

---

## Contract Change History (v1.0 → v1.1)

The transition from v1.0 to v1.1 was driven strictly by the empirical findings of the **Gate 2 Integration Reality Audit** (`docs/audits/Integration_Reality_Audit_v1.0.md`). No architectural redesign took place; only platform-verified realities were reconciled:

1. **Cloudflare D1 Transaction Model**:
   - *v1.0 Assumption*: Standard SQL explicit transactions (`BEGIN`, `COMMIT`, `ROLLBACK`).
   - *v1.1 Contract*: Cloudflare D1 executes atomic operations as arrays of statements via `db.batch()`. Explicit transaction control statements are prohibited.
2. **Google Tasks vs. Google Calendar Boundary**:
   - *v1.0 Assumption*: Google Tasks holding intra-day due timestamps for study sessions.
   - *v1.1 Contract*: Google Tasks API discards the time portion of due dates (date-only precision). Google Calendar is the sole authority for intra-day time allocation and time blocks; Google Tasks remains authoritative only for task existence, action completion, and date-level tracking.
3. **Queue Consumer Idempotency**:
   - *v1.0 Assumption*: Generic queue processing.
   - *v1.1 Contract*: Because Cloudflare Queues provide at-least-once delivery, consumers must verify `IdempotencyRecord` in D1 before invoking downstream mutations on external providers.
4. **MCP Token Security**:
   - *v1.0 Assumption*: Generic Bearer token authentication.
   - *v1.1 Contract*: Personal State Worker strictly validates the OAuth "Audience" claim on incoming MCP Bearer tokens to prevent confused-deputy vulnerabilities.
5. **Notion Synchronization**:
   - *v1.0 Assumption*: Polling-based sync.
   - *v1.1 Contract*: Webhook-driven synchronization respecting the strict 3 req/sec rate limit.
6. **Agent Execution Boundaries**:
   - *v1.0 Baseline*: Re-affirmed in v1.1 that ChatGPT functions strictly as a reasoner and structured intent generator without requiring unattended background execution. Antigravity serves as the authorized technical execution and source-ingestion client.
