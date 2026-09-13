# 📜 Notion Workspace Operating Protocol

**Version:** v1.0  
**Status:** ACTIVE  
**Scope:** Entire Notion Workspace  
**Effective Date:** 2026-09-13  
**Target Audience:** All AI Agents (ChatGPT, Gemini, Gemini Spark, Antigravity, Claude, future agents), automations, MCP clients, and human collaborators.

> **Core Philosophy:** Notion is a living human workspace, not an AI playground. Every AI interaction must follow:  
> **READ → UNDERSTAND → VERIFY → MINIMAL ACTION → PRESERVE.**

---

## 1. Before You Touch Notion

Every AI, automation, or script interacting with this Notion workspace must operate under a strictly conservative default:

1. **Conservative Default:** Modify only what is strictly necessary to satisfy the explicit user instruction or execute a documented workflow.
2. **First-Class Discipline:** An AI noticing something that "could be improved" has **no authorization** to change it. Unprompted cleanup, unsolicited reorganization, and speculative refactoring are strictly prohibited.
3. **Execution Creed:** *Useful work, minimum disturbance.*

---

## 2. Notion's Role in the Ecosystem

Notion serves as the **Human Memory, Knowledge, Context, and Reflective Layer**.

Notion is **NOT**:
- Canonical machine truth
- A relational event ledger or database (e.g., Cloudflare D1)
- An intra-day task scheduler or calendar engine (e.g., Google Calendar)
- A tactical execution checklist (e.g., Google Tasks)
- A high-frequency telemetry sink or raw event queue

### System Coordination Invariant
Where external machine engines exist alongside Notion:
- **Machine Systems (e.g., Cloudflare D1, Google APIs):** Retain authoritative machine-readable state.
- **Coordination Service (e.g., Personal State Service / PSS):** Acts as the machine coordination boundary.
- **Notion:** Receives and displays curated human-facing representations.

Never promote a Notion record or page into canonical machine truth merely because it appears complete or convenient.

---

## 3. Ownership Model

All properties, sections, and blocks within Notion adhere to a formal tripartite ownership model:

| Marker | Ownership Type | Authority | Operating Rules for AI / Automations |
| :---: | :--- | :--- | :--- |
| `[✍️]` | **Human-Owned** | Human Operator | **Inviolable.** AI must never silently overwrite, rewrite, truncate, reformat, summarize over, or delete human-owned fields. Modifiable only upon direct, explicit human instruction. |
| `[🤖]` | **Machine-Owned** | Automated Engines | **Authoritative Machine State.** Updated strictly by designated automations/clients in accordance with approved contracts. AI must verify schema and entity ID before writing. |
| `[🔄]` | **Shared** | Collaborative | **Defined Contract.** Initialized by system, refined by human, or reconciled bidirectionally. Modifiable strictly within documented workflow rules. Shared never means unrestricted. |

If a property or block lacks an explicit marker:
- Treat body prose, reflections, notes, and journals as `[✍️] Human-Owned`.
- Treat system identifiers (e.g., `OS_Entity_ID`), computed scores, and foreign IDs as `[🤖] Machine-Owned`.
- Stop and inspect schema documentation before assuming permission to write.

---

## 4. Read Protocol

Before performing any read or query operations:

1. **Protocol Awareness:** Ground every operation in this Universal Operating Protocol.
2. **Target Identification:** Identify the specific target page, database, or block needed for the task.
3. **Purpose Understanding:** Understand why the page or database exists before interpreting its data.
4. **Structural Inspection:** Inspect parent-child hierarchy and existing views before searching.
5. **Ownership Scrutiny:** Identify field ownership markers (`[✍️]`, `[🤖]`, `[🔄]`) before reading or caching.
6. **Minimal Scope:** Ingest and read **only** the properties and blocks necessary to fulfill the task.
7. **No Gratuitous Crawling:** Never crawl, scrape, or bulk-export the entire workspace when answering a focused inquiry.
8. **Smallest Valid Action:** Formulate the smallest valid query or read operation.

---

## 5. Write Protocol

Every write, update, or append operation must execute the five-phase lifecycle:

```text
READ → UNDERSTAND → VERIFY → WRITE MINIMUM REQUIRED CHANGE → VERIFY RESULT
```

