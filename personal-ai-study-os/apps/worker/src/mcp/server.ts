import { createKyselyD1, D1Database, Database, EntitiesRepository } from '@personal-os/db';
import { Kysely } from 'kysely';
import { PersonalStateService } from '@personal-os/core';
import { generateId, ForbiddenError, ValidationError } from '@personal-os/domain';
import { Env } from '../types';

export interface McpToolDefinition {
  name: string;
  description: string;
  scope: 'read' | 'write' | 'admin';
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (
    service: PersonalStateService,
    args: any,
    ctx: { d1: D1Database; db: Kysely<Database>; userScopes: string[] }
  ) => Promise<unknown>;
}

export const MCP_TOOLS: McpToolDefinition[] = [
  // ==========================================================================
  // READ TOOLS (10 Semantic Reads - require 'read' scope)
  // ==========================================================================
  {
    name: 'get_today_state',
    description: "Returns today's active study goals, completed tasks, and schedule blocks in the operator's timezone.",
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD format date (optional, defaults to today)' },
        timezone: { type: 'string', description: 'IANA timezone string (e.g. UTC, Asia/Kolkata)' },
      },
    },
    handler: async (service, args) => {
      return await service.getTodayState({
        date: args?.date,
        timezone: args?.timezone,
      });
    },
  },
  {
    name: 'get_study_state',
    description: 'Study-level aggregate state representation derived purely from projections and canonical events.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async (service) => {
      return await service.getStudyState();
    },
  },
  {
    name: 'get_subject_state',
    description: 'Subject-level state retrieval respecting recursive chapter hierarchy and returning stable identifiers.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        subjectId: { type: 'string', description: 'Canonical subject ID' },
        subject_id: { type: 'string', description: 'Alternative subject ID parameter' },
      },
    },
    handler: async (service, args) => {
      const subjectId = args?.subjectId || args?.subject_id;
      if (!subjectId) {
        throw new ValidationError("Parameter 'subjectId' is required for get_subject_state");
      }
      return await service.getSubjectState(subjectId);
    },
  },
  {
    name: 'get_chapter_state',
    description: 'Chapter-level state retrieval including progress projection, question metrics, and status.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        chapterId: { type: 'string', description: 'Canonical chapter ID' },
        chapter_id: { type: 'string', description: 'Alternative chapter ID parameter' },
      },
    },
    handler: async (service, args) => {
      const chapterId = args?.chapterId || args?.chapter_id;
      if (!chapterId) {
        throw new ValidationError("Parameter 'chapterId' is required for get_chapter_state");
      }
      return await service.getChapterState(chapterId);
    },
  },
  {
    name: 'get_recent_activity',
    description: 'Retrieves recent canonical activity events with optional filtering.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of events to return' },
        eventType: { type: 'string', description: 'Filter by event type' },
        event_type: { type: 'string', description: 'Filter by event type' },
        startDate: { type: 'string', description: 'ISO 8601 start date' },
        start_date: { type: 'string', description: 'ISO 8601 start date' },
        endDate: { type: 'string', description: 'ISO 8601 end date' },
        end_date: { type: 'string', description: 'ISO 8601 end date' },
      },
    },
    handler: async (service, args) => {
      return await service.getRecentActivity({
        limit: args?.limit ? Number(args.limit) : undefined,
        eventType: args?.eventType || args?.event_type,
        startDate: args?.startDate || args?.start_date,
        endDate: args?.endDate || args?.end_date,
      });
    },
  },
  {
    name: 'get_pending_work',
    description: 'Returns pending tasks, active sessions, and failed sync jobs needing operator attention.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async (service) => {
      return await service.getPendingWork();
    },
  },
  {
    name: 'get_schedule_context',
    description: 'Retrieves calendar schedule context and blocks for time-window.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'ISO 8601 start date' },
        start_date: { type: 'string', description: 'ISO 8601 start date' },
        endDate: { type: 'string', description: 'ISO 8601 end date' },
        end_date: { type: 'string', description: 'ISO 8601 end date' },
      },
    },
    handler: async (service, args) => {
      return await service.getScheduleContext({
        date: args?.date || args?.startDate || args?.start_date,
        timezone: args?.timezone,
      });
    },
  },
  {
    name: 'search_memory',
    description: 'Semantic search across memory records and markdown notes.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term or keywords' },
        limit: { type: 'number', description: 'Maximum number of results to return' },
      },
      required: ['query'],
    },
    handler: async (service, args) => {
      if (!args?.query) {
        throw new ValidationError("Parameter 'query' is required for search_memory");
      }
      return await service.searchMemory({
        query: args.query,
        limit: args.limit ? Number(args.limit) : undefined,
      });
    },
  },
  {
    name: 'get_project_state',
    description: 'Retrieves project state, associated goals, events, and decisions.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Canonical project ID' },
        project_id: { type: 'string', description: 'Alternative project ID parameter' },
      },
    },
    handler: async (service, args) => {
      const projectId = args?.projectId || args?.project_id;
      if (!projectId) {
        throw new ValidationError("Parameter 'projectId' is required for get_project_state");
      }
      return await service.getProjectState(projectId);
    },
  },
  {
    name: 'get_sync_status',
    description: 'Summarizes reliability, sync jobs, dead letter queues, and external provider linkage health.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async (service) => {
      return await service.getSyncStatus();
    },
  },
  {
    name: 'get_agent_state',
    description: 'Returns autonomous agent run machine state, execution status, and result summary.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Canonical agent run ID' },
        run_id: { type: 'string', description: 'Alternative agent run ID parameter' },
      },
    },
    handler: async (service, args) => {
      const runId = args?.runId || args?.run_id;
      if (!runId) {
        throw new ValidationError("Parameter 'runId' is required for get_agent_state");
      }
      return await service.getAgentState(runId);
    },
  },
  {
    name: 'get_source_state',
    description: 'Returns external study source metadata, table of contents (chapters), and canonical subject mappings without storing raw text.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: 'Canonical source ID' },
        source_id: { type: 'string', description: 'Alternative source ID parameter' },
      },
    },
    handler: async (service, args) => {
      const sourceId = args?.sourceId || args?.source_id;
      if (!sourceId) {
        throw new ValidationError("Parameter 'sourceId' is required for get_source_state");
      }
      return await service.getSourceState(sourceId);
    },
  },

  // ==========================================================================
  // MUTATION TOOLS (12 Semantic Mutations - require 'write' scope)
  // ==========================================================================
  {
    name: 'record_event',
    description: 'Direct ingestion of an immutable canonical event into D1 event store and projection engine.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        eventType: { type: 'string', description: 'Canonical event type' },
        actor: { type: 'object', description: 'Actor metadata' },
        source: { type: 'object', description: 'Source system metadata' },
        payload: { type: 'object', description: 'Canonical payload' },
        idempotency_key: { type: 'string', description: 'Unique mutation idempotency key' },
      },
      required: ['eventType', 'payload'],
    },
    handler: async (service, args) => {
      const idempKey = args?.idempotency_key || args?.idempotencyKey;
      const rawInput = args?.event || args;
      return await service.recordEvent(
        rawInput,
        idempKey ? { key: idempKey, sourceSystem: 'mcp' } : undefined
      );
    },
  },
  {
    name: 'record_study_session',
    description: 'Emits study_session_recorded event, updates progress projection, writes outbox sync job for Notion, and updates daily state.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        chapterId: { type: 'string', description: 'Target chapter ID' },
        chapter_id: { type: 'string' },
        durationSeconds: { type: 'number', description: 'Duration in seconds' },
        duration_seconds: { type: 'number' },
        activityType: { type: 'string', enum: ['revision', 'pyq_practice', 'lecture', 'deep_work'] },
        activity_type: { type: 'string', enum: ['revision', 'pyq_practice', 'lecture', 'deep_work'] },
        idempotency_key: { type: 'string' },
      },
    },
    handler: async (service, args) => {
      const chapterId = args?.chapterId || args?.chapter_id;
      const durationSeconds = Number(args?.durationSeconds ?? args?.duration_seconds ?? 0);
      const activityType = args?.activityType || args?.activity_type || 'deep_work';
      const idempKey = args?.idempotency_key || args?.idempotencyKey;

      if (!chapterId) {
        throw new ValidationError("Parameter 'chapterId' is required for record_study_session");
      }

      let subjectId = args?.subjectId || args?.subject_id;
      if (!subjectId) {
        const chapter = await service.getChapterState(chapterId);
        subjectId = chapter.chapter.subjectId;
      }

      const now = new Date();
      const endedAt = args?.endedAt || now.toISOString();
      const startedAt = args?.startedAt || new Date(now.getTime() - durationSeconds * 1000).toISOString();

      return await service.recordStudySession(
        {
          chapterId,
          subjectId,
          durationSeconds,
          activityType,
          startedAt,
          endedAt,
          source: 'mcp',
          questionsAttempted: Number(args?.questionsAttempted ?? args?.questions_attempted ?? 0),
          questionsCorrect: Number(args?.questionsCorrect ?? args?.questions_correct ?? 0),
        },
        idempKey ? { key: idempKey, sourceSystem: 'mcp' } : undefined
      );
    },
  },
  {
    name: 'update_progress',
    description: 'Emits questions_attempted and/or chapter_progress_updated events with mathematical bounds checking.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        chapterId: { type: 'string' },
        chapter_id: { type: 'string' },
        progress: { type: 'number', description: 'Progress value (0.0 to 1.0)' },
        progress_percent: { type: 'number' },
        confidence: { type: 'number' },
        idempotency_key: { type: 'string' },
      },
    },
    handler: async (service, args) => {
      const chapterId = args?.chapterId || args?.chapter_id;
      const progress = Number(args?.progress ?? args?.progress_percent ?? 0);
      const idempKey = args?.idempotency_key || args?.idempotencyKey;

      if (!chapterId) {
        throw new ValidationError("Parameter 'chapterId' is required for update_progress");
      }

      return await service.updateProgress(
        {
          chapterId,
          progress,
          confidence: args?.confidence ? Number(args.confidence) : undefined,
        },
        idempKey ? { key: idempKey, sourceSystem: 'mcp' } : undefined
      );
    },
  },
  {
    name: 'complete_chapter',
    description: 'Marks chapter completed, updating mutable chapter entity, canonical event log, and projections.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        chapterId: { type: 'string' },
        chapter_id: { type: 'string' },
        subjectId: { type: 'string' },
        subject_id: { type: 'string' },
        idempotency_key: { type: 'string' },
      },
    },
    handler: async (service, args) => {
      const chapterId = args?.chapterId || args?.chapter_id;
      const subjectId = args?.subjectId || args?.subject_id;
      const idempKey = args?.idempotency_key || args?.idempotencyKey;

      if (!chapterId) {
        throw new ValidationError("Parameter 'chapterId' is required for complete_chapter");
      }

      return await service.completeChapter(
        { chapterId, subjectId },
        idempKey ? { key: idempKey, sourceSystem: 'mcp' } : undefined
      );
    },
  },
  {
    name: 'record_research',
    description: 'Emits research_completed event and logs research summary or reference links.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
        summary: { type: 'string' },
        url: { type: 'string' },
        chapterId: { type: 'string' },
        chapter_id: { type: 'string' },
        projectId: { type: 'string' },
        project_id: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        idempotency_key: { type: 'string' },
      },
      required: ['topic', 'summary'],
    },
    handler: async (service, args) => {
      const idempKey = args?.idempotency_key || args?.idempotencyKey;
      return await service.recordResearch(
        {
          topic: args?.topic,
          summary: args?.summary,
          source: args?.source || args?.url || 'mcp',
          chapterId: args?.chapterId || args?.chapter_id,
          projectId: args?.projectId || args?.project_id,
          takeaways: args?.takeaways || args?.tags,
        },
        idempKey ? { key: idempKey, sourceSystem: 'mcp' } : undefined
      );
    },
  },
  {
    name: 'record_decision',
    description: 'Durable decision recording with context, decision rationale, and consequences.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        context: { type: 'string' },
        decision: { type: 'string' },
        consequences: { type: 'string' },
        projectId: { type: 'string' },
        project_id: { type: 'string' },
        idempotency_key: { type: 'string' },
      },
      required: ['title', 'context', 'decision'],
    },
    handler: async (service, args) => {
      const idempKey = args?.idempotency_key || args?.idempotencyKey;
      return await service.recordDecision(
        {
          title: args?.title,
          context: args?.context,
          decision: args?.decision,
          consequences: args?.consequences,
          projectId: args?.projectId || args?.project_id,
        },
        idempKey ? { key: idempKey, sourceSystem: 'mcp' } : undefined
      );
    },
  },
  {
    name: 'link_task',
    description: 'Semantic linkage between internal entity and external Google Tasks.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['google_tasks'] },
        tasklistId: { type: 'string' },
        tasklist_id: { type: 'string' },
        taskId: { type: 'string' },
        task_id: { type: 'string' },
        entityType: { type: 'string', enum: ['chapter', 'project'] },
        entity_type: { type: 'string' },
        entityId: { type: 'string' },
        entity_id: { type: 'string' },
        titleSnapshot: { type: 'string' },
        title_snapshot: { type: 'string' },
        statusSnapshot: { type: 'string', enum: ['needsAction', 'completed'] },
        status_snapshot: { type: 'string' },
        idempotency_key: { type: 'string' },
      },
    },
    handler: async (service, args) => {
      const idempKey = args?.idempotency_key || args?.idempotencyKey;
      return await service.linkTask(
        {
          provider: args?.provider || 'google_tasks',
          tasklistId: args?.tasklistId || args?.tasklist_id,
          taskId: args?.taskId || args?.task_id,
          entityType: args?.entityType || args?.entity_type,
          entityId: args?.entityId || args?.entity_id,
          titleSnapshot: args?.titleSnapshot || args?.title_snapshot,
          statusSnapshot: args?.statusSnapshot || args?.status_snapshot || 'needsAction',
        },
        idempKey ? { key: idempKey, sourceSystem: 'mcp' } : undefined
      );
    },
  },
  {
    name: 'link_calendar_event',
    description: 'Semantic linkage to external Google Calendar event block.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['google_calendar'] },
        calendarId: { type: 'string' },
        calendar_id: { type: 'string' },
        eventId: { type: 'string' },
        event_id: { type: 'string' },
        entityType: { type: 'string', enum: ['chapter', 'session'] },
        entity_type: { type: 'string' },
        entityId: { type: 'string' },
        entity_id: { type: 'string' },
        startsAt: { type: 'string' },
        starts_at: { type: 'string' },
        endsAt: { type: 'string' },
        ends_at: { type: 'string' },
        statusSnapshot: { type: 'string', enum: ['confirmed', 'tentative', 'cancelled'] },
        status_snapshot: { type: 'string' },
        titleSnapshot: { type: 'string' },
        title_snapshot: { type: 'string' },
        idempotency_key: { type: 'string' },
      },
    },
    handler: async (service, args) => {
      const idempKey = args?.idempotency_key || args?.idempotencyKey;
      return await service.linkCalendarEvent(
        {
          provider: args?.provider || 'google_calendar',
          calendarId: args?.calendarId || args?.calendar_id,
          eventId: args?.eventId || args?.event_id,
          entityType: args?.entityType || args?.entity_type,
          entityId: args?.entityId || args?.entity_id,
          startsAt: args?.startsAt || args?.starts_at,
          endsAt: args?.endsAt || args?.ends_at,
          statusSnapshot: args?.statusSnapshot || args?.status_snapshot || 'confirmed',
          titleSnapshot: args?.titleSnapshot || args?.title_snapshot,
        },
        idempKey ? { key: idempKey, sourceSystem: 'mcp' } : undefined
      );
    },
  },
  {
    name: 'record_project_event',
    description: 'Records project milestones, status changes, or completions into canonical events and project state.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Canonical project ID' },
        project_id: { type: 'string' },
        eventType: { type: 'string', enum: ['project_started', 'project_updated', 'project_completed'] },
        name: { type: 'string', description: 'Project name (required for project_started)' },
        description: { type: 'string', description: 'Optional project description' },
        milestone: { type: 'string', description: 'Milestone description for project_updated' },
        status: { type: 'string', enum: ['planned', 'active', 'paused', 'completed', 'cancelled'] },
        idempotency_key: { type: 'string' },
      },
      required: ['eventType'],
    },
    handler: async (service, args) => {
      const idempKey = args?.idempotency_key || args?.idempotencyKey;
      const eventType = args?.eventType;
      const projectId = args?.projectId || args?.project_id;
      if (!projectId) {
        throw new ValidationError("Parameter 'projectId' is required for record_project_event");
      }

      let payload: any;
      if (eventType === 'project_started') {
        if (!args.name) {
          throw new ValidationError("Parameter 'name' is required for project_started");
        }
        payload = {
          projectId,
          name: args.name,
          description: args.description,
        };
      } else if (eventType === 'project_updated') {
        payload = {
          projectId,
          milestone: args.milestone,
          status: args.status,
          description: args.description,
        };
      } else if (eventType === 'project_completed') {
        payload = {
          projectId,
        };
      } else {
        throw new ValidationError(`Invalid project eventType '${eventType}'`);
      }

      return await service.recordEvent(
        {
          eventType,
          actor: args?.actor || { type: 'agent', id: 'agt_antigravity' },
          source: args?.source || { system: 'antigravity', interface: 'mcp' },
          payload,
        },
        idempKey ? { key: idempKey, sourceSystem: 'mcp' } : undefined
      );
    },
  },
  {
    name: 'record_agent_event',
    description: 'Records agent lifecycle events (agent_started, agent_completed, agent_failed) into canonical events and agent_runs.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Canonical agent run ID' },
        run_id: { type: 'string' },
        agentName: { type: 'string', description: 'Agent identifier (e.g. Antigravity, StudySourceCore)' },
        agent_name: { type: 'string' },
        runType: { type: 'string', description: 'Run category (e.g. orchestration, analysis, ingestion)' },
        run_type: { type: 'string' },
        eventType: { type: 'string', enum: ['agent_started', 'agent_completed', 'agent_failed'] },
        resultSummary: { type: 'string' },
        result_summary: { type: 'string' },
        errorCode: { type: 'string' },
        error_code: { type: 'string' },
        errorMessage: { type: 'string' },
        error_message: { type: 'string' },
        idempotency_key: { type: 'string' },
      },
      required: ['eventType'],
    },
    handler: async (service, args) => {
      const idempKey = args?.idempotency_key || args?.idempotencyKey;
      const eventType = args?.eventType;
      const runId = args?.runId || args?.run_id || generateId('agentrun');

      let payload: any;
      if (eventType === 'agent_started') {
        payload = {
          runId,
          agentName: args?.agentName || args?.agent_name || 'Antigravity',
          runType: args?.runType || args?.run_type || 'orchestration',
        };
      } else if (eventType === 'agent_completed') {
        payload = {
          runId,
          resultSummary: args?.resultSummary || args?.result_summary || 'Agent execution completed successfully',
        };
      } else if (eventType === 'agent_failed') {
        payload = {
          runId,
          errorCode: args?.errorCode || args?.error_code || 'EXECUTION_FAILED',
          errorMessage: args?.errorMessage || args?.error_message || 'Agent execution failed',
        };
      } else {
        throw new ValidationError(`Invalid agent eventType '${eventType}'`);
      }

      return await service.recordEvent(
        {
          eventType,
          actor: args?.actor || { type: 'agent', id: 'agt_antigravity' },
          source: args?.source || { system: 'antigravity', interface: 'mcp' },
          payload,
        },
        idempKey ? { key: idempKey, sourceSystem: 'mcp' } : undefined
      );
    },
  },
  {
    name: 'register_source',
    description: 'Registers external study source metadata (book, pdf, syllabus, notes) with strict zero-copyright full-text storage.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: 'Canonical source ID (src_...)' },
        source_id: { type: 'string' },
        title: { type: 'string', description: 'Source title' },
        sourceType: { type: 'string', enum: ['book', 'pdf', 'syllabus', 'notes'] },
        source_type: { type: 'string', enum: ['book', 'pdf', 'syllabus', 'notes'] },
        author: { type: 'string' },
        publisher: { type: 'string' },
        edition: { type: 'string' },
        referenceUri: { type: 'string', description: 'Reference URI / location (NO full-text copyrighted content)' },
        reference_uri: { type: 'string' },
        idempotency_key: { type: 'string' },
      },
      required: ['title'],
    },
    handler: async (service, args) => {
      const idempKey = args?.idempotency_key || args?.idempotencyKey;
      const sourceId = args?.sourceId || args?.source_id || generateId('src');
      const title = args?.title;
      const sourceType = args?.sourceType || args?.source_type || 'book';

      return await service.recordEvent(
        {
          eventType: 'source_registered',
          actor: args?.actor || { type: 'agent', id: 'agt_studysourcecore' },
          source: args?.source || { system: 'studysourcecore', interface: 'mcp' },
          payload: {
            sourceId,
            title,
            sourceType,
            author: args?.author,
            publisher: args?.publisher,
            edition: args?.edition,
            referenceUri: args?.referenceUri || args?.reference_uri,
          },
        },
        idempKey ? { key: idempKey, sourceSystem: 'mcp' } : undefined
      );
    },
  },
  {
    name: 'record_source_mapping',
    description: 'Maps external source chapter / TOC items to canonical curriculum chapters.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        sourceMappingId: { type: 'string' },
        source_mapping_id: { type: 'string' },
        sourceChapterId: { type: 'string', description: 'Source chapter ID (srcchap_...)' },
        source_chapter_id: { type: 'string' },
        canonicalChapterId: { type: 'string', description: 'Canonical chapter ID (chap_...)' },
        canonical_chapter_id: { type: 'string' },
        subjectId: { type: 'string', description: 'Subject ID (subj_...)' },
        subject_id: { type: 'string' },
        mappingType: { type: 'string', enum: ['direct', 'partial', 'prerequisite'] },
        mapping_type: { type: 'string', enum: ['direct', 'partial', 'prerequisite'] },
        relevance: { type: 'string', enum: ['high', 'medium', 'low'] },
        confidence: { type: 'number' },
        notes: { type: 'string' },
        idempotency_key: { type: 'string' },
      },
      required: ['sourceChapterId', 'canonicalChapterId'],
    },
    handler: async (service, args) => {
      const idempKey = args?.idempotency_key || args?.idempotencyKey;
      const sourceChapterId = args?.sourceChapterId || args?.source_chapter_id;
      const canonicalChapterId = args?.canonicalChapterId || args?.canonical_chapter_id;

      if (!sourceChapterId || !canonicalChapterId) {
        throw new ValidationError("Parameters 'sourceChapterId' and 'canonicalChapterId' are required");
      }

      return await service.recordEvent(
        {
          eventType: 'source_mapped',
          actor: args?.actor || { type: 'agent', id: 'agt_studysourcecore' },
          source: args?.source || { system: 'studysourcecore', interface: 'mcp' },
          payload: {
            sourceMappingId: args?.sourceMappingId || args?.source_mapping_id,
            sourceChapterId,
            canonicalChapterId,
            subjectId: args?.subjectId || args?.subject_id,
            mappingType: args?.mappingType || args?.mapping_type || 'direct',
            relevance: args?.relevance || 'high',
            confidence: args?.confidence ?? 1.0,
            notes: args?.notes,
          },
        },
        idempKey ? { key: idempKey, sourceSystem: 'mcp' } : undefined
      );
    },
  },

  // ==========================================================================
  // SYSTEM TOOL (1 Tool - requires 'read' or 'admin' scope)
  // ==========================================================================
  {
    name: 'checkpoint',
    description: 'Workflow checkpointing tool to save or retrieve progress tokens for long-running workflows.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'set', 'list'], description: 'Action to perform' },
        checkpointName: { type: 'string', description: 'Checkpoint identifier' },
        checkpoint_name: { type: 'string' },
        checkpointType: { type: 'string', description: 'Checkpoint type (workflow, ingestion, sync)' },
        checkpoint_type: { type: 'string' },
        stateData: { type: 'string', description: 'State data payload' },
        state_data: { type: 'string' },
      },
    },
    handler: async (_service, args, ctx) => {
      const name = args?.checkpointName || args?.checkpoint_name;
      const type = args?.checkpointType || args?.checkpoint_type || 'workflow';
      const data = args?.stateData || args?.state_data;
      const action = args?.action || (data ? 'set' : name ? 'get' : 'list');

      if (action === 'set') {
        if (!ctx.userScopes.includes('write') && !ctx.userScopes.includes('admin')) {
          throw new ForbiddenError("Forbidden: Requires 'write' or 'admin' scope to set checkpoints");
        }
        if (!name || !data) {
          throw new ValidationError("Both 'checkpointName' and 'stateData' are required for action 'set'");
        }
        const id = generateId('chk');
        const now = new Date().toISOString();
        const serialized = typeof data === 'string' ? data : JSON.stringify(data);
        await EntitiesRepository.insertCheckpoint(ctx.db, {
          id,
          checkpointName: name,
          checkpointType: type,
          stateData: serialized,
          createdAt: now,
        });
        return { success: true, checkpointId: id, checkpointName: name, createdAt: now };
      } else if (action === 'get') {
        if (!name) {
          throw new ValidationError("Parameter 'checkpointName' is required for action 'get'");
        }
        const row = await EntitiesRepository.getCheckpoint(ctx.db, name);
        if (!row) return null;
        return {
          id: row.id,
          checkpoint_name: row.checkpointName,
          checkpoint_type: row.checkpointType,
          state_data: row.stateData,
          created_at: row.createdAt,
        };
      } else {
        const rows = await EntitiesRepository.listCheckpoints(ctx.db, 20);
        return rows.map(r => ({
          id: r.id,
          checkpoint_name: r.checkpointName,
          checkpoint_type: r.checkpointType,
          state_data: r.stateData,
          created_at: r.createdAt,
        }));
      }
    },
  },
];

