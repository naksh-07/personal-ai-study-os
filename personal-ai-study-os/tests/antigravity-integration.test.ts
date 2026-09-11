import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { createTestDatabase, TestContext } from './test-helper';
import { PersonalStateService } from '@personal-os/core';
import { EntitiesRepository } from '@personal-os/db';
import app from '../apps/worker/src/index';

describe('Slice 5: Antigravity Autonomous Execution Integration', () => {
  let ctx: TestContext;
  let service: PersonalStateService;
  const testJwtSecret = 'test-jwt-secret-key-at-least-32-chars-for-hmac-sha256';

  function makeJwt(payload: Record<string, any>, secret: string = testJwtSecret): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const unsigned = `${header}.${body}`;
    const signature = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
    return `${unsigned}.${signature}`;
  }

  const writeToken = makeJwt({
    sub: 'usr_operator',
    aud: 'personal-ai-study-os',
    scope: 'read write',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const readToken = makeJwt({
    sub: 'usr_operator',
    aud: 'personal-ai-study-os',
    scope: 'read',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const makeEnv = () => ({
    DB: ctx.d1,
    ENVIRONMENT: 'test',
    JWT_SECRET: testJwtSecret,
  });

  beforeEach(async () => {
    ctx = createTestDatabase();
    service = new PersonalStateService(ctx.d1, ctx.db);
    const now = new Date().toISOString();

    await EntitiesRepository.insertUser(ctx.db, {
      id: 'usr_operator',
      timezone: 'UTC',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
  });

  describe('Project State Lifecycle Projections', () => {
    it('projects project_started, project_updated, and project_completed to D1 tables', async () => {
      const projectId = 'proj_antigravity_core';

      // 1. Project Started
      const startRes = await service.recordEvent({
        eventType: 'project_started',
        actor: { type: 'agent', id: 'agt_antigravity' },
        source: { system: 'antigravity', interface: 'rest' },
        payload: {
          projectId,
          name: 'Antigravity Integration Core',
          description: 'Orchestrating technical core integration',
        },
      });
      expect(startRes.success).toBe(true);

      // Verify D1 state
      const state1 = await service.getProjectState(projectId);
      expect(state1.project.id).toBe(projectId);
      expect(state1.project.name).toBe('Antigravity Integration Core');
      expect(state1.project.status).toBe('active');
      expect(state1.recentEvents.length).toBe(1);
      expect(state1.recentEvents[0].eventType).toBe('started');

      // 2. Project Updated (Milestone)
      const updateRes = await service.recordEvent({
        eventType: 'project_updated',
        actor: { type: 'agent', id: 'agt_antigravity' },
        source: { system: 'antigravity', interface: 'rest' },
        payload: {
          projectId,
          milestone: 'Phase 1 Core Architecture Verified',
          description: 'Updated architecture scope',
        },
      });
      expect(updateRes.success).toBe(true);

      const state2 = await service.getProjectState(projectId);
      expect(state2.recentEvents.length).toBe(2);
      expect(state2.latestProgress.milestonesCount).toBe(1);

      // 3. Project Completed
      const completeRes = await service.recordEvent({
        eventType: 'project_completed',
        actor: { type: 'agent', id: 'agt_antigravity' },
        source: { system: 'antigravity', interface: 'rest' },
        payload: {
          projectId,
        },
      });
      expect(completeRes.success).toBe(true);

      const state3 = await service.getProjectState(projectId);
      expect(state3.project.status).toBe('completed');
      expect(state3.latestProgress.completedMilestonesCount).toBe(1);
    });
  });

  describe('Agent Run Lifecycle Projections', () => {
    it('projects agent_started, agent_completed, and agent_failed into agent_runs table', async () => {
      const runId = 'agentrun_01M28TEST001';

      // 1. Agent Started
      await service.recordEvent({
        eventType: 'agent_started',
        actor: { type: 'agent', id: 'agt_antigravity' },
        source: { system: 'antigravity', interface: 'rest' },
        payload: {
          runId,
          agentName: 'Antigravity',
          runType: 'orchestration',
        },
      });

      const run1 = await service.getAgentState(runId);
      expect(run1.id).toBe(runId);
      expect(run1.agentName).toBe('Antigravity');
      expect(run1.status).toBe('started');
      expect(run1.completedAt).toBeNull();

      // 2. Agent Completed
      await service.recordEvent({
        eventType: 'agent_completed',
        actor: { type: 'agent', id: 'agt_antigravity' },
        source: { system: 'antigravity', interface: 'rest' },
        payload: {
          runId,
          resultSummary: 'Monorepo build and test suite succeeded with 0 errors',
        },
      });

      const run2 = await service.getAgentState(runId);
      expect(run2.status).toBe('completed');
      expect(run2.resultSummary).toBe('Monorepo build and test suite succeeded with 0 errors');
      expect(run2.completedAt).toBeDefined();

      // 3. Agent Failed (Second Run)
      const failRunId = 'agentrun_01M28TEST002';
      await service.recordEvent({
        eventType: 'agent_started',
        actor: { type: 'agent', id: 'agt_antigravity' },
        source: { system: 'antigravity', interface: 'rest' },
        payload: {
          runId: failRunId,
          agentName: 'StudySourceCore',
          runType: 'ingestion',
        },
      });

      await service.recordEvent({
        eventType: 'agent_failed',
        actor: { type: 'agent', id: 'agt_antigravity' },
        source: { system: 'antigravity', interface: 'rest' },
        payload: {
          runId: failRunId,
          errorCode: 'SOURCE_UNAVAILABLE',
          errorMessage: 'Remote resource timed out after 3 retries',
        },
      });

      const run3 = await service.getAgentState(failRunId);
      expect(run3.status).toBe('failed');
      expect(run3.errorCode).toBe('SOURCE_UNAVAILABLE');
      expect(run3.resultSummary).toBe('Remote resource timed out after 3 retries');

      // 4. List Recent Runs
      const recent = await service.getRecentAgentRuns();
      expect(recent.length).toBe(2);
      expect(recent[0].id).toBe(failRunId);
    });
  });

  describe('REST Endpoints for Antigravity Operations', () => {
    it('supports POST /v1/projects/events and GET /v1/state/projects/:projectId', async () => {
      const projectId = 'proj_rest_test';

      const postRes = await app.request('/v1/projects/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${writeToken}`,
        },
        body: JSON.stringify({
          eventType: 'project_started',
          payload: {
            projectId,
            name: 'REST Project Verification',
            description: 'Testing REST project API',
          },
        }),
      }, makeEnv());

      expect(postRes.status).toBe(201);

      const getRes = await app.request(`/v1/state/projects/${projectId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${readToken}`,
        },
      }, makeEnv());

      expect(getRes.status).toBe(200);
      const json: any = await getRes.json();
      expect(json.data.project.id).toBe(projectId);
      expect(json.data.project.name).toBe('REST Project Verification');
    });

    it('supports POST /v1/agents/runs and GET /v1/state/agents/:runId', async () => {
      const runId = 'agentrun_rest_test';

      const postRes = await app.request('/v1/agents/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${writeToken}`,
        },
        body: JSON.stringify({
          eventType: 'agent_started',
          payload: {
            runId,
            agentName: 'AntigravityREST',
            runType: 'verification',
          },
        }),
      }, makeEnv());

      expect(postRes.status).toBe(201);

      const getRes = await app.request(`/v1/state/agents/${runId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${readToken}`,
        },
      }, makeEnv());

      expect(getRes.status).toBe(200);
      const json: any = await getRes.json();
      expect(json.data.id).toBe(runId);
      expect(json.data.agentName).toBe('AntigravityREST');
    });
  });

  describe('MCP Tools for Antigravity Operations', () => {
    it('executes record_project_event and get_project_state via MCP', async () => {
      const projectId = 'proj_mcp_test';

      const writeRes = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${writeToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'mcp_proj_1',
          method: 'tools/call',
          params: {
            name: 'record_project_event',
            arguments: {
              eventType: 'project_started',
              projectId,
              name: 'MCP Project Test',
              description: 'Created via MCP protocol',
            },
          },
        }),
      }, makeEnv());

      expect(writeRes.status).toBe(200);
      const writeJson: any = await writeRes.json();
      expect(writeJson.result.isError).toBeFalsy();
      const writeData = JSON.parse(writeJson.result.content[0].text);
      expect(writeData.success).toBe(true);

      const readRes = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${readToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'mcp_proj_2',
          method: 'tools/call',
          params: {
            name: 'get_project_state',
            arguments: { projectId },
          },
        }),
      }, makeEnv());

      expect(readRes.status).toBe(200);
      const readJson: any = await readRes.json();
      expect(readJson.result.isError).toBeFalsy();
      const readData = JSON.parse(readJson.result.content[0].text);
      expect(readData.project.name).toBe('MCP Project Test');
    });

    it('executes record_agent_event and get_agent_state via MCP', async () => {
      const runId = 'agentrun_mcp_test';

      const writeRes = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${writeToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'mcp_agent_1',
          method: 'tools/call',
          params: {
            name: 'record_agent_event',
            arguments: {
              eventType: 'agent_started',
              runId,
              agentName: 'MCPRunner',
              runType: 'audit',
            },
          },
        }),
      }, makeEnv());

      expect(writeRes.status).toBe(200);
      const writeJson: any = await writeRes.json();
      expect(writeJson.result.isError).toBeFalsy();

      const readRes = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${readToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'mcp_agent_2',
          method: 'tools/call',
          params: {
            name: 'get_agent_state',
            arguments: { runId },
          },
        }),
      }, makeEnv());

      expect(readRes.status).toBe(200);
      const readJson: any = await readRes.json();
      expect(readJson.result.isError).toBeFalsy();
      const readData = JSON.parse(readJson.result.content[0].text);
      expect(readData.agentName).toBe('MCPRunner');
      expect(readData.status).toBe('started');
    });
  });
});
