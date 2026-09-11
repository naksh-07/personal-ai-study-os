# Notion Human Memory Model Specification v1.0

**Personal AI Study OS: Curated Human-Readable Memory Layer**  
**Document Version:** 1.0.0  
**Status:** Approved Architectural Contract  
**Effective Date:** 2026-09-11  

---

## 1. Architectural Philosophy & Separation of Concerns

The Personal AI Study OS enforces a strict architectural boundary between **Machine Truth** and **Human Memory**:

```
+-------------------------------------------------------------------------+
|                              OPERATOR                                   |
|               (Intermittent Updates: ~2-4 times / day)                  |
+-------------------------------------------------------------------------+
         |                                                 ^
         v                                                 |
  +--------------+                                  +--------------+
  |   ChatGPT    |                                  |    Notion    |
  |  Interface   |                                  | Human Memory |
  +--------------+                                  +--------------+
         |                                                 ^
         v                                                 | (Curated Sync)
+-------------------------------------------------------------------------+
|                  Cloudflare Worker / Core Engine                        |
|   - Event-driven, intermittent execution                                |
|   - Zero raw chat log storage                                           |
|   - Zero raw CoT (chain-of-thought) persistence                         |
+-------------------------------------------------------------------------+
         |                                                 |
         v                                                 v
  +--------------+                                  +--------------+
  | Cloudflare   |                                  | External     |
  | D1 Database  |                                  | Specialists  |
  | Machine      |                                  | - Antigravity|
  | Truth (24 T) |                                  | - StudySource|
  +--------------+                                  +--------------+
```

### Core Axioms
1. **D1 is Machine Truth:** Authoritative, ACID-compliant, append-only canonical event store (24 tables). All progress calculations, accuracy scores, idempotency records, and distributed leases live in D1.
2. **Notion is Human-Readable Memory:** Notion is a curated executive dashboard and reflective workspace for the operator, **not** an exhaustive telemetry sink. Raw database dumps and minute-by-minute system logs are strictly prohibited from entering Notion.
3. **Intermittent Human Interaction:** The human operates intermittently (2–4 meaningful touchpoints per day: morning briefing, post-study recording, milestone completion, evening review). The system never polls ChatGPT or runs persistent synchronous loops.
4. **Zero Full-Text Copyright Invariant:** Neither D1 nor Notion stores copyrighted full-text book pages, dumps, or pirated PDF contents. Only structural metadata (title, author, edition, chapter number, page references) and canonical curriculum mappings are retained.

---

## 2. External Integration Roles

| System | Role | Scope | Invariant |
| :--- | :--- | :--- | :--- |
| **D1 Database** | Machine Truth | Authoritative state, 24 relational tables | Strict schema, atomic projections, ACID transactions |
| **Notion** | Human Memory | 5 Curated Databases for review & reflection | Curated memory; no raw machine telemetry |
| **Google Tasks** | WHAT | Date-level actionable work items | Synced with chapters and active project tasks |
| **Google Calendar** | WHEN | Intra-day time blocks and study scheduling | Fixed start/end timestamps |
| **Antigravity** | Technical Execution | Autonomous code, infra, and refactoring runs | State recorded in `agent_runs` & `projects` |
| **StudySourceCore** | Source Specialist | Curricula analysis, TOC parsing, mapping | Zero full text stored; metadata & mappings only |

---

## 3. The 5 Curated Notion Databases

To prevent database bloat and cognitive overload, Notion memory is structured into exactly five high-value curated databases:

