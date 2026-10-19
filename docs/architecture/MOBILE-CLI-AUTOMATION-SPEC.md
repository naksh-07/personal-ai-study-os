# Mobile CLI Automation & Zero-Idle MCP Architecture Specification

**System Version:** 1.2.3  
**Status:** **OPERATIONAL & PRODUCTION-ACTIVE**  
**Execution Environment:** Termux on Android (ARM64)  
**Primary Engine:** Google Antigravity CLI (`agy`)  
**Cognitive Model:** Gemini 3.8 Flash (High / Low)  

---

## 1. Architectural Motivation & Problem Statement

Prior iterations of the Personal AI Study OS relied on a fragmented multi-client setup:
1. **Gemini Spark Web:** User custom instructions and manual web routines for morning scheduling.
2. **PC Antigravity Workstation:** Nightly normalization and maintenance sweeps executed on a desktop machine.
3. **Heavy Node.js MCP Servers:** Running persistent Node.js/NPX MCP servers (`@cloudflare/mcp-server-cloudflare`, `@aaronsb/google-workspace-mcp`, `@notionhq/notion-mcp-server`, etc.) consumed **750MB–850MB+ of background RAM**, exhausting mobile memory and triggering Android Low Memory Killer (LMK) kills.

This specification documents the consolidation of all scheduling, dynamic recovery, and nightly normalization workflows directly into **Antigravity CLI (`agy`)** running natively on Android Termux with **Zero-Idle RAM consumption**.

---

## 2. Universal Zero-Idle Lazy MCP Supervisor (`lazy_mcp_supervisor.py`)

Inspired by open-source MCP process supervisor designs (`mcprt`) and schema decoupling patterns (`lazy-mcp`), the Termux runtime introduces `lazy_mcp_supervisor.py`:

```text
┌─────────────────────────────────────────────────────────────────┐
│                    ANTIGRAVITY CLI (`agy`)                      │
└────────────────────────────────┬────────────────────────────────┘
                                 │ stdio JSON-RPC
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                 lazy_mcp_supervisor.py (Python)                 │
├────────────────────────────────┬────────────────────────────────┤
│ 1. Handshake & tools/list      │ 2. tools/call                  │
│    Reads schema cache on disk  │    Spawns child Node process   │
│    Response latency: < 2ms     │    Forwards call over pipe     │
│    Child Process: NONE         │    Pipes response back to agy  │
│    RAM footprint: ~12 MB       │    Starts 60s idle countdown   │
└────────────────────────────────┴────────────────────────────────┘
                                 │
                   (Inactivity timer reaches 60s)
                                 ▼
                 ⚡ SIGKILL Child Node Process!
                 Reclaim 100MB+ RAM to Android OS!
```

### 2.1 Schema Decoupling
MCP clients query `initialize` and `tools/list` on launch. Standard servers spawn their heavy runtime immediately, keeping V8 isolates in RAM forever.
The Lazy Supervisor caches tool definitions in `~/.cache/lazy_mcp_schemas/<name>.json` (or reads `~/.gemini/antigravity-cli/mcp/<name>/*.json`), answering `tools/list` instantly without spawning Node.js.

### 2.2 Auto-Harvester (60-Second Grace Period)
When a `tools/call` occurs:
1. The supervisor launches the underlying command (e.g. `npx -y @cloudflare/mcp-server-cloudflare run ...`).
2. Performs the initialize handshake and forwards the tool call.
3. Once the call finishes, a background reaper thread monitors inactivity.
4. If no new calls arrive within **60 seconds**, the child process is terminated (`SIGTERM` followed by `SIGKILL`), immediately reclaiming RAM back to Android OS.

### 2.3 Supervised Fleet (8 Servers Protected)
1. `cloudflare` (~120MB saved)
2. `google-workspace` (~110MB saved)
3. `notion-mcp-server` (~85MB saved)
4. `github-mcp-server` (~85MB saved)
5. `context7` (~80MB saved)
6. `tavily` (~75MB saved)
7. `sequential-thinking` (~70MB saved)
8. `memory` (~70MB saved)

