---
name: personal-os-nightly-normalization
description: >-
  Reconciles Notion Daily Study Journal entries with Cloudflare D1 telemetry via
  Personal State Service (PSS) MCP tools, commits canonical state to PSS first, then
  patches machine-owned Notion properties while strictly preserving human reflections.
tools:
  - call_mcp_tool
  - view_file
  - write_to_file
  - run_command
---

# Personal OS Nightly Normalization Runbook

## 1. Objective & Operational Window
Safely normalize the concluded day's study records during the system quiescence window (00:30–02:00 IST).
Extract human qualitative inputs from the Notion Daily Study Journal, retrieve machine telemetry from PSS,
commit canonical state to Cloudflare D1 via PSS MCP tools first, and update machine-owned `[🤖]` Notion properties second.

---

## 2. Invariants & Guardrails

1. **Human Field Immutability**:
   NEVER edit, alter, overwrite, or clear properties prefixed with `[✍️]`:
   - `[✍️] Primary Focus`
   - `[✍️] Focus Quality`
   - `[✍️] Energy`
   - `[✍️] Anki Done`
   - Human journal narrative content in page body blocks (`🎯 Today's Focus`, `📖 What I Studied`, `🧩 Important Problems / Errors`, `🧠 What I Learned`, `🔁 What Needs Revision`, `✍️ Reflection`).

2. **Machine Field Authority**:
   Antigravity is the SOLE authorized updater of properties prefixed with `[🤖]` and state transitions in `[🔄]`:
   - `[🤖] Study Minutes`
   - `[🤖] Questions Attempted`
   - `[🤖] Questions Correct`
   - `[🤖] Accuracy`
   - `[🤖] OS_Entity_ID`
   - `[🔄] Day Status` ("Completed", "Partial", or "Rest")

3. **PSS-First Canonical Commit Order**:
   Always commit canonical state to PSS/D1 *before* patching Notion properties:
   `Notion Read -> Telemetry Read -> Validation -> PSS MCP Commit -> Notion Machine Patch -> Audit Artifact`.
   If PSS commit fails, abort immediately without modifying Notion (guarantees zero state drift).

4. **Deterministic Idempotency**:
   Use deterministic idempotency key format: `norm_${date}_${notionPageId}`.
   Re-running the workflow on an already-normalized day must return the cached result with zero duplicate events.

5. **Fresh-Start & Zero-Fabrication Principle**:
   Do NOT seed fake intelligence, hypothetical weaknesses, artificial mastery scores, or synthetic workload.
   The active curriculum is RRB ALP (Mathematics, Reasoning, Physics, General Science).
   Record only observed reality and explicit user assertions.

6. **Rate Limiting & Safety**:
   Respect Notion API rate limit (3 req/sec). Maintain a minimum 350ms delay between consecutive Notion API calls.

---

## 3. Execution Sequence

### Step 1: Target Date Resolution
Resolve the target normalization date in Asia/Kolkata timezone (`YYYY-MM-DD`).
If executing past midnight during the quiescence window (00:00–04:00 IST), resolve `targetDate` to the preceding calendar day.

### Step 2: Query Notion Daily Study Journal
Call `notion-mcp-server:API-post-search` with filter `{ "property": "object", "value": "page" }` or retrieve the active page in database `Daily Study Journal` (`3d8a86b6-95e7-81c2-861f-d4c51aac706f`).
Target the page matching `targetDate`.
Extract:
- `notionPageId`: Notion page UUID
- `[✍️] Primary Focus`: Rich text topic description
- `[✍️] Focus Quality`: Select (`High`, `Medium`, `Low`)
- `[✍️] Energy`: Select (`High`, `Medium`, `Low`)
- `[✍️] Anki Done`: Boolean checkbox
- `[🔄] Chapters Covered`: Relation IDs linking to `Curriculum & Progress`
- `[🤖] OS_Entity_ID`: If already populated, inspect for existing canonical session ID
- Page body blocks: Read-only extraction of study reflections (never mutate!)

