# Personal AI Study OS
## Dynamic Day Replanning & Variable Wake/Sleep Policy v1.0
### Comprehensive Implementation & Verification Report

- **Policy Document**: `/Personal-AI-Study-OS/02-ARCHITECTURE/DYNAMIC-DAY-REPLANNING-VARIABLE-WAKE-SLEEP-POLICY-v1.0.md`
- **Status**: IMPLEMENTED & FULLY VERIFIED
- **Date**: 2026-09-13
- **Test Results**: 374/374 Tests Passing (100% Suite Pass Rate across 24 Test Files)
- **TypeScript**: 0 Errors (`tsc --noEmit` clean)
- **Database Migrations**: ZERO DDL Added / Altered (27 Tables Strictly Preserved)

---

## 1. Executive Summary

This report documents the completed implementation of the **Dynamic Day Replanning & Variable Wake/Sleep Policy v1.0** for the Personal AI Study OS. The implementation faithfully honors all architectural constraints, system boundaries, epistemic hierarchies, priority ladders, cognitive ceilings, and zero-DDL mandates set forth in the finalized policy.

The system dynamically adapts daily study timetables to real-world wake and sleep shifts, midday delays, or interruptions while rigorously defending core cognitive anchors (P2 Maths, P3 Reasoning, P4 Consolidation), respecting the 270-minute cognitive deep work ceiling, enforcing the 120-minute rolling freeze window, snapping all scheduled containers to the 15-minute grid, and preserving sleep hygiene by separating study cutoff (`windDownStart`) from biological sleep (`targetSleep`).

---

## 2. Strict Architectural Boundaries & Ownership

| System / Boundary | Responsibility | Invariant Maintained |
| :--- | :--- | :--- |
| **Google Tasks** | **WHAT** to study (Task backlog & completion states) | **No automatic rollover**: Missed containers leave Google Tasks in `needsAction` state. Schedulers never reschedule or alter task states. |
| **Google Calendar** | **WHEN** to study (Time allocations & event blocks) | **Calendar = WHEN**: Surgical sync of focus blocks. Respects human-locked blocks (`isLocked = true`) and freeze windows. |
| **Gemini Spark** | **SCHEDULE** Intelligence (Timetable synthesis & optimization) | Proposes replans within policy constraints via MCP tools. |
| **Personal State Service (PSS)** | **State & Policy Engine** (Validation, atomicity, idempotency) | Enforces 270m cognitive cap, freeze windows, epistemic hierarchy, and atomic persistence. |
| **Cloudflare D1** | **Machine Truth** (27 immutable and projected tables) | **Zero DDL**: Uses existing `canonical_events`, `daily_states.state_payload`, `decisions`, and `calendar_links`. |
| **Notion** | **Human Context & Journal** (Mirror of machine truth) | Markdown timetable snapshot and journal entry serialized in `daily_states.state_payload`. |

---

## 3. Epistemic Hierarchy Implementation

The system resolves the daily state (`DayStateProfile`) using a strict 3-tier epistemic hierarchy:

```
                  ┌──────────────────────────────────────────────┐
                  │ TIER 1: User-Reported Fact                   │
                  │ (declaredWake / declaredSleep params)        │
                  └──────────────────────┬───────────────────────┘
                                         │ (if absent)
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │ TIER 2: Actually Available Telemetry         │
                  │ (day_boundary_shifted / study session events) │
                  └──────────────────────┬───────────────────────┘
                                         │ (if absent)
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │ TIER 3: Blueprint Fallback                   │
                  │ (07:00 IST nominal wake / 23:00 IST sleep)   │
                  └──────────────────────────────────────────────┘
```

> [!IMPORTANT]
> **Strict Negative Constraint Enforced**: Schedulers **never** infer wake time from the first calendar event. Early calendar events (e.g., gym, personal routine) do not shift study wake times.

---

## 4. Key Implementation Components