**Total Idle Savings:** **~750MB to 850MB+ RAM permanently reclaimed.**

---

## 3. Specialized Mobile Agents & Skills

All cognitive scheduling, recovery, and normalization tasks are implemented as native Antigravity agents running with **Gemini 3.8 Flash**:

### 3.1 `personal-os-morning-scheduler`
- **Agent:** `~/.gemini/config/agents/personal-os-morning-scheduler/agent.md`
- **Skill:** `~/.gemini/config/skills/personal-os-morning-scheduler/SKILL.md`
- **Trigger:** Daily at 07:00 AM IST via `~/bin/study-os-morning-scheduler.sh`.
- **Workflow:**
  1. Queries PSS MCP `get_study_state` for authoritative day classification, capacity, and pending workload.
  2. Inspects Google Calendar (WHEN) and Google Tasks (WHAT).
  3. Allocates focus blocks (`[Study OS]`), snaps to 15m grid, enforces maximum 5 mutations.
  4. Commits decisions to PSS (`record_schedule_decision`) with idempotency key `sched_${date}_morning`.
  5. Updates Notion Daily Study Journal under `## 🤖 Morning Tactical Schedule`.
  6. Mirrors schedule to `/storage/emulated/0/Documents/Termux/Reports/`.

### 3.2 `personal-os-dynamic-replanner`
- **Agent:** `~/.gemini/config/agents/personal-os-dynamic-replanner/agent.md`
- **Skill:** `~/.gemini/config/skills/personal-os-dynamic-replanner/SKILL.md`
- **Trigger:** Interactive / On-demand whenever a schedule disruption is declared.
- **Workflow:**
  1. Parses declared wake/sleep shifts or missed study time.
  2. Invokes PSS `replan_day` MCP capability.
  3. PSS executes priority evictions (P8 Secondary → P7 Rotation B → P5 Rotation A) while rigorously defending **P2 (Mathematics)** and **P3 (Reasoning)**.
  4. Applies calendar modifications (max 5 adjustments) and refreshes Notion Daily Study Journal.

### 3.3 `personal-os-nightly-normalizer`
- **Agent:** `~/.gemini/config/agents/personal-os-nightly-normalizer/agent.md`
- **Skill:** `~/.gemini/config/skills/personal-os-nightly-normalization/SKILL.md`
- **Trigger:** Daily at 12:00 AM IST (quiescence window: 00:00–02:00 IST) via `~/bin/study-os-nightly-normalizer.sh`.
- **Workflow:**
  1. Reads human reflections from Notion Daily Study Journal.
  2. Fetches machine telemetry from PSS (`get_today_state`, `get_recent_activity`).
  3. Commits canonical normalized study session to Cloudflare D1 via PSS MCP first (`record_study_session`).
  4. Patches machine-owned Notion properties (`[🤖]`), strictly preserving human-owned `[✍️]` properties and reflection body blocks.

---

## 4. Headless Execution Engine & Aliases

The automation scripts are located in `~/bin/` with `chmod +x`:

| Script | Execution Time | Purpose |
| :--- | :--- | :--- |
| `~/bin/study-os-morning-scheduler.sh` | 07:00 AM IST | Autonomous headless execution of morning tactical planning. |
| `~/bin/study-os-nightly-normalizer.sh` | 12:00 AM IST | Autonomous headless execution of nightly reconciliation. |
| `~/bin/study-os-status.sh` | On-Demand | Health check querying Cloudflare `/health`, `/v1/status`, and MCP states. |

### Diagnostic Aliases (`~/.bashrc`):
```bash
alias mcp-mem='ps aux | grep -E "node|npx|lazy_mcp|agy|python" | grep -v grep'
alias mcp-reap='pkill -f "npx -y" && pkill -f "@modelcontextprotocol" && echo "⚡ All active MCP child processes harvested!"'
```