### Database 1: Study History (`study_history`)
* **Purpose:** Summarizes completed study sessions, daily accomplishments, and qualitative study notes.
* **Granularity:** One page per completed study session or consolidated daily study block.
* **Fields:**
  * `Session Title` (Title): Machine suggested, human editable (`[Subject] Chapter Name - Session`)
  * `OS_Entity_ID` (Text, Unique): `sess_...` canonical identifier (`MACHINE_OWNED`)
  * `Date & Time` (Date): Session start and end timestamp (`MACHINE_OWNED`)
  * `Subject` (Relation -> Curriculum): Linked subject (`MACHINE_OWNED`)
  * `Chapter` (Relation -> Curriculum): Linked chapter (`MACHINE_OWNED`)
  * `Duration (Minutes)` (Number): Net study duration (`MACHINE_OWNED`)
  * `Activity Type` (Select): `deep_work`, `pyq_practice`, `revision`, `lecture` (`MACHINE_OWNED`)
  * `Questions Attempted` (Number): Optional practice count (`MACHINE_OWNED`)
  * `Questions Correct` (Number): Optional practice count (`MACHINE_OWNED`)
  * `Accuracy` (Formula/Number): Computed accuracy percentage (`DERIVED`)
  * `Human Reflections` (Rich Text / Page Body): Freeform notes, insights, roadblocks (`HUMAN_OWNED`)
  * `Energy / Focus Level` (Select): `High`, `Medium`, `Low` (`HUMAN_OWNED`)

### Database 2: Curriculum & Progress (`curriculum_progress`)
* **Purpose:** High-level status of the master curriculum (subjects and canonical chapters).
* **Granularity:** One page per subject and canonical chapter.
* **Fields:**
  * `Chapter / Subject Name` (Title): Canonical name (`SHARED`)
  * `OS_Entity_ID` (Text, Unique): `chap_...` or `subj_...` (`MACHINE_OWNED`)
  * `Type` (Select): `Subject` or `Chapter` (`MACHINE_OWNED`)
  * `Parent Subject` (Relation -> Self): Recursive hierarchy (`MACHINE_OWNED`)
  * `Status` (Status): `Not Started`, `In Progress`, `Mastered`, `Needs Review` (`SHARED`)
  * `Completion %` (Number): Projected completion score (0–100%) (`MACHINE_OWNED`)
  * `Total Minutes Studied` (Rollup/Number): Total time invested (`DERIVED`)
  * `Practice Accuracy` (Number): Historical practice accuracy (`MACHINE_OWNED`)
  * `Target Exam Weight` (Select): `High Yield`, `Medium Yield`, `Low Yield` (`HUMAN_OWNED`)
  * `Personal Priority` (Select): `P1`, `P2`, `P3` (`HUMAN_OWNED`)
  * `Study Source References` (Relation -> Research & Sources): Mapped books/notes (`DERIVED`)

### Database 3: Weak Areas & Observations (`weak_areas_observations`)
* **Purpose:** Targeted tracking of knowledge gaps, difficult questions, and conceptual stumbling blocks.
* **Granularity:** One page per flagged weak topic or recurring conceptual error.
* **Fields:**
  * `Concept / Problem` (Title): Topic or error description (`SHARED`)
  * `OS_Entity_ID` (Text, Unique): `mem_...` canonical memory fact ID (`MACHINE_OWNED`)
  * `Related Chapter` (Relation -> Curriculum): Associated chapter (`MACHINE_OWNED`)
  * `Category` (Select): `constraint`, `pattern`, `preference`, `convention` (`MACHINE_OWNED`)
  * `Severity` (Select): `Critical`, `Moderate`, `Minor` (`HUMAN_OWNED`)
  * `Error Pattern Notes` (Rich Text): Why the error happened (`HUMAN_OWNED`)
  * `Remediation Plan` (Rich Text): How the operator plans to fix it (`HUMAN_OWNED`)
  * `Resolved` (Checkbox): Review completion flag (`HUMAN_OWNED`)
  * `Last Observed Date` (Date): Timestamp when machine detected low accuracy (`MACHINE_OWNED`)