### 4.1 Domain Layer (`packages/domain`)
- **`DayClassificationSchema`**: `['NORMAL', 'SHORT_DAY', 'LATE_START', 'EARLY_START', 'EXTENDED_DAY']`
- **`MIN_VIABLE_CONTAINER_DURATIONS`**:
  - `maths_anchor`: 60m (floor 45m in high compression)
  - `reasoning_anchor`: 60m (floor 45m in high compression)
  - `academic_rotation_a`: 45m (floor 30m)
  - `academic_rotation_b`: 45m (floor 30m)
  - `consolidation`: 30m
  - `secondary_activity`: 45m (floor 20m)
  - `night_retrieval`: 30m (floor 20m)
- **`DayStateProfileSchema`**: 15 authoritative day-state attributes including `actualWake`, `windDownStart`, `targetSleep`, `availablePhysicalMinutes`, `remainingDeepWorkCapacityMinutes`, `classifications`, `viableContainers`, `lockedCalendarBlocks`.
- **`DayBoundaryShiftedPayloadSchema`**: Canonical event contract capturing `wakeTime`, `sleepTime`, `windDownStart`, `mode`, `reason`.

### 4.2 Core Engine (`packages/core/src/dynamic-replanning.ts`)
- **`DayStateResolver`**:
  - Evaluates epistemic hierarchy.
  - Distinguishes `windDownStart` (22:20 IST study cutoff) from `targetSleep` (23:00 IST biological sleep).
  - Respects morning routine buffer (45m) before first study block.
  - Detects locked blocks via explicit lock and 120-minute rolling freeze window (`currentTime` to `currentTime + 120m`).
- **`DynamicDayClassifier`**:
  - Classifies day types relative to available physical capacity, late starts (>= 15m or >= 60m), early sleep (<= 22:30), extended days (past midnight).
- **`DynamicReplanningEngine`**:
  - **Scope Determination**: Local repair (delay <= 60m & <= 1 container affected) vs. Whole-day replan (delay > 60m, >= 2 consecutive delays, or forced).
  - **Priority Eviction Ladder**: Evicts P8 `secondary_activity` -> P7 `academic_rotation_b` -> P5 `academic_rotation_a` -> P6 `night_retrieval`. Defends P2 `maths_anchor`, P3 `reasoning_anchor`, P4 `consolidation`.
  - **15-Minute Grid Snapping**: Snaps all container starts and ends to `:00`, `:15`, `:30`, `:45`.
  - **Decompression Buffers**: Enforces 15-minute buffers between study containers.
  - **Ceiling Protections**: 270-minute cognitive deep work planning cap; 90-minute continuous focus session cap.
  - **Notion Journal Formatting**: Generates clean Markdown journal entries reflecting replan rationale, active focus containers, deferred containers, and daily metrics.

### 4.3 Service & Projection Integration (`packages/core/src/personal-state-service.ts` & `projection-engine.ts`)
- **`resolveDayState(params)`**: Semantic read method exposing authoritative `DayStateProfile`.
- **`replanDay(params, idempotency)`**: Idempotent write operation:
  1. Computes `DynamicReplanProposal`.
  2. Emits `day_boundary_shifted` canonical event.
  3. Records replan decision in `decisions` table.
  4. Emits `schedule_missed` canonical events for evicted/dropped containers (writing 0 `study_sessions` rows).
  5. Upserts scheduled containers to `calendar_links`.
  6. Updates `daily_states.state_payload` with `dayState`, `classifications`, and `notionJournalMarkdown`.
- **`ProjectionEngine`**: Handles `day_boundary_shifted` events in both streaming projection and deterministic replay (`rebuildProjections`).
- **`getScheduleContext(params)`**: Enriched to return the active `dayState`.

### 4.4 Worker MCP Server (`apps/worker/src/mcp/server.ts`)
- **`get_dynamic_day_state`** (`read` scope): Returns `DayStateProfile`.
- **`replan_day`** (`write` scope): Dispatches dynamic replanning with idempotency support.

---

## 5. Comprehensive Verification Matrix

All 29 dedicated dynamic replanning scenarios plus existing regression suites pass with 100% success rate:

| Test Group / Scenario | Description | Status |
| :--- | :--- | :--- |
| **Schema Invariant** | Asserts exactly 27 tables exist in D1 SQLite master; zero table proliferation | ✅ PASS |
| **Epistemic Tier 1** | Explicit user-reported wake (`08:30`) overrides telemetry and nominal fallback | ✅ PASS |
| **Epistemic Tier 2** | Canonical activity telemetry (`07:45`) used when user declaration is absent | ✅ PASS |
| **Epistemic Tier 3** | Blueprint fallback (`07:00`) applied when neither declaration nor telemetry exists | ✅ PASS |
| **Prohibition Check** | Verifies early calendar event (`06:00`) never causes wake inference | ✅ PASS |
| **Wind-Down Separation** | `windDownStart` (`22:20`) strictly separated from `targetSleep` (`23:00`) | ✅ PASS |
| **Wind-Down Inviolability** | No study session scheduled past `windDownStart` | ✅ PASS |
| **Scenario A** | Normal Day: nominal wake 07:00, sleep 23:00, all containers fit, <= 270m | ✅ PASS |
| **Scenario B** | Late Wake (08:00): routine buffer respected, study starts 08:45, `LATE_START` | ✅ PASS |
| **Scenario C** | Very Late Wake (10:00 & 12:00): `SHORT_DAY`, priority eviction of P8 & P7, core defended | ✅ PASS |
| **Scenario D** | Early Wake (05:30): `EARLY_START`, 270m cognitive ceiling enforced | ✅ PASS |
| **Scenario E** | Late Sleep Declaration (01:30): `EXTENDED_DAY`, 270m cognitive ceiling enforced | ✅ PASS |
| **Scenario F** | Early Sleep Declaration (21:30): `SHORT_DAY`, wind-down moved to 20:50, night containers evicted | ✅ PASS |
| **Priority Eviction Ladder** | Strictly evicts P8 -> P7 -> P5 -> P6 while defending P2, P3, P4 | ✅ PASS |
| **Non-Sub-Minimum Floor** | Enforces minimum viable container durations under compression | ✅ PASS |
| **Scenario O** | Enforces 270-minute daily cognitive deep work ceiling as scheduling cap | ✅ PASS |
| **Scenario P** | Enforces 90-minute continuous session ceiling | ✅ PASS |
| **Scenario Q** | Autonomous scheduler preserves blocks within 120-minute rolling freeze window | ✅ PASS |
| **Scenario S** | Human authorization overrides rolling freeze window for future events | ✅ PASS |
| **Scenario R** | Human-locked calendar block (`isLocked = true`) strictly preserved | ✅ PASS |
| **Grid Snapping** | All container start and end times snapped to 15-minute grid (`:00, :15, :30, :45`) | ✅ PASS |
| **Decompression Buffers** | Minimum 15-minute gap enforced between scheduled study blocks | ✅ PASS |
| **Scenario U** | Idempotency: repeated replan with identical inputs returns cached result (`replayed: true`) | ✅ PASS |
| **Scenario I & T** | Missed container emits `schedule_missed`, writes 0 `study_sessions`, tasks remain in Tasks | ✅ PASS |
| **Scenario W** | Updates `calendar_links` with stable IDs and persists decision in `decisions` table | ✅ PASS |
| **Scenario V** | `getScheduleContext` reports `dayState` and conflict-free schedule | ✅ PASS |
| **Scenario H** | Repeated small delays (>= 2 consecutive delays) triggers `WHOLE_DAY_REPLAN` | ✅ PASS |
| **Notion Journal** | Formatted Markdown journal snapshot saved in `daily_states.state_payload` | ✅ PASS |
| **Timezone Rigor** | `Asia/Kolkata` (UTC+5:30) and midnight UTC boundary crossings verified | ✅ PASS |

---

## 6. Build & Quality Verification

- **Vitest Suite**:
  ```
  Test Files  24 passed (24)
       Tests  374 passed (374)
    Duration  3.87s
  ```
- **TypeScript Compilation**:
  ```
  > personal-ai-study-os@1.0.0 typecheck
  > tsc --noEmit
  (0 errors)
  ```
- **Lint Check**: Passed cleanly.
- **Production Build**: Passed cleanly.
- **Zero-DDL Check**: No changes to `apps/worker/migrations/`.