const DISALLOWED_SQL_PATTERNS = [
  /select\s+/i,
  /insert\s+into/i,
  /update\s+/i,
  /delete\s+from/i,
  /drop\s+table/i,
  /alter\s+table/i,
  /truncate\s+/i,
  /create\s+table/i,
];

export function assertNoRawSql(toolName: string, args: Record<string, unknown>): void {
  const lowerName = toolName.toLowerCase();
  if (
    lowerName.includes('sql') ||
    lowerName.includes('query') ||
    lowerName.includes('execute') ||
    lowerName.includes('table')
  ) {
    throw new ForbiddenError(`Raw SQL execution is strictly forbidden via Remote MCP server.`);
  }

  // Scan argument values for raw SQL injections
  for (const value of Object.values(args)) {
    if (typeof value === 'string') {
      for (const pattern of DISALLOWED_SQL_PATTERNS) {
        if (pattern.test(value.trim())) {
          throw new ForbiddenError(
            `Raw SQL execution or arbitrary query strings are strictly forbidden via Remote MCP server.`
          );
        }
      }
    }
  }
}

export function listMcpTools(): Array<{
  name: string;
  description: string;
  inputSchema: McpToolDefinition['inputSchema'];
}> {
  return MCP_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

export async function executeMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  userScopes: string[],
  env: Env
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  // 1. Strict Raw SQL Prevention Gate
  assertNoRawSql(toolName, args);

  // 2. Locate Tool in Registry
  const tool = MCP_TOOLS.find((t) => t.name === toolName);
  if (!tool) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: `UNKNOWN_TOOL: Tool '${toolName}' is not recognized on this Remote MCP server.`,
          }),
        },
      ],
      isError: true,
    };
  }

  // 3. Authorization Check
  if (tool.scope === 'write' && !userScopes.includes('write') && !userScopes.includes('admin')) {
    throw new ForbiddenError(
      `Forbidden: Tool '${toolName}' requires 'write' scope (present: ${userScopes.join(', ')})`
    );
  }
  if (tool.scope === 'admin' && !userScopes.includes('admin')) {
    throw new ForbiddenError(
      `Forbidden: Tool '${toolName}' requires 'admin' scope (present: ${userScopes.join(', ')})`
    );
  }

  // 4. Instantiate Service & Execute
  const db = createKyselyD1(env.DB);
  const service = new PersonalStateService(env.DB, db);

  try {
    const result = await tool.handler(service, args, { d1: env.DB, db, userScopes });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result ?? null),
        },
      ],
    };
  } catch (err: any) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: err.message || 'Execution error',
            code: err.code || 'EXECUTION_FAILED',
          }),
        },
      ],
      isError: true,
    };
  }
}