### Database 4: Research & Knowledge Notes (`research_knowledge`)
* **Purpose:** Durable research takeaways, study source metadata, and distilled summaries.
* **Granularity:** One page per research topic or external study source.
* **Fields:**
  * `Topic / Source Title` (Title): Research topic or book title (`SHARED`)
  * `OS_Entity_ID` (Text, Unique): `resevt_...` or `src_...` (`MACHINE_OWNED`)
  * `Entry Type` (Select): `Research Takeaway`, `Source Metadata`, `Reference Link` (`MACHINE_OWNED`)
  * `Source Identifier` (Text): Author, publication, or official syllabus URI (`MACHINE_OWNED`)
  * `Key Takeaways` (Rich Text): Synthesized high-yield summary (`SHARED`)
  * `Mapped Chapters` (Relation -> Curriculum): Relevant curriculum areas (`MACHINE_OWNED`)
  * `Human Commentary` (Page Body): Detailed notes and synthetic explanations (`HUMAN_OWNED`)
  * `Zero Copyright Declaration` (Checkbox): Explicit confirmation that no copyrighted text is pasted (`MACHINE_OWNED`)

### Database 5: Projects & Decisions (`projects_decisions`)
* **Purpose:** Major milestones, initiatives, and durable architectural/personal decisions.
* **Granularity:** One page per project or major decision.
* **Fields:**
  * `Title` (Title): Project name or Decision title (`SHARED`)
  * `OS_Entity_ID` (Text, Unique): `proj_...` or `dec_...` (`MACHINE_OWNED`)
  * `Classification` (Select): `Project`, `Decision Record` (`MACHINE_OWNED`)
  * `Status` (Status): `Planned`, `Active`, `Paused`, `Completed`, `Cancelled` (`SHARED`)
  * `Decision Context` (Rich Text): Background driving the decision (`SHARED`)
  * `Decision Made` (Rich Text): Core choice selected (`SHARED`)
  * `Consequences` (Rich Text): Expected outcomes / trade-offs (`SHARED`)
  * `Target Completion Date` (Date): Deadline (`HUMAN_OWNED`)
  * `Operator Reflections` (Page Body): Post-mortem notes and reflections (`HUMAN_OWNED`)

---

## 4. Field Classification Matrix & Ownership Rules

Every Notion property belongs to exactly one ownership class:

```
+-------------------+--------------------------------------------------------------+
| Class             | Ownership & Conflict Invariant                               |
+-------------------+--------------------------------------------------------------+
| MACHINE_OWNED     | D1 is authoritative. Updated exclusively by Cloudflare       |
|                   | Worker sync queue. Manual human edits are reverted on sync.   |
+-------------------+--------------------------------------------------------------+
| HUMAN_OWNED       | Operator is authoritative. Machine sync MUST NEVER mutate,   |
|                   | overwrite, or truncate these properties or the page body.    |
+-------------------+--------------------------------------------------------------+
| DERIVED           | Computed automatically by Notion Formulas, Rollups, or D1    |
|                   | projection views. Non-editable.                             |
+-------------------+--------------------------------------------------------------+
| SHARED            | Initialized with machine default during creation; operator   |
|                   | may refine or adjust. Webhook updates propagate back to D1.  |
+-------------------+--------------------------------------------------------------+
```

### Safety Rules
1. **Safe-Create Gate:** When the outbox consumer creates a page in Notion, it queries by `OS_Entity_ID` first. If a page already exists, it updates `MACHINE_OWNED` fields only and **never duplicates the page**.
2. **Page Body Protection:** The main body text of Notion pages is **100% `HUMAN_OWNED`**. Machine workers never overwrite or clear the child blocks of existing Notion pages.
3. **Concurrency Control:** Updates verify `last_edited_time` / version token before patching Notion properties to prevent race conditions with active operator edits.

---

## 5. Bidirectional Synchronization Protocol

### D1 -> Notion (Outbox Worker)
1. Event recorded in D1 (`study_session_recorded`, `chapter_completed`, `source_registered`, `project_updated`, etc.).
2. Transaction inserts row into `sync_jobs` table (`target_system = 'notion'`).
3. Cloudflare Queue consumer picks up job, acquires distributed lease with jittered backoff.
4. Token bucket rate limiter throttles API calls to **3 requests/second**.
5. Page is created or updated in the corresponding Notion database using `OS_Entity_ID`.
6. Job status updated to `COMPLETED` or routed to `DLQ` after 5 failed attempts.