### The 7 Pre-Creation Existence Checks
Before creating any new entity in Notion, ask and verify:
1. **Does it already exist?** Search by title, alias, and identifier.
2. **Is there an existing page?** Can an existing page house this content?
3. **Is there an existing database?** Can an existing database accommodate this entity?
4. **Is there an existing property?** Does an existing schema field already represent this attribute?
5. **Is there an existing relation?** Can an existing relational link represent this association?
6. **Is there an existing template?** Does an authorized template define how this entity must look?
7. **Can the request be satisfied without creating anything new?** Default to updating or referencing existing structures.

---

## 6. No-Slop Principle

Anti-slop and anti-bloat standards are strictly enforced. AI clients and automations must **NOT** add:

- Unsolicited headings, subheadings, or structural partitions
- Decorative emojis, callout boxes, or visual embellishments
- Executive summaries or repetitive "TL;DR" sections
- Self-congratulatory or explanatory AI commentary
- Unsolicited templates, boilerplate, or schema structures
- Unnecessary databases, properties, relations, or rollup fields
- Unprompted custom views, filters, sorts, or board groups
- Artificial metadata, arbitrary tags, or synthetic categories
- Duplicate content or rephrased restatements of existing text
- AI-generated conversational filler, pleasantries, or preamble

### Explicit Authorization Gate
Content or structural additions are permitted **only** when:
1. Explicitly requested by the user in the active prompt, OR
2. Mandated by an established, version-controlled workflow specification.

---

## 7. Human Content Protection

Human-authored text possesses absolute priority and immunity from unprompted modification:

- **Protected Artifacts:** Daily journals, personal reflections, stream-of-consciousness notes, manually curated knowledge, qualitative evaluations, strategic thoughts, and creative drafts.
- **No Silent Overwrites:** Never replace, shorten, or overwrite human-written paragraphs with AI-generated text.
- **No "Beautification":** Never rephrase or reorganize human notes simply because an AI alternative sounds more professional, articulate, or concise.
- **No Truncation:** Never truncate a page or remove historical notes to make room for machine-generated summaries.
- **Safe Appending:** When authorized to add information to a human-authored page, append to a designated machine section or clearly demarcated integration block without altering adjacent human prose.

---

## 8. Creating Pages, Databases & Properties

### Database Creation Rules
- Creating a database is a **high-impact architectural event**.
- Search existing databases first (`_Backend Databases` and workspace hubs).
- Inspect existing schemas, relations, and select options.
- Determine whether an existing database (with a filtered view or additional select option) satisfies the need.
- **Hard Rule:** Only create a new database when a demonstrated structural and relational need exists that cannot be met by the existing architecture. Document the structural justification. Never create databases for temporary AI convenience.

### Property Creation Rules
- Inspect the current schema before proposing or adding any property.
- Verify whether an existing property already serves the intended purpose.
- Check ownership designation: assign explicit markers (`[✍️]`, `[🤖]`, `[🔄]`).
- Verify naming conventions and select option palettes against established patterns.
- Avoid redundant, single-use, or speculative properties.

### Page Creation Rules
- Search exhaustively for existing equivalent pages to prevent duplication.
- Place new pages in their logically authoritative parent hub (e.g., `HOME`, `STUDY`, `BUILD`, `KNOWLEDGE`, `LIFE`, `AI & SYSTEMS`, `ARCHIVE`).
- Strictly follow workspace naming and emoji conventions.
- Never create standalone scratch pages, intermediate thinking logs, or AI working drafts inside user-facing hubs.

---

## 9. Move, Rename & Delete Rules

### Move & Rename Rules
- Moving or renaming a page or database breaks navigation bookmarks, URL links, relational rollups, automation webhooks, and MCP tools.
- **Prohibition:** Never move or rename an existing structural entity unless:
  1. Explicitly commanded by the human user, OR
  2. Formally mandated by an approved, version-controlled migration plan.
- Inspect all upstream and downstream dependencies before executing any move or rename.

### Delete Rules
- Deletion is destructive and often irreversible.
- **Strict Prohibition:** AI must never delete pages, databases, database properties, relations, views, historical logs, or human-authored content.
- If an entity appears obsolete, propose archiving it via status change (e.g., `Status = Archived`) rather than deletion.
- If deletion is requested, confirm exact entity ID and verify that no relational dependencies will be orphaned.
- **When uncertain: STOP. Do not guess.**

