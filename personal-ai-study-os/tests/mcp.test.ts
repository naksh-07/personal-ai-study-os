import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase, TestContext } from './test-helper';
import app from '../apps/worker/src/index';
import { EntitiesRepository } from '@personal-os/db';
import { Subject, Chapter, Project } from '@personal-os/domain';

describe('Slice 4: Remote MCP Server (Streamable HTTP 2026-07-28 & Semantic Tools)', () => {
  let ctx: TestContext;

  const testSubjectId = 'subj_anatomy';
  const testChapterId = 'chap_cardiovascular';
  const testProjectId = 'proj_neet_prep';

  function makeJwt(payload: Record<string, any>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.mock_signature`;
  }

  const readToken = makeJwt({
    sub: 'usr_operator',
    aud: 'personal-ai-study-os',
    scope: 'read',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const writeToken = makeJwt({
    sub: 'usr_operator',
    aud: 'personal-ai-study-os',
    scope: 'read write',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const adminToken = makeJwt({
    sub: 'usr_operator',
    aud: 'personal-ai-study-os',
    scope: 'read write admin',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const invalidAudienceToken = makeJwt({
    sub: 'usr_operator',
    aud: 'https://evil.attacker.com',
    scope: 'read write admin',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const makeEnv = () => ({
    DB: ctx.d1,
    ENVIRONMENT: 'test',
  });

  beforeEach(async () => {
    ctx = createTestDatabase();
    const now = new Date().toISOString();

    await EntitiesRepository.insertUser(ctx.db, {
      id: 'usr_operator',
      timezone: 'UTC',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });

    const subject: Subject = {
      id: testSubjectId,
      name: 'Anatomy',
      slug: 'anatomy',
      description: 'Human anatomy and histology',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await EntitiesRepository.insertSubject(ctx.db, subject);

    const chapter: Chapter = {
      id: testChapterId,
      subjectId: testSubjectId,
      name: 'Cardiovascular System',
      slug: 'cardiovascular-system',
      progress: 0,
      status: 'not_started',
      createdAt: now,
      updatedAt: now,
    };
    await EntitiesRepository.insertChapter(ctx.db, chapter);

    const project: Project = {
      id: testProjectId,
      name: 'NEET PG Prep',
      description: 'Primary medical entrance preparation',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await EntitiesRepository.insertProject(ctx.db, project);
  });

  describe('Streamable HTTP Protocol (POST /mcp)', () => {
    it('initializes MCP session with protocolVersion 2026-07-28', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${readToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'req_init_1',
          method: 'initialize',
          params: {
            protocolVersion: '2026-07-28',
            capabilities: {},
            clientInfo: { name: 'Claude Desktop', version: '1.0.0' },
          },
        }),
      }, makeEnv());

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.jsonrpc).toBe('2.0');
      expect(json.id).toBe('req_init_1');
      expect(json.result.protocolVersion).toBe('2026-07-28');
      expect(json.result.serverInfo.name).toBe('personal-ai-study-os');
      expect(json.result.capabilities.tools).toBeDefined();
    });

    it('handles ping and notifications/initialized', async () => {
      const pingRes = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${readToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'req_ping_1',
          method: 'ping',
        }),
      }, makeEnv());

      expect(pingRes.status).toBe(200);
      const pingJson: any = await pingRes.json();
      expect(pingJson.result).toEqual({});

      const notifRes = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${readToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      }, makeEnv());

      expect(notifRes.status).toBe(200);
    });

    it('returns text/event-stream when Accept header specifies text/event-stream', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${readToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'req_stream_1',
          method: 'ping',
        }),
      }, makeEnv());

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/event-stream');
      const text = await res.text();
      expect(text).toContain('event: message');
      expect(text).toContain('"id":"req_stream_1"');
    });

    it('rejects unauthenticated requests with 401', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          method: 'tools/list',
        }),
      }, makeEnv());

      expect(res.status).toBe(401);
    });

    it('rejects invalid audience token with 403 AUDIENCE_MISMATCH', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${invalidAudienceToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          method: 'tools/list',
        }),
      }, makeEnv());

      expect(res.status).toBe(403);
      const json: any = await res.json();
      expect(json.error.code).toBe('AUDIENCE_MISMATCH');
    });
  });

  describe('Tool Registry & Raw SQL Prohibition', () => {
    it('lists all 19 semantic tools via tools/list', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${readToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'req_tools_list',
          method: 'tools/list',
        }),
      }, makeEnv());

      expect(res.status).toBe(200);
      const json: any = await res.json();
      const tools = json.result.tools;
      expect(tools.length).toBe(26);

      const toolNames = tools.map((t: any) => t.name);
      // 12 Read tools
      expect(toolNames).toContain('get_today_state');
      expect(toolNames).toContain('get_study_state');
      expect(toolNames).toContain('get_subject_state');
      expect(toolNames).toContain('get_chapter_state');
      expect(toolNames).toContain('get_recent_activity');
      expect(toolNames).toContain('get_pending_work');
      expect(toolNames).toContain('get_schedule_context');
      expect(toolNames).toContain('search_memory');
      expect(toolNames).toContain('get_project_state');
      expect(toolNames).toContain('get_sync_status');
      expect(toolNames).toContain('get_agent_state');
      expect(toolNames).toContain('get_source_state');

      // 13 Write tools
      expect(toolNames).toContain('record_event');
      expect(toolNames).toContain('record_study_session');
      expect(toolNames).toContain('update_progress');
      expect(toolNames).toContain('complete_chapter');
      expect(toolNames).toContain('record_research');
      expect(toolNames).toContain('record_decision');
      expect(toolNames).toContain('record_schedule_decision');
      expect(toolNames).toContain('link_task');
      expect(toolNames).toContain('link_calendar_event');
      expect(toolNames).toContain('record_project_event');
      expect(toolNames).toContain('record_agent_event');
      expect(toolNames).toContain('register_source');
      expect(toolNames).toContain('record_source_mapping');

      // 1 System Checkpoint tool
      expect(toolNames).toContain('checkpoint');
    });

    it('strictly forbids raw SQL tools (zero SQL query or execution tools)', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${readToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'req_sql_audit',
          method: 'tools/list',
        }),
      }, makeEnv());

      const json: any = await res.json();
      const tools = json.result.tools;

      for (const tool of tools) {
        const name = tool.name.toLowerCase();
        const desc = tool.description.toLowerCase();
        expect(name).not.toMatch(/sql|query|raw_db|execute_statement/);
        expect(desc).not.toContain('arbitrary sql');
        expect(desc).not.toContain('execute sql');
      }
    });

    it('returns error when attempting to call a raw SQL query tool', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${readToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'req_sql_rejection',
          method: 'tools/call',
          params: {
            name: 'execute_sql_query',
            arguments: { query: 'SELECT * FROM users' },
          },
        }),
      }, makeEnv());

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.error).toBeDefined();
      expect(json.error.message).toContain('Raw SQL execution is strictly forbidden');
    });

    it('returns UNKNOWN_TOOL error when calling arbitrary unrecognized non-SQL tool', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${readToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'req_unknown_tool',
          method: 'tools/call',
          params: {
            name: 'non_existent_fake_tool',
            arguments: {},
          },
        }),
      }, makeEnv());

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.result.isError).toBe(true);
      expect(json.result.content[0].text).toContain('UNKNOWN_TOOL');
    });
  });

  describe('MCP Scope Gating', () => {
    it('permits read tool with read token', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${readToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'req_read_tool',
          method: 'tools/call',
          params: {
            name: 'get_today_state',
            arguments: {},
          },
        }),
      }, makeEnv());

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.error).toBeUndefined();
      expect(json.result.isError).toBeFalsy();
      const content = JSON.parse(json.result.content[0].text);
      expect(content).toBeDefined();
    });

    it('rejects write tool when called with read-only token', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${readToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'req_write_forbidden',
          method: 'tools/call',
          params: {
            name: 'record_study_session',
            arguments: {
              chapterId: testChapterId,
              durationSeconds: 1800,
            },
          },
        }),
      }, makeEnv());

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.error).toBeDefined();
      expect(json.error.message).toContain("requires 'write' scope");
    });

    it('allows write tool when called with write token', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${writeToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'req_write_allowed',
          method: 'tools/call',
          params: {
            name: 'record_study_session',
            arguments: {
              chapterId: testChapterId,
              durationSeconds: 1800,
              activityType: 'deep_work',
              questionsAttempted: 15,
              questionsCorrect: 12,
            },
          },
        }),
      }, makeEnv());

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.error).toBeUndefined();
      const content = JSON.parse(json.result.content[0].text);
      expect(content.entityId).toBeDefined();
      expect(content.operation).toBe('record_study_session');
    });

    it('rejects checkpoint set when called with read token', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${readToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'req_chk_forbidden',
          method: 'tools/call',
          params: {
            name: 'checkpoint',
            arguments: {
              action: 'set',
              checkpointName: 'backup_1',
              stateData: '{"test": 1}',
            },
          },
        }),
      }, makeEnv());

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.result.isError).toBe(true);
      expect(json.result.content[0].text).toContain("Requires 'write' or 'admin' scope");
    });

    it('allows checkpoint set when called with write/admin token', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'req_chk_allowed',
          method: 'tools/call',
          params: {
            name: 'checkpoint',
            arguments: {
              action: 'set',
              checkpointName: 'backup_admin_1',
              stateData: '{"saved": true}',
            },
          },
        }),
      }, makeEnv());

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.error).toBeUndefined();
      const content = JSON.parse(json.result.content[0].text);
      expect(content.checkpointId).toBeDefined();
      expect(content.checkpointName).toBe('backup_admin_1');
    });
  });

  describe('Semantic Mutation Tool Execution', () => {
    it('executes update_progress tool and updates chapter progress projections', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${writeToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'req_update_progress',
          method: 'tools/call',
          params: {
            name: 'update_progress',
            arguments: {
              chapterId: testChapterId,
              progress: 0.75,
              confidence: 0.8,
            },
          },
        }),
      }, makeEnv());

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.error).toBeUndefined();
      const result = JSON.parse(json.result.content[0].text);
      expect(result.entityId).toBe(testChapterId);

      const events = await ctx.db
        .selectFrom('canonical_events')
        .selectAll()
        .where('event_type', '=', 'chapter_progress_updated')
        .execute();
      expect(events.length).toBe(1);

      const progress = await ctx.db
        .selectFrom('study_progress')
        .selectAll()
        .where('chapter_id', '=', testChapterId)
        .executeTakeFirst();
      expect(progress?.progress_percent).toBe(0.75);
    });

    it('executes complete_chapter tool and finalizes status', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${writeToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'req_complete_chapter',
          method: 'tools/call',
          params: {
            name: 'complete_chapter',
            arguments: {
              chapterId: testChapterId,
              subjectId: testSubjectId,
            },
          },
        }),
      }, makeEnv());

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.error).toBeUndefined();

      const chapter = await ctx.db
        .selectFrom('chapters')
        .selectAll()
        .where('id', '=', testChapterId)
        .executeTakeFirst();
      expect(chapter?.status).toBe('completed');
    });
  });

  describe('Legacy SSE Fallback (GET /sse + POST /sse/messages)', () => {
    it('establishes SSE connection on GET /sse and /mcp/sse', async () => {
      const sseRes1 = await app.request('/sse', {
        method: 'GET',
        headers: { Authorization: `Bearer ${readToken}` },
      }, makeEnv());

      expect(sseRes1.status).toBe(200);
      expect(sseRes1.headers.get('Content-Type')).toContain('text/event-stream');
      const text1 = await sseRes1.text();
      expect(text1).toContain('event: endpoint');

      const sseRes2 = await app.request('/mcp/sse', {
        method: 'GET',
        headers: { Authorization: `Bearer ${readToken}` },
      }, makeEnv());

      expect(sseRes2.status).toBe(200);
      expect(sseRes2.headers.get('Content-Type')).toContain('text/event-stream');
      const text2 = await sseRes2.text();
      expect(text2).toContain('event: endpoint');
    });

    it('processes messages via POST /sse/messages and /mcp/messages', async () => {
      const msgRes1 = await app.request('/sse/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${readToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'msg_legacy_1',
          method: 'tools/list',
        }),
      }, makeEnv());

      expect(msgRes1.status).toBe(200);
      const json1: any = await msgRes1.json();
      expect(json1.result.tools.length).toBe(26);

      const msgRes2 = await app.request('/mcp/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${readToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'msg_legacy_2',
          method: 'tools/list',
        }),
      }, makeEnv());

      expect(msgRes2.status).toBe(200);
      const json2: any = await msgRes2.json();
      expect(json2.result.tools.length).toBe(26);
    });
  });

  describe('Gemini Spark Domain MCP Integration Suite', () => {
    it('get_study_state returns enriched workload, tasks, and target study windows', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${readToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'spark_get_study_state',
          method: 'tools/call',
          params: {
            name: 'get_study_state',
            arguments: {
              date: '2026-09-11',
              timezone: 'UTC',
            },
          },
        }),
      }, makeEnv());

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.error).toBeUndefined();
      expect(json.result.isError).toBeFalsy();

      const state = JSON.parse(json.result.content[0].text);
      expect(state.totalStudyMinutes).toBeDefined();
      expect(state.subjectSummaries).toBeDefined();
      expect(state.recentActivity).toBeDefined();

      // Verify Spark-specific enriched fields
      expect(state.pendingWorkload).toBeDefined();
      expect(Array.isArray(state.pendingWorkload)).toBe(true);
      expect(state.upcomingTasks).toBeDefined();
      expect(Array.isArray(state.upcomingTasks)).toBe(true);
      expect(state.targetStudyWindows).toBeDefined();
      expect(Array.isArray(state.targetStudyWindows)).toBe(true);
      expect(state).toHaveProperty('currentOrNextWindow');
    });

    it('record_schedule_decision rejects invocation with read-only token', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${readToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'spark_unauth_write',
          method: 'tools/call',
          params: {
            name: 'record_schedule_decision',
            arguments: {
              decision: 'Unauthorized reschedule attempt',
            },
          },
        }),
      }, makeEnv());

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.error).toBeDefined();
      expect(json.error.message).toContain("requires 'write' scope");
    });

    it('record_schedule_decision rejects missing decision input', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${writeToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'spark_missing_input',
          method: 'tools/call',
          params: {
            name: 'record_schedule_decision',
            arguments: {},
          },
        }),
      }, makeEnv());

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.result.isError).toBe(true);
      expect(json.result.content[0].text).toContain("Parameter 'decision' is required");
    });

    it('record_schedule_decision strictly rejects raw SQL in arguments', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${writeToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'spark_sql_attempt',
          method: 'tools/call',
          params: {
            name: 'record_schedule_decision',
            arguments: {
              decision: 'SELECT * FROM users WHERE 1=1',
            },
          },
        }),
      }, makeEnv());

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.error).toBeDefined();
      expect(json.error.message).toContain('Raw SQL execution');
    });

    it('record_schedule_decision records schedule_adjusted decision with write token', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${writeToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'spark_valid_adjust',
          method: 'tools/call',
          params: {
            name: 'record_schedule_decision',
            arguments: {
              decisionType: 'schedule_adjusted',
              decision: 'Spark shifted Chapter 1 deep work to 16:00',
              rationale: 'Reconciled calendar collision with prior appointment',
              calendarEventId: 'cal_spark_mcp_evt_01',
              chapterId: testChapterId,
              startTime: '2026-09-11T16:00:00.000Z',
              endTime: '2026-09-11T17:30:00.000Z',
              previousStart: '2026-09-11T11:00:00.000Z',
              previousEnd: '2026-09-11T12:30:00.000Z',
              idempotency_key: 'idemp_spark_adjust_001',
            },
          },
        }),
      }, makeEnv());

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.error).toBeUndefined();
      expect(json.result.isError).toBeFalsy();

      const content = JSON.parse(json.result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.operation).toBe('record_schedule_decision');
      expect(content.eventId).toBeDefined();
      expect(content.entityId).toBeDefined();
      expect(content.data.calendarEventId).toBe('cal_spark_mcp_evt_01');
      expect(content.data.decisionType).toBe('schedule_adjusted');
    });

    it('record_schedule_decision replays idempotent call when key is reused with identical payload', async () => {
      const payload = {
        name: 'record_schedule_decision',
        arguments: {
          decision: 'Reconciled study block idempotency check',
          calendarEventId: 'cal_spark_mcp_evt_02',
          startTime: '2026-09-11T19:00:00.000Z',
          endTime: '2026-09-11T20:00:00.000Z',
          idempotency_key: 'idemp_spark_replay_002',
        },
      };

      const res1 = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${writeToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'spark_idemp_1',
          method: 'tools/call',
          params: payload,
        }),
      }, makeEnv());

      expect(res1.status).toBe(200);
      const json1: any = await res1.json();
      const content1 = JSON.parse(json1.result.content[0].text);
      expect(content1.success).toBe(true);

      // Replay identical call
      const res2 = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${writeToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'spark_idemp_2',
          method: 'tools/call',
          params: payload,
        }),
      }, makeEnv());

      expect(res2.status).toBe(200);
      const json2: any = await res2.json();
      const content2 = JSON.parse(json2.result.content[0].text);
      expect(content2.success).toBe(true);
      expect(content2.replayed).toBe(true);
      expect(content2.entityId).toBe(content1.entityId);
    });
  });
});