### Notion -> D1 (Secure Webhook Pipeline)
1. Human edits a `SHARED` property in Notion (e.g. changes chapter status to `Mastered`).
2. Notion sends HTTP POST to `POST /v1/admin/webhooks/notion`.
3. Worker executes **6-Stage Security Pipeline**:
   * **Stage 1 (Rate Limiting):** Cloudflare WAF / worker rate limiter.
   * **Stage 2 (HMAC Signature):** Constant-time comparison using `NOTION_WEBHOOK_SECRET`.
   * **Stage 3 (Payload Validation):** Zod schema validation (`NotionWebhookPayloadSchema`).
   * **Stage 4 (Replay Defense):** Idempotency claim on `webhook_notion_<event_id>`.
   * **Stage 5 (Staleness Check):** Reject payloads older than 300 seconds.
   * **Stage 6 (Canonical Ingestion):** Ingest canonical event (`status_changed`) into D1.

---

## 6. Human Configuration Checklist (Setup Instructions)

When connecting a real Notion workspace to the Personal AI Study OS, complete the following manual checklist:

### Phase 1: Create Internal Integration
1. Log into [Notion Developers Portal](https://www.notion.so/my-integrations).
2. Click **"+ New integration"**.
3. Name: `Personal AI Study OS Core`.
4. Associated workspace: Select your private study workspace.
5. Type: **Internal**.
6. Capabilities required:
   * [x] Read content
   * [x] Update content
   * [x] Insert content
   * [x] Read user information without email addresses
7. Click **Save** and copy the **Internal Integration Secret** (`secret_...`).

### Phase 2: Create Databases & Grant Access
1. In your Notion workspace, create a dedicated parent page titled **"Personal AI Study OS"**.
2. Create the 5 curated databases within this page:
   * `Study History`
   * `Curriculum & Progress`
   * `Weak Areas & Observations`
   * `Research & Knowledge Notes`
   * `Projects & Decisions`
3. Configure the exact property names and types detailed in Section 3 of this document.
4. In each database page, click the `...` menu in the top right -> **"Connections"** -> Add **"Personal AI Study OS Core"**.
5. Copy the 32-character Database ID from the URL of each database (`notion.so/<workspace>/<DATABASE_ID>?v=...`).

### Phase 3: Inject Secrets into Cloudflare Worker
Deploy the configuration variables using Wrangler CLI:

```bash
# Set Notion Integration API Token
npx wrangler secret put NOTION_API_KEY
# Enter: secret_...

# Set Notion Webhook Signing Secret (if webhooks enabled)
npx wrangler secret put NOTION_WEBHOOK_SECRET
# Enter: whsec_...

# Set Database IDs in wrangler.toml or as environment secrets
npx wrangler secret put NOTION_STUDY_HISTORY_DB_ID
npx wrangler secret put NOTION_CURRICULUM_DB_ID
npx wrangler secret put NOTION_WEAK_AREAS_DB_ID
npx wrangler secret put NOTION_RESEARCH_DB_ID
npx wrangler secret put NOTION_PROJECTS_DB_ID
```

---

## 7. Verification & Compliance Verification

| Checkpoint | Target Standard | Compliance Verification |
| :--- | :--- | :--- |
| **Telemetry Leakage** | Zero raw logs in Notion | Verified: Only curated semantic events synced |
| **Chat History Storage** | Zero chat transcripts | Verified: No conversation tables exist in D1 or Notion |
| **Copyright Protection** | Zero full-text book content | Verified: `reference_uri` pointers only; no text storage |
| **Human Edit Safety** | Zero clobbering of human text | Verified: `HUMAN_OWNED` fields & body blocks protected |
| **Rate Limit Compliance** | <= 3 req/sec to Notion API | Verified: Token bucket limiter in `NotionAdapter` |