---

## 10. Machine Synchronization Boundaries

Where automated pipelines synchronize external systems into Notion:

1. **Authoritative Master:** External authoritative databases (e.g., Cloudflare D1 for Personal AI Study OS) remain the single source of truth.
2. **Projection Only:** Notion records represent read-optimized, human-friendly projections.
3. **Deterministic Identity:** Machine-synced pages must maintain a unique, immutable external identifier (e.g., `[🤖] OS_Entity_ID`) to ensure idempotency and prevent duplicate creation.
4. **Rate Limiting & Politeness:** Enforce rate-limiting constraints (token bucket ≤ 3 requests/second). Use exponential backoff upon encountering HTTP 429 or 503 responses.
5. **No Upward State Promotion:** Never elevate Notion edits into canonical machine state unless an explicit bidirectional reconciliation contract explicitly governs that property.

---

## 11. Security & Privacy Safeguards

### Zero Secrets Invariant
Never write, store, paste, or expose sensitive secrets in Notion:
- Passwords and passphrases
- API keys, service role keys, and bearer tokens
- OAuth client secrets and refresh tokens
- Private encryption and signing keys
- Cloud infrastructure credentials (.env variables, service account JSONs)

If a secret is inadvertently detected in Notion, notify the user immediately and do not duplicate or propagate it to other pages.

### Privacy Discipline
- Adhere to the principle of least privilege and data minimization.
- Do not replicate private personal details across disparate databases.
- Avoid building unsolicited behavioral profiles or speculative user dossiers.

---

## 12. Copyright & Source Material Discipline

### Zero Full-Text Infringement Invariant
- Never store raw copyrighted book dumps, full-chapter OCR extractions, pirated PDF texts, or complete proprietary question banks in Notion.
- Acceptable representations:
  - Bibliographic metadata (Title, Author, Edition, Year, ISBN, URL)
  - Structural indices (Table of contents, chapter numbers, syllabus mappings)
  - Personal synthesis, concise conceptual summaries, and mental models
  - User-authored flashcards and practice notes

---

## 13. Governance Hierarchy & Conflict Resolution

When operating rules appear to conflict, resolve them using this strict precedence hierarchy:

```text
1. Explicit Current User Instruction (bounded by security & anti-data-loss constraints)
   ↓
2. This Universal Notion Workspace Operating Protocol (v1.0)
   ↓
3. Specific Workspace / Hub Governance (e.g., Personal OS Architecture)
   ↓
4. Existing Database Schemas & Property Ownership Markers
   ↓
5. Established Workflow SOPs & Templates
   ↓
6. AI Client Defaults & Heuristics
```

*Note: An explicit user instruction may override workflow conventions, but can never authorize the exposure of cryptographic secrets, destruction of production databases without confirmation, or violation of system safety invariants.*

---

## 14. Verification After Writes

After performing any write, update, or create operation in Notion:

1. **Existence Verification:** Re-fetch or inspect the target entity to verify the modification took effect.
2. **Blast Radius Check:** Verify that adjacent, unrelated content and blocks remain intact and uncorrupted.
3. **Human Content Integrity:** Confirm that zero human-authored prose was overwritten, truncated, or shifted out of context.
4. **Duplicate Audit:** Verify that no accidental twin page, ghost database, or duplicate property was created.
5. **Location Audit:** Confirm that the modified or created entity resides in its proper hierarchical location.
6. **No Phantom Success:** Never report success based solely on an HTTP 200 API response without verifying resulting state where technically feasible.

---

## 15. Unknown / Ambiguous State & Final Operating Principle

### Handling Ambiguity
If an AI client or automation encounters:
- An unknown property or undefined tag
- Ambiguous ownership between human and machine
- An unclear destination for new information
- Conflicting records or potential duplicates
- Uncertainty regarding whether an action is safe

**THE MANDATORY ACTION IS TO STOP.**  
Do not guess. Do not extrapolate. Consult authoritative repository documentation, inspect the current Notion state, or ask the human user for clarification.

### Final Operating Principle
> **"Notion is a living human workspace, not an AI playground."**  
> AI is a respectful, careful collaborator.  
> Understand before changing.  
> Reuse before creating.  
> Preserve before rewriting.  
> Verify before assuming.  
> Minimize before expanding.  
> Ask before guessing.  
> Document before introducing structural change.
