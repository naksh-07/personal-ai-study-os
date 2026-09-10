# Personal AI Study OS

A personal, multi-agent study coordination system that connects Google, Gemini Spark, Notion, Cloudflare D1, ChatGPT, and Antigravity through a shared state architecture.

## North Star

Coordinate existing platforms instead of replacing them.

- **Google Tasks** → WHAT needs to be done
- **Google Calendar** → WHEN it happens
- **Gemini Spark** → scheduling and schedule adjustment
- **Notion** → human-readable memory and knowledge
- **Cloudflare D1** → machine-readable state and event history
- **ChatGPT** → reasoning, planning, research, and intent generation
- **Antigravity** → technical execution and source ingestion

## Architecture Status

- Architecture Baseline: **Frozen**
- Gate 2 Integration Reality Audit: **CLOSED / GREEN**
- Technical Contracts & Data Specification: **v1.1 / Authoritative**
- Gate 3 Production Implementation Specification: **CLOSED / GREEN (v1.0)**
- Production Build: **Ready to begin (Phases 0–16)**

## Project Documentation Directory

The finalized authoritative project knowledge and specifications are maintained in [`docs/`](docs/):

### Architecture & Blueprints
- [Architecture Baseline](docs/architecture/PERSONAL_AI_STUDY_OS_baseline.md) — The frozen architectural baseline establishing system principles, data planes, and ownership boundaries.
- [Engineering Implementation Blueprint](docs/architecture/engineering_blueprint.md) — Comprehensive 155-section technical architecture, data flows, and engineering standards.

### Integration Audits & Research
- [Integration Reality Audit v1.0](docs/audits/Integration_Reality_Audit_v1.0.md) — Empirical platform audit validating Cloudflare (D1, Workers, Queues), Google (Tasks, Calendar), Notion, MCP, and AI client constraints (**Verdict: GREEN**).

### Technical Contracts (Authoritative)
- [Technical Contracts Directory & Versioning](docs/contracts/README.md) — Version registry and change history.
- **[Technical Contracts & Data Specification v1.1.0](docs/contracts/Technical_Contracts_Data_Specification_v1.1.md)** — **Current Authoritative Technical Contract** reconciling Gate 2 audit findings.
- [Technical Contracts v1.0.0 (Archived)](docs/contracts/archive/Technical_Contracts_Data_Specification_v1.0.md) — Superseded pre-audit specification preserved for historical audit reference.

### Production Specifications
- [Production Implementation Specification v1.0](docs/specifications/Production_Implementation_Specification_v1.0.md) — Implementation-ready engineering design for the Cloudflare Worker, D1 schema, Queues, MCP server, and 16-phase build sequence (**Build Readiness: GREEN**).

## Repository Policy

This repository is the authoritative project source once an artifact is finalized and designated as such.

Working drafts and temporary generated material may remain in Antigravity. Do not turn this repository into a dump of every generated file. Commit finalized contracts, specifications, research results, implementation artifacts, and other material only when they become authoritative project sources.

## Development Principle

The system uses a shared-state architecture with clear ownership boundaries, canonical immutable events, rebuildable derived state, provider adapters, idempotent external mutations, and explicit integration contracts.

Architecture decisions must preserve these boundaries unless an explicit contract change is approved.

## License

MIT License. See [LICENSE](LICENSE).