### Step 3: Fetch Machine Telemetry from PSS
Query authoritative machine state via PSS MCP tools:
1. Call `personal-study-os:get_today_state` with `{ "date": targetDate, "timezone": "Asia/Kolkata" }`:
   Retrieve active study goals, completed tasks, and scheduled calendar blocks for the day.
2. Call `personal-study-os:get_recent_activity` with `{ "limit": 20 }`:
   Retrieve canonical activity events recorded today (`study_session_recorded`, `task_completed`, `schedule_adjusted`).
3. If chapters are linked, call `personal-study-os:get_chapter_state` for each `chapterId`.

### Step 4: Validate & Compute Normalized Metrics
- Verify mathematical validity: `questionsCorrect <= questionsAttempted`.
- Calculate Accuracy ratio: `questionsAttempted > 0 ? (questionsCorrect / questionsAttempted) : 0.0`.
- Derive verified study minutes: aggregate from PSS telemetry and user journal report.
- Resolve completion status:
  - `"Completed"`: Both human reflections and study session execution confirmed.
  - `"Partial"`: Incomplete session or human reflection omitted.
  - `"Rest"`: Explicit rest day.
- Provenance check: Reject ungrounded conversational noise or speculative AI inferences.

### Step 5: Commit Canonical State to PSS/D1 First
Call `personal-study-os:record_study_session` via MCP:
```json
{
  "chapterId": "<canonical_chapter_id>",
  "durationSeconds": 5400,
  "activityType": "deep_work",
  "evidenceTier": "user_reported",
  "questionsAttempted": 25,
  "questionsCorrect": 21,
  "startedAt": "2026-09-13T09:00:00.000Z",
  "endedAt": "2026-09-13T10:30:00.000Z",
  "idempotency_key": "norm_2026-09-13_3d8a86b6-95e7-80de-a2c0-e7dd3d5ff2b4"
}
```
If chapter progress changed, call `personal-study-os:update_progress` with `chapterId` and `progress`.
If chapter completed, call `personal-study-os:complete_chapter`.
Save workflow checkpoint via `personal-study-os:checkpoint` with:
```json
{
  "action": "set",
  "checkpointName": "norm_2026-09-13",
  "checkpointType": "normalization",
  "stateData": "{\"status\":\"committed\",\"sessionId\":\"sess_...\"}"
}
```
Receive the returned canonical `entityId` (`sess_...`).

### Step 6: Patch Notion Journal Properties Second
Call `notion-mcp-server:API-patch-page`:
Target: `page_id = notionPageId`
Payload properties:
- `[🤖] Study Minutes`: verified study minutes (e.g. `90`)
- `[🤖] Questions Attempted`: questions attempted (e.g. `25`)
- `[🤖] Questions Correct`: questions correct (e.g. `21`)
- `[🤖] Accuracy`: accuracy decimal ratio (e.g. `0.84` for percent format)
- `[🤖] OS_Entity_ID`: canonical `entityId` returned by PSS (`sess_...`)
- `[🔄] Day Status`: `"Completed"` (or `"Partial"`)

*Safety Guard*: Ensure the patch call omits all `[✍️]` properties and body blocks.

### Step 7: Verification & Local Audit Record
1. Verify Notion patch returned HTTP 200 with updated machine properties.
2. Write execution record to `<appDataDir>/brain/<conversation-id>/scratch/norm_${targetDate}_audit.json`:
   ```json
   {
     "date": "YYYY-MM-DD",
     "notionPageId": "...",
     "canonicalSessionId": "sess_...",
     "studyMinutes": 90,
     "questionsAttempted": 25,
     "questionsCorrect": 21,
     "accuracy": 0.84,
     "dayStatus": "Completed",
     "timestamp": "ISO_TIMESTAMP"
   }
   ```

