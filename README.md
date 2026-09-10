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
- Gate 3 Production Implementation Specification: **Next**
- Production Build: **Not started**

## Repository Policy

This repository is the authoritative project source once an artifact is finalized and designated as such.

Working drafts and temporary generated material may remain in Antigravity. Do not turn this repository into a dump of every generated file. Commit finalized contracts, specifications, research results, implementation artifacts, and other material only when they become authoritative project sources.

## Development Principle

The system uses a shared-state architecture with clear ownership boundaries, canonical immutable events, rebuildable derived state, provider adapters, idempotent external mutations, and explicit integration contracts.

Architecture decisions must preserve these boundaries unless an explicit contract change is approved.

## License

MIT License. See [LICENSE](LICENSE).
