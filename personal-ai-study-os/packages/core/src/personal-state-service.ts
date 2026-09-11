import { Kysely } from 'kysely';
import crypto from 'node:crypto';
import {
  Database,
  D1Database,
  EntitiesRepository,
  CanonicalEventsRepository,
  ProjectionsRepository,
  ReliabilityRepository,
  ActivityFilterParams,
} from '@personal-os/db';
import {
  CanonicalEvent,
  TodayState,
  StudyState,
  SubjectState,
  ChapterState,
  ChapterHierarchyItem,
  PendingWorkState,
  ScheduleContextState,
  ScheduleContextBlock,
  MemorySearchState,
  MemorySearchItem,
  ProjectState,
  SyncStatusState,
  RecordStudySessionInput,
  RecordStudySessionInputSchema,
  UpdateProgressInput,
  UpdateProgressInputSchema,
  CompleteChapterInput,
  CompleteChapterInputSchema,
  RecordResearchInput,
  RecordResearchInputSchema,
  RecordDecisionInput,
  RecordDecisionInputSchema,
  LinkTaskInput,
  LinkTaskInputSchema,
  LinkCalendarEventInput,
  LinkCalendarEventInputSchema,
  LinkScheduleInput,
  LinkScheduleInputSchema,
  generateId,
  deriveAccuracy,
  NotFoundError,
  ConflictError,
  MathematicalConstraintError,
  AgentRun,
  Source,
  SourceChapter,
  SourceMapping,
  SourceState,
} from '@personal-os/domain';
import { CanonicalEventEngine, CreateCanonicalEventInput } from './event-engine';
import { AtomicWriter } from './atomic-writer';
import { ProjectionEngine } from './projection-engine';

export interface IdempotencyContext {
  key?: string;
  sourceSystem?: string;
  requestPayload?: unknown;
}

export interface MutationResult<T = unknown> {
  success: boolean;
  operation: string;
  eventId?: string;
  entityId?: string;
  data?: T;
  replayed?: boolean;
}

export function hashPayload(payload: unknown): string {
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

export class PersonalStateService {
  constructor(
    private readonly d1: D1Database,
    private readonly db: Kysely<Database>
  ) {}

  // ==========================================================================
  // SEMANTIC READ SURFACE (10 Operations)
  // ==========================================================================

  /**
   * 1. get_today_state:
   * Unified current-day state combining authoritative D1 projections and canonical events.
   * Reports state only; does not calculate scheduling recommendations.
   */
  async getTodayState(params?: { date?: string; timezone?: string }): Promise<TodayState> {
    let timezone = params?.timezone;
    if (!timezone) {
      const user = await this.db.selectFrom('users').select('timezone').executeTakeFirst();
      timezone = user?.timezone ?? 'UTC';
    }

    const nowIso = new Date().toISOString();
    const date = params?.date ?? ProjectionEngine.extractDate(nowIso, timezone);

    // Fetch daily state projection
    const daily = await ProjectionsRepository.getDailyStateByDate(this.db, date);

    // Fetch completed activity events for today
    const startOfDay = `${date}T00:00:00.000Z`;
    const endOfDay = `${date}T23:59:59.999Z`;
    const todayEvents = await CanonicalEventsRepository.getRecentActivity(this.db, {
      startDate: startOfDay,
      endDate: endOfDay,
    });

    const recentSessions = todayEvents
      .filter(e => e.eventType === 'study_session_recorded' || e.eventType === 'study_completed')
      .map(e => {
        const p = e.payload as Record<string, unknown>;
        return {
          sessionId: (p.sessionId as string) ?? undefined,
          chapterId: (p.chapterId as string) ?? '',
          durationMinutes: Math.floor(Number(p.durationSeconds ?? 0) / 60),
          activityType: (p.activityType as string) ?? 'deep_work',
        };
      });

    // Fetch task link state
    const taskLinks = await EntitiesRepository.getTaskLinks(this.db);
    const activeTasks = taskLinks.filter(t => t.statusSnapshot === 'needsAction');
    const completedTasks = taskLinks.filter(t => t.statusSnapshot === 'completed');

    // Fetch schedule context for today
    const calendarLinks = await EntitiesRepository.getCalendarLinks(this.db, startOfDay, endOfDay);
    const missedSessions = todayEvents.filter(e => e.eventType === 'schedule_missed');

    // Fetch synchronization status
    const syncStatus = await ReliabilityRepository.getSyncStatusSummary(this.db);

    // Build warnings
    const warnings: string[] = [];
    if ((daily?.missedSessions ?? 0) > 0 || missedSessions.length > 0) {
      warnings.push(`Operator missed ${Math.max(daily?.missedSessions ?? 0, missedSessions.length)} scheduled session(s) today.`);
    }
    if (syncStatus.failedJobsCount > 0) {
      warnings.push(`${syncStatus.failedJobsCount} external synchronization job(s) in failed state.`);
    }
    if (syncStatus.deadLetterJobsCount > 0) {
      warnings.push(`${syncStatus.deadLetterJobsCount} job(s) routed to Dead Letter Queue.`);
    }
    if ((daily?.questionsAttempted ?? 0) >= 10 && (daily?.accuracy ?? 0) < 0.5) {
      warnings.push(`Low practice accuracy detected (${((daily?.accuracy ?? 0) * 100).toFixed(1)}%). Recommended for review.`);
    }

    return {
      date,
      timezone,
      studyProgress: {
        studyMinutes: daily?.studyMinutes ?? 0,
        completedChapters: daily?.completedChapters ?? 0,
        questionsAttempted: daily?.questionsAttempted ?? 0,
        questionsCorrect: daily?.questionsCorrect ?? 0,
        accuracy: daily?.accuracy ?? 0.0,
        missedSessions: daily?.missedSessions ?? 0,
      },
      completedActivity: {
        eventsCount: todayEvents.length,
        recentSessions,
      },
      pendingWork: {
        pendingTasksCount: activeTasks.length,
        failedSyncJobsCount: syncStatus.failedJobsCount + syncStatus.deadLetterJobsCount,
      },
      taskLinkageState: {
        activeTaskLinksCount: activeTasks.length,
        completedTaskLinksCount: completedTasks.length,
      },
      scheduleContext: {
        scheduledBlocksCount: calendarLinks.length,
        missedBlocksCount: missedSessions.length,
      },
      warnings,
      synchronizationStatus: {
        healthy: syncStatus.healthy,
        pendingSyncJobsCount: syncStatus.pendingJobsCount,
        deadLetterCount: syncStatus.deadLetterJobsCount,
      },
    };
  }

  /**
   * 2. get_study_state:
   * Study-level aggregate state representation derived purely from projections and canonical events.
   */
  async getStudyState(): Promise<StudyState> {
    const allProgress = await ProjectionsRepository.getAllStudyProgress(this.db);
    const allChapters = await EntitiesRepository.getAllChapters(this.db);
    const allSubjects = await EntitiesRepository.getAllSubjects(this.db);
    const allDaily = await ProjectionsRepository.getAllDailyStates(this.db);

    const totalStudyMinutes = allDaily.reduce((acc, d) => acc + d.studyMinutes, 0);

    let completedChaptersCount = 0;
    let activeChaptersCount = 0;
    let questionsAttempted = 0;
    let questionsCorrect = 0;

    for (const p of allProgress) {
      if (p.status === 'COMPLETED' || p.progressPercent >= 1.0) {
        completedChaptersCount++;
      } else if (p.progressPercent > 0 || p.status === 'IN_PROGRESS') {
        activeChaptersCount++;
      }
      questionsAttempted += p.questionsAttempted;
      questionsCorrect += p.questionsCorrect;
    }

    const accuracy = deriveAccuracy(questionsCorrect, questionsAttempted);

    // Subject breakdown
    const subjectSummaries = allSubjects.map(s => {
      const subjectChapters = allChapters.filter(c => c.subjectId === s.id);
      const total = subjectChapters.length;
      const completed = subjectChapters.filter(c => {
        const prog = allProgress.find(p => p.chapterId === c.id);
        return c.status === 'completed' || prog?.status === 'COMPLETED' || (prog?.progressPercent ?? 0) >= 1.0;
      }).length;
      const progressPercent = total > 0 ? Math.round((completed / total) * 10000) / 10000 : 0.0;

      return {
        subjectId: s.id,
        name: s.name,
        completedChapters: completed,
        totalChapters: total,
        progressPercent,
      };
    });

    // Recent study activity
    const recentEvents = await CanonicalEventsRepository.getRecentActivity(this.db, { limit: 15 });
    const recentActivity = recentEvents.map(e => ({
      eventId: e.eventId,
      eventType: e.eventType,
      occurredAt: e.occurredAt,
      summary: `${e.eventType} by ${e.actor.type}:${e.actor.id} via ${e.source.system}`,
    }));

    return {
      totalStudyMinutes,
      completedChaptersCount,
      activeChaptersCount,
      totalChaptersCount: allChapters.length,
      questionsAttempted,
      questionsCorrect,
      accuracy,
      subjectSummaries,
      recentActivity,
    };
  }

  /**
   * 3. get_subject_state:
   * Subject-level state retrieval respecting recursive chapter hierarchy and returning stable identifiers.
   */
  async getSubjectState(subjectId: string): Promise<SubjectState> {
    const subject = await EntitiesRepository.getSubject(this.db, subjectId);
    if (!subject) {
      throw new NotFoundError('SUBJECT_NOT_FOUND', `Subject '${subjectId}' not found.`);
    }

    const chapters = await EntitiesRepository.getChaptersBySubject(this.db, subjectId);
    const allProgress = await ProjectionsRepository.getAllStudyProgress(this.db);

    // Build recursive chapter tree
    const chapterMap = new Map<string, ChapterHierarchyItem>();
    for (const c of chapters) {
      chapterMap.set(c.id, {
        id: c.id,
        name: c.name,
        slug: c.slug,
        parentId: c.parentId,
        status: c.status,
        progress: c.progress,
        children: [],
      });
    }

    const tree: ChapterHierarchyItem[] = [];
    for (const c of chapters) {
      const item = chapterMap.get(c.id)!;
      if (c.parentId && chapterMap.has(c.parentId)) {
        chapterMap.get(c.parentId)!.children!.push(item);
      } else {
        tree.push(item);
      }
    }

    // Aggregate progress
    let completedCount = 0;
    let questionsAttempted = 0;
    let questionsCorrect = 0;

    for (const c of chapters) {
      const prog = allProgress.find(p => p.chapterId === c.id);
      if (c.status === 'completed' || prog?.status === 'COMPLETED' || (prog?.progressPercent ?? 0) >= 1.0) {
        completedCount++;
      }
      if (prog) {
        questionsAttempted += prog.questionsAttempted;
        questionsCorrect += prog.questionsCorrect;
      }
    }

    const total = chapters.length;
    const overallProgressPercent = total > 0 ? Math.round((completedCount / total) * 10000) / 10000 : 0.0;
    const accuracy = deriveAccuracy(questionsCorrect, questionsAttempted);

    // Recent events for this subject
    const recentActivityEvents = await CanonicalEventsRepository.getRecentActivity(this.db, {
      subjectId,
      limit: 10,
    });

    return {
      subject,
      chapters: tree,
      progress: {
        completedChapters: completedCount,
        totalChapters: total,
        overallProgressPercent,
        questionsAttempted,
        questionsCorrect,
        accuracy,
      },
      recentActivity: recentActivityEvents.map(e => ({
        eventId: e.eventId,
        eventType: e.eventType,
        occurredAt: e.occurredAt,
      })),
      completionState: {
        isFullyCompleted: total > 0 && completedCount === total,
        remainingChaptersCount: total - completedCount,
      },
    };
  }

  /**
   * 4. get_chapter_state:
   * Detailed chapter state including progress, derived accuracy, and linked source mappings.
   * Does not expose raw copyrighted source text.
   */
  async getChapterState(chapterId: string): Promise<ChapterState> {
    const chapter = await EntitiesRepository.getChapter(this.db, chapterId);
    if (!chapter) {
      throw new NotFoundError('CHAPTER_NOT_FOUND', `Chapter '${chapterId}' not found.`);
    }

    const subject = await EntitiesRepository.getSubject(this.db, chapter.subjectId);
    if (!subject) {
      throw new NotFoundError('SUBJECT_NOT_FOUND', `Subject '${chapter.subjectId}' not found.`);
    }

    const parentChapter = chapter.parentId
      ? await EntitiesRepository.getChapter(this.db, chapter.parentId)
      : null;

    const progress = await ProjectionsRepository.getStudyProgressByChapter(this.db, chapterId);
    const sourceMappings = await EntitiesRepository.getSourceMappingsForChapter(this.db, chapterId);
    const recentEvents = await CanonicalEventsRepository.getRecentActivity(this.db, {
      chapterId,
      limit: 10,
    });

    const isCompleted = chapter.status === 'completed' || progress?.status === 'COMPLETED' || (progress?.progressPercent ?? 0) >= 1.0;
    const lastEvent = recentEvents[0];

    return {
      chapter,
      subject,
      parentChapter,
      completionState: {
        status: chapter.status,
        isCompleted,
        completedAt: progress?.lastCompletedAt ?? undefined,
      },
      progress: {
        progressPercent: progress?.progressPercent ?? chapter.progress,
        confidence: progress?.confidence ?? 0.0,
        questionsAttempted: progress?.questionsAttempted ?? 0,
        questionsCorrect: progress?.questionsCorrect ?? 0,
        accuracy: progress?.accuracy ?? 0.0,
        studyTimeMinutes: 0,
        lastStudiedAt: progress?.lastStudiedAt ?? undefined,
      },
      recentEvents: recentEvents.map(e => ({
        eventId: e.eventId,
        eventType: e.eventType,
        occurredAt: e.occurredAt,
      })),
      lastActivity: lastEvent
        ? { occurredAt: lastEvent.occurredAt, eventType: lastEvent.eventType }
        : undefined,
      linkedSourceMappings: sourceMappings,
    };
  }

  /**
   * 5. get_recent_activity:
   * Reconstructed directly from immutable canonical events.
   */
  async getRecentActivity(filters: ActivityFilterParams = {}): Promise<CanonicalEvent[]> {
    return await CanonicalEventsRepository.getRecentActivity(this.db, filters);
  }

  /**
   * 6. get_pending_work:
   * Unified pending-work read surface distinguishing study work, external tasks, and sync/reliability work.
   */
  async getPendingWork(): Promise<PendingWorkState> {
    const allChapters = await EntitiesRepository.getAllChapters(this.db);
    const allProgress = await ProjectionsRepository.getAllStudyProgress(this.db);

    const studyWork = allChapters
      .filter(c => c.status === 'in_progress' || (c.progress > 0 && c.progress < 1.0))
      .map(c => {
        const prog = allProgress.find(p => p.chapterId === c.id);
        return {
          id: c.id,
          category: 'study' as const,
          title: `Study Chapter: ${c.name}`,
          status: c.status,
          entityType: 'chapter',
          entityId: c.id,
          priority: 'normal',
        };
      });

    const taskLinks = await EntitiesRepository.getTaskLinks(this.db);
    const externalTasks = taskLinks
      .filter(t => t.statusSnapshot === 'needsAction' || !t.statusSnapshot)
      .map(t => ({
        id: t.id,
        category: 'external_task' as const,
        title: t.titleSnapshot ?? `Task ${t.taskId}`,
        status: t.statusSnapshot ?? 'needsAction',
        entityType: t.entityType,
        entityId: t.entityId,
      }));

    const syncJobs = await this.db
      .selectFrom('sync_jobs')
      .selectAll()
      .where('status', 'in', ['FAILED', 'DEAD_LETTER'])
      .execute();

    const syncWork = syncJobs.map(j => ({
      id: j.job_id,
      category: 'sync' as const,
      title: `Sync Retry: ${j.target_system} ${j.entity_type}:${j.entity_id}`,
      status: j.status,
      entityType: j.entity_type,
      entityId: j.entity_id,
      lastError: j.last_error ?? undefined,
      attemptCount: j.attempt_count,
    }));

    return {
      totalPendingCount: studyWork.length + externalTasks.length + syncWork.length,
      studyWork,
      externalTasks,
      syncWork,
    };
  }

  /**
   * 7. get_schedule_context:
   * Precision time authority context from Google Calendar blocks.
   * Reports context without performing scheduling intelligence or calendar mutations.
   */
  async getScheduleContext(params?: {
    date?: string;
    timezone?: string;
    currentTimestamp?: string;
  }): Promise<ScheduleContextState> {
    let timezone = params?.timezone;
    if (!timezone) {
      const user = await this.db.selectFrom('users').select('timezone').executeTakeFirst();
      timezone = user?.timezone ?? 'UTC';
    }

    const refTime = params?.currentTimestamp ?? new Date().toISOString();
    const date = params?.date ?? ProjectionEngine.extractDate(refTime, timezone);

    const startOfDay = `${date}T00:00:00.000Z`;
    const endOfDay = `${date}T23:59:59.999Z`;
    const calendarLinks = await EntitiesRepository.getCalendarLinks(this.db, startOfDay, endOfDay);

    const blocks: ScheduleContextBlock[] = calendarLinks.map(l => ({
      id: l.id,
      calendarEventId: l.eventId,
      entityType: l.entityType,
      entityId: l.entityId,
      titleSnapshot: l.titleSnapshot,
      startsAt: l.startsAt,
      endsAt: l.endsAt,
      statusSnapshot: l.statusSnapshot,
    }));

    // Find current or next upcoming block
    let currentOrNextBlock: ScheduleContextBlock | null = null;
    const current = blocks.find(b => b.startsAt <= refTime && b.endsAt >= refTime);
    if (current) {
      currentOrNextBlock = current;
    } else {
      const upcoming = blocks
        .filter(b => b.startsAt > refTime)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      currentOrNextBlock = upcoming[0] ?? null;
    }

    // Identify conflicts (overlapping schedule blocks)
    const conflicts: Array<{ blockA: ScheduleContextBlock; blockB: ScheduleContextBlock }> = [];
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i];
        const b = blocks[j];
        if (a.startsAt < b.endsAt && a.endsAt > b.startsAt) {
          conflicts.push({ blockA: a, blockB: b });
        }
      }
    }

    // Missed sessions
    const missedEvents = await CanonicalEventsRepository.getRecentActivity(this.db, {
      startDate: startOfDay,
      endDate: endOfDay,
      eventType: 'schedule_missed',
    });

    const missedSessions = missedEvents.map(e => {
      const p = e.payload as Record<string, unknown>;
      return {
        calendarEventId: (p.calendarEventId as string) ?? '',
        scheduledStart: (p.scheduledStart as string) ?? e.occurredAt,
        scheduledEnd: (p.scheduledEnd as string) ?? e.occurredAt,
        reason: (p.reason as string) ?? undefined,
      };
    });

    // Linked study sessions for today
    const sessionEvents = await CanonicalEventsRepository.getRecentActivity(this.db, {
      startDate: startOfDay,
      endDate: endOfDay,
      eventType: 'study_session_recorded',
    });

    const linkedStudyActivity = sessionEvents.map(e => {
      const p = e.payload as Record<string, unknown>;
      return {
        sessionId: (p.sessionId as string) ?? '',
        chapterId: (p.chapterId as string) ?? '',
        startsAt: (p.startedAt as string) ?? e.occurredAt,
        endsAt: (p.endedAt as string) ?? e.occurredAt,
      };
    });

    return {
      date,
      timezone,
      calendarBlocks: blocks,
      currentOrNextBlock,
      conflicts,
      missedSessions,
      linkedStudyActivity,
    };
  }

  /**
   * 8. search_memory:
   * Semantic-safe memory retrieval over facts, versions, decisions, and research.
   * Preserves temporal history; does not store chain-of-thought.
   */
  async searchMemory(params: {
    query?: string;
    category?: string;
    includeHistorical?: boolean;
    limit?: number;
  }): Promise<MemorySearchState> {
    const query = params.query?.toLowerCase();
    const limit = Math.min(params.limit ?? 50, 100);

    // 1. Facts
    const facts = await EntitiesRepository.getMemoryFacts(
      this.db,
      params.category,
      !params.includeHistorical
    );

    const items: MemorySearchItem[] = [];

    for (const f of facts) {
      if (!query || f.fact.toLowerCase().includes(query)) {
        const versions = await EntitiesRepository.getMemoryVersions(this.db, f.id);
        items.push({
          id: f.id,
          type: 'fact',
          title: `[${f.category}] Fact`,
          content: f.fact,
          category: f.category,
          createdAt: f.createdAt,
          validAt: f.validAt,
          invalidAt: f.invalidAt,
          versionsCount: versions.length,
        });
      }
    }

    // 2. Decisions
    const decisions = await EntitiesRepository.getDecisions(this.db, undefined, limit);
    for (const d of decisions) {
      const combined = `${d.title} ${d.context} ${d.decision} ${d.consequences ?? ''}`.toLowerCase();
      if (!query || combined.includes(query)) {
        items.push({
          id: d.id,
          type: 'decision',
          title: d.title,
          content: `Decision: ${d.decision}\nContext: ${d.context}${d.consequences ? `\nConsequences: ${d.consequences}` : ''}`,
          createdAt: d.createdAt,
        });
      }
    }

    // 3. Research Events
    const researchEvents = await EntitiesRepository.getResearchEvents(this.db, limit);
    for (const r of researchEvents) {
      const combined = `${r.topic} ${r.source} ${r.summary}`.toLowerCase();
      if (!query || combined.includes(query)) {
        items.push({
          id: r.id,
          type: 'research',
          title: r.topic,
          content: `${r.summary} (Source: ${r.source})`,
          createdAt: r.createdAt,
        });
      }
    }

    // Sort by createdAt desc
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const sliced = items.slice(0, limit);

    return {
      query: params.query,
      totalFound: sliced.length,
      items: sliced,
    };
  }

  /**
   * 9. get_project_state:
   * Exposes machine state for projects without becoming a GitHub replacement.
   */
  async getProjectState(projectId: string): Promise<ProjectState> {
    const project = await EntitiesRepository.getProject(this.db, projectId);
    if (!project) {
      throw new NotFoundError('PROJECT_NOT_FOUND', `Project '${projectId}' not found.`);
    }

    const events = await EntitiesRepository.getProjectEvents(this.db, projectId);
    const decisions = await EntitiesRepository.getDecisions(this.db, projectId);
    const research = await EntitiesRepository.getResearchEvents(this.db);
    const linkedResearch = research.filter(r => r.topic.includes(project.name) || r.summary.includes(project.name));

    const taskLinks = await EntitiesRepository.getTaskLinks(this.db, 'project', projectId);

    const pendingSyncJobs = await this.db
      .selectFrom('sync_jobs')
      .selectAll()
      .where('entity_id', '=', projectId)
      .where('status', 'in', ['PENDING', 'PROCESSING', 'FAILED'])
      .execute();

    const milestones = events.filter(e => e.eventType === 'milestone_reached');
    const completedMilestones = events.filter(e => e.eventType === 'completed');

    return {
      project,
      recentEvents: events,
      decisions,
      research: linkedResearch,
      taskLinks,
      syncStatus: {
        pendingSyncJobsCount: pendingSyncJobs.length,
      },
      latestProgress: {
        milestonesCount: milestones.length,
        completedMilestonesCount: completedMilestones.length,
      },
    };
  }

  /**
   * 9b. get_agent_state:
   * Exposes machine execution state for an autonomous agent run.
   */
  async getAgentState(runId: string): Promise<AgentRun> {
    const run = await EntitiesRepository.getAgentRun(this.db, runId);
    if (!run) {
      throw new NotFoundError('ENTITY_NOT_FOUND', `Agent run '${runId}' not found.`);
    }
    return run;
  }

  /**
   * 9c. get_recent_agent_runs:
   * Returns recent agent execution records.
   */
  async getRecentAgentRuns(agentName?: string, limit?: number): Promise<AgentRun[]> {
    return await EntitiesRepository.getRecentAgentRuns(this.db, { agentName, limit });
  }

  /**
   * 9d. get_source_state:
   * Returns source details, chapter structure (TOC), and canonical mappings.
   */
  async getSourceState(sourceId: string): Promise<SourceState> {
    const source = await EntitiesRepository.getSource(this.db, sourceId);
    if (!source) {
      throw new NotFoundError('ENTITY_NOT_FOUND', `Source '${sourceId}' not found.`);
    }

    const chapters = await EntitiesRepository.getSourceChapters(this.db, sourceId);
    const mappings = await EntitiesRepository.getSourceMappingsBySource(this.db, sourceId);

    return {
      source,
      chapters,
      mappings,
    };
  }

  /**
   * 9e. list_sources:
   * Lists registered external study sources without copyrighted content.
   */
  async listSources(limit?: number): Promise<Source[]> {
    return await EntitiesRepository.listSources(this.db, limit);
  }

  /**
   * 10. get_sync_status:
   * Aggregated synchronization health without exposing secrets or credentials.
   */
  async getSyncStatus(): Promise<SyncStatusState> {
    return await ReliabilityRepository.getSyncStatusSummary(this.db);
  }

  // ==========================================================================
  // SEMANTIC MUTATION SURFACE (8 Operations)
  // ==========================================================================

  /**
   * Generic Idempotency Wrapper
   */
  private async withIdempotency<T>(
    operation: string,
    idempotency: IdempotencyContext | undefined,
    fallbackPayload: unknown,
    executeFn: () => Promise<T>
  ): Promise<T> {
    if (!idempotency?.key) {
      return await executeFn();
    }

    const requestHash = hashPayload(idempotency.requestPayload ?? fallbackPayload);
    const claim = await ReliabilityRepository.claimIdempotency(this.db, {
      idempotencyKey: idempotency.key,
      operation,
      sourceSystem: idempotency.sourceSystem ?? 'rest',
      requestHash,
    });

    if (claim.state === 'COMPLETED' && claim.cachedPayload) {
      const cached = JSON.parse(claim.cachedPayload);
      if (typeof cached === 'object' && cached !== null) {
        return { ...cached, replayed: true } as T;
      }
      return cached as T;
    }

    if (claim.state === 'IN_PROGRESS') {
      throw new ConflictError(
        'IDEMPOTENCY_CONFLICT',
        `Operation '${operation}' with idempotency key '${idempotency.key}' is currently in progress.`
      );
    }

    // Execute mutation
    const result = await executeFn();

    // Finalize idempotency
    const resultHash = hashPayload(result);
    await ReliabilityRepository.finalizeIdempotency(this.db, {
      idempotencyKey: idempotency.key,
      status: 'COMPLETED',
      resultPayload: JSON.stringify(result),
      resultHash,
    });

    return result;
  }

  /**
   * 11. record_event:
   * The primary mutation pipeline.
   */
  async recordEvent(
    input: CreateCanonicalEventInput,
    idempotency?: IdempotencyContext
  ): Promise<MutationResult> {
    return this.withIdempotency('record_event', idempotency, input, async () => {
      const result = await AtomicWriter.ingestAndProjectAtomic(this.d1, this.db, {
        event: input,
      });

      // Operational projections for agent lifecycle, checkpoints, and source registration
      const ev = result.event;
      if (ev.eventType === 'agent_started') {
        const p = ev.payload as any;
        await EntitiesRepository.insertAgentRun(this.db, {
          id: p.runId,
          agentName: p.agentName,
          runType: p.runType,
          status: 'started',
          startedAt: ev.occurredAt,
          completedAt: null,
          resultSummary: null,
          errorCode: null,
          payload: JSON.stringify(p),
          createdAt: ev.recordedAt,
        });
      } else if (ev.eventType === 'agent_completed') {
        const p = ev.payload as any;
        await EntitiesRepository.updateAgentRun(this.db, p.runId, {
          status: 'completed',
          completedAt: ev.occurredAt,
          resultSummary: p.resultSummary,
        });
      } else if (ev.eventType === 'agent_failed') {
        const p = ev.payload as any;
        await EntitiesRepository.updateAgentRun(this.db, p.runId, {
          status: 'failed',
          completedAt: ev.occurredAt,
          errorCode: p.errorCode,
          resultSummary: p.errorMessage,
        });
      } else if (ev.eventType === 'checkpoint_created') {
        const p = ev.payload as any;
        await EntitiesRepository.insertCheckpoint(this.db, {
          id: p.checkpointId,
          checkpointName: p.checkpointName,
          checkpointType: p.checkpointType,
          stateData: '{}',
          createdAt: ev.recordedAt,
        });
      } else if (ev.eventType === 'project_started') {
        const p = ev.payload as any;
        const existing = await EntitiesRepository.getProject(this.db, p.projectId);
        if (!existing) {
          await EntitiesRepository.insertProject(this.db, {
            id: p.projectId,
            name: p.name,
            description: p.description ?? null,
            status: 'active',
            createdAt: ev.recordedAt,
            updatedAt: ev.recordedAt,
          });
        }
        await EntitiesRepository.insertProjectEvent(this.db, {
          id: generateId('progevt'),
          projectId: p.projectId,
          eventType: 'started',
          actor: ev.actor.type,
          payloadJson: JSON.stringify(p),
          createdAt: ev.recordedAt,
        });
      } else if (ev.eventType === 'project_updated') {
        const p = ev.payload as any;
        await EntitiesRepository.updateProject(this.db, p.projectId, {
          status: p.status,
          description: p.description,
          updatedAt: ev.recordedAt,
        });
        await EntitiesRepository.insertProjectEvent(this.db, {
          id: generateId('progevt'),
          projectId: p.projectId,
          eventType: p.milestone ? 'milestone_reached' : 'started',
          actor: ev.actor.type,
          payloadJson: JSON.stringify(p),
          createdAt: ev.recordedAt,
        });
      } else if (ev.eventType === 'project_completed') {
        const p = ev.payload as any;
        await EntitiesRepository.updateProject(this.db, p.projectId, {
          status: 'completed',
          updatedAt: ev.recordedAt,
        });
        await EntitiesRepository.insertProjectEvent(this.db, {
          id: generateId('progevt'),
          projectId: p.projectId,
          eventType: 'completed',
          actor: ev.actor.type,
          payloadJson: JSON.stringify(p),
          createdAt: ev.recordedAt,
        });
      } else if (ev.eventType === 'source_registered') {
        const p = ev.payload as any;
        const existing = await EntitiesRepository.getSource(this.db, p.sourceId);
        if (!existing) {
          await EntitiesRepository.insertSource(this.db, {
            id: p.sourceId,
            title: p.title,
            sourceType: p.sourceType,
            author: p.author ?? null,
            publisher: p.publisher ?? null,
            edition: p.edition ?? null,
            referenceUri: p.referenceUri ?? null,
            status: 'registered',
            createdAt: ev.recordedAt,
            updatedAt: ev.recordedAt,
          });
        }
      } else if (ev.eventType === 'source_chapter_created') {
        const p = ev.payload as any;
        await EntitiesRepository.insertSourceChapter(this.db, {
          id: p.sourceChapterId,
          sourceId: p.sourceId,
          title: p.title,
          chapterNumber: p.chapterNumber ?? null,
          locationReference: p.locationReference ?? null,
          parentChapterId: p.parentChapterId ?? null,
          createdAt: ev.recordedAt,
          updatedAt: ev.recordedAt,
        });
      } else if (ev.eventType === 'source_mapped') {
        const p = ev.payload as any;
        const mappingId = p.sourceMappingId || generateId('map');
        await EntitiesRepository.insertSourceMapping(this.db, {
          id: mappingId,
          sourceChapterId: p.sourceChapterId,
          canonicalChapterId: p.canonicalChapterId,
          subjectId: p.subjectId ?? null,
          mappingType: p.mappingType || 'direct',
          relevance: p.relevance || 'high',
          confidence: p.confidence ?? 1.0,
          notes: p.notes ?? null,
          createdAt: ev.recordedAt,
          updatedAt: ev.recordedAt,
        });
      } else if (ev.eventType === 'source_mapping_completed') {
        const p = ev.payload as any;
        await this.db
          .updateTable('sources')
          .set({ status: 'mapped', updated_at: ev.recordedAt })
          .where('id', '=', p.sourceId)
          .execute();
      }

      return {
        success: true,
        operation: 'record_event',
        eventId: result.event.eventId,
        data: result.event,
      };
    });
  }

  /**
   * 12. record_study_session:
   * Convenience semantic operation for recording study sessions with mathematical constraints.
   */
  async recordStudySession(
    rawInput: RecordStudySessionInput,
    idempotency?: IdempotencyContext
  ): Promise<MutationResult> {
    const input = RecordStudySessionInputSchema.parse(rawInput);

    return this.withIdempotency('record_study_session', idempotency, input, async () => {
      // Validate chapter exists and belongs to subject
      const chapter = await EntitiesRepository.getChapter(this.db, input.chapterId);
      if (!chapter) {
        throw new NotFoundError('CHAPTER_NOT_FOUND', `Chapter '${input.chapterId}' not found.`);
      }
      if (chapter.subjectId !== input.subjectId) {
        throw new NotFoundError(
          'SUBJECT_NOT_FOUND',
          `Chapter '${input.chapterId}' belongs to subject '${chapter.subjectId}', not '${input.subjectId}'.`
        );
      }

      if (input.questionsCorrect > input.questionsAttempted) {
        throw new MathematicalConstraintError('questionsCorrect cannot exceed questionsAttempted');
      }

      const sessionId = generateId('sess');
      const now = new Date().toISOString();

      // Persist to study_sessions table
      await this.db
        .insertInto('study_sessions')
        .values({
          id: sessionId,
          subject_id: input.subjectId,
          chapter_id: input.chapterId,
          started_at: input.startedAt,
          ended_at: input.endedAt,
          duration_seconds: input.durationSeconds,
          activity_type: input.activityType,
          source: input.source,
          status: 'completed',
          created_at: now,
          updated_at: now,
        })
        .execute();

      // Ingest canonical event atomically with projection updates
      const event = CanonicalEventEngine.createEvent({
        eventType: 'study_session_recorded',
        actor: { type: 'user', id: 'usr_operator' },
        source: { system: 'chatgpt', interface: 'rest' },
        payload: {
          sessionId,
          chapterId: input.chapterId,
          subjectId: input.subjectId,
          startedAt: input.startedAt,
          endedAt: input.endedAt,
          durationSeconds: input.durationSeconds,
          activityType: input.activityType,
          source: input.source,
        },
        correlationId: input.correlationId,
        causationId: input.causationId,
      });

      await AtomicWriter.ingestAndProjectAtomic(this.d1, this.db, { event });

      // If questions attempted, record assessment event
      if (input.questionsAttempted > 0) {
        const accuracy = deriveAccuracy(input.questionsCorrect, input.questionsAttempted);
        const questionsEvent = CanonicalEventEngine.createEvent({
          eventType: 'questions_attempted',
          actor: { type: 'user', id: 'usr_operator' },
          source: { system: 'chatgpt', interface: 'rest' },
          payload: {
            chapterId: input.chapterId,
            subjectId: input.subjectId,
            questionsAttempted: input.questionsAttempted,
            questionsCorrect: input.questionsCorrect,
            accuracy,
          },
          correlationId: input.correlationId,
          causationId: event.eventId,
        });
        await AtomicWriter.ingestAndProjectAtomic(this.d1, this.db, { event: questionsEvent });
      }

      return {
        success: true,
        operation: 'record_study_session',
        eventId: event.eventId,
        entityId: sessionId,
        data: { sessionId, durationSeconds: input.durationSeconds },
      };
    });
  }

  /**
   * 13. update_progress:
   * Event-first progress mutation.
   */
  async updateProgress(
    rawInput: UpdateProgressInput,
    idempotency?: IdempotencyContext
  ): Promise<MutationResult> {
    const input = UpdateProgressInputSchema.parse(rawInput);

    return this.withIdempotency('update_progress', idempotency, input, async () => {
      const chapter = await EntitiesRepository.getChapter(this.db, input.chapterId);
      if (!chapter) {
        throw new NotFoundError('CHAPTER_NOT_FOUND', `Chapter '${input.chapterId}' not found.`);
      }

      const now = new Date().toISOString();
      const newStatus = input.progress >= 1.0 ? 'completed' : input.progress > 0 ? 'in_progress' : chapter.status;

      // Update chapter mutable record
      await this.db
        .updateTable('chapters')
        .set({
          progress: input.progress,
          status: newStatus,
          updated_at: now,
        })
        .where('id', '=', input.chapterId)
        .execute();

      // Emit canonical event
      const event = CanonicalEventEngine.createEvent({
        eventType: 'chapter_progress_updated',
        actor: { type: 'user', id: 'usr_operator' },
        source: { system: 'chatgpt', interface: 'rest' },
        payload: {
          chapterId: input.chapterId,
          progress: input.progress,
          subjectId: chapter.subjectId,
        },
        correlationId: input.correlationId,
        causationId: input.causationId,
      });

      await AtomicWriter.ingestAndProjectAtomic(this.d1, this.db, { event });

      return {
        success: true,
        operation: 'update_progress',
        eventId: event.eventId,
        entityId: input.chapterId,
        data: { chapterId: input.chapterId, progress: input.progress, status: newStatus },
      };
    });
  }

  /**
   * 14. complete_chapter:
   * Semantic chapter completion updating mutable entity, recording canonical event and projections.
   */
  async completeChapter(
    rawInput: CompleteChapterInput,
    idempotency?: IdempotencyContext
  ): Promise<MutationResult> {
    const input = CompleteChapterInputSchema.parse(rawInput);

    return this.withIdempotency('complete_chapter', idempotency, input, async () => {
      const chapter = await EntitiesRepository.getChapter(this.db, input.chapterId);
      if (!chapter) {
        throw new NotFoundError('CHAPTER_NOT_FOUND', `Chapter '${input.chapterId}' not found.`);
      }

      if (input.subjectId && chapter.subjectId !== input.subjectId) {
        throw new NotFoundError(
          'SUBJECT_NOT_FOUND',
          `Chapter '${input.chapterId}' belongs to subject '${chapter.subjectId}', not '${input.subjectId}'.`
        );
      }

      const now = new Date().toISOString();
      await this.db
        .updateTable('chapters')
        .set({
          status: 'completed',
          progress: 1.0,
          updated_at: now,
        })
        .where('id', '=', input.chapterId)
        .execute();

      const event = CanonicalEventEngine.createEvent({
        eventType: 'chapter_completed',
        actor: { type: 'user', id: 'usr_operator' },
        source: { system: 'chatgpt', interface: 'rest' },
        payload: {
          chapterId: input.chapterId,
          subjectId: chapter.subjectId,
        },
        correlationId: input.correlationId,
        causationId: input.causationId,
      });

      await AtomicWriter.ingestAndProjectAtomic(this.d1, this.db, { event });

      return {
        success: true,
        operation: 'complete_chapter',
        eventId: event.eventId,
        entityId: input.chapterId,
        data: { chapterId: input.chapterId, status: 'completed', progress: 1.0 },
      };
    });
  }

  /**
   * 15. record_research:
   * Records structured research outcomes.
   */
  async recordResearch(
    rawInput: RecordResearchInput,
    idempotency?: IdempotencyContext
  ): Promise<MutationResult> {
    const input = RecordResearchInputSchema.parse(rawInput);

    return this.withIdempotency('record_research', idempotency, input, async () => {
      if (input.projectId) {
        const project = await EntitiesRepository.getProject(this.db, input.projectId);
        if (!project) {
          throw new NotFoundError('PROJECT_NOT_FOUND', `Project '${input.projectId}' not found.`);
        }
      }

      if (input.chapterId) {
        const chapter = await EntitiesRepository.getChapter(this.db, input.chapterId);
        if (!chapter) {
          throw new NotFoundError('CHAPTER_NOT_FOUND', `Chapter '${input.chapterId}' not found.`);
        }
      }

      const researchEventId = generateId('resevt');
      const now = new Date().toISOString();

      await EntitiesRepository.insertResearchEvent(this.db, {
        id: researchEventId,
        topic: input.topic,
        source: input.source,
        summary: input.summary,
        payloadJson: input.payloadJson ?? null,
        createdAt: now,
      });

      const event = CanonicalEventEngine.createEvent({
        eventType: 'research_completed',
        actor: { type: 'user', id: 'usr_operator' },
        source: { system: 'chatgpt', interface: 'rest' },
        payload: {
          topic: input.topic,
          source: input.source,
          summary: input.summary,
          takeaways: input.takeaways ?? [],
        },
        correlationId: input.correlationId,
        causationId: input.causationId,
      });

      await AtomicWriter.ingestAndProjectAtomic(this.d1, this.db, { event });

      return {
        success: true,
        operation: 'record_research',
        eventId: event.eventId,
        entityId: researchEventId,
        data: { researchEventId, topic: input.topic },
      };
    });
  }

  /**
   * 16. record_decision:
   * Durable decision recording.
   */
  async recordDecision(
    rawInput: RecordDecisionInput,
    idempotency?: IdempotencyContext
  ): Promise<MutationResult> {
    const input = RecordDecisionInputSchema.parse(rawInput);

    return this.withIdempotency('record_decision', idempotency, input, async () => {
      if (input.projectId) {
        const project = await EntitiesRepository.getProject(this.db, input.projectId);
        if (!project) {
          throw new NotFoundError('PROJECT_NOT_FOUND', `Project '${input.projectId}' not found.`);
        }
      }

      const decisionId = generateId('dec');
      const now = new Date().toISOString();

      await EntitiesRepository.insertDecision(this.db, {
        id: decisionId,
        projectId: input.projectId ?? null,
        title: input.title,
        context: input.context,
        decision: input.decision,
        consequences: input.consequences ?? null,
        createdAt: now,
      });

      const event = CanonicalEventEngine.createEvent({
        eventType: 'decision_recorded',
        actor: { type: 'user', id: 'usr_operator' },
        source: { system: 'chatgpt', interface: 'rest' },
        payload: {
          decisionId,
          projectId: input.projectId,
          title: input.title,
          decision: input.decision,
          consequences: input.consequences,
        },
        correlationId: input.correlationId,
        causationId: input.causationId,
      });

      await AtomicWriter.ingestAndProjectAtomic(this.d1, this.db, { event });

      return {
        success: true,
        operation: 'record_decision',
        eventId: event.eventId,
        entityId: decisionId,
        data: { decisionId, title: input.title },
      };
    });
  }

  /**
   * 17. link_task:
   * Semantic linkage between internal entities and external Google Tasks.
   */
  async linkTask(
    rawInput: LinkTaskInput,
    idempotency?: IdempotencyContext
  ): Promise<MutationResult> {
    const input = LinkTaskInputSchema.parse(rawInput);

    return this.withIdempotency('link_task', idempotency, input, async () => {
      if (input.entityType === 'chapter') {
        const chapter = await EntitiesRepository.getChapter(this.db, input.entityId);
        if (!chapter) {
          throw new NotFoundError('CHAPTER_NOT_FOUND', `Chapter '${input.entityId}' not found.`);
        }
      } else if (input.entityType === 'project') {
        const project = await EntitiesRepository.getProject(this.db, input.entityId);
        if (!project) {
          throw new NotFoundError('PROJECT_NOT_FOUND', `Project '${input.entityId}' not found.`);
        }
      }

      const taskLinkId = generateId('tasklink');
      const now = new Date().toISOString();

      await EntitiesRepository.insertTaskLink(this.db, {
        id: taskLinkId,
        provider: input.provider,
        tasklistId: input.tasklistId,
        taskId: input.taskId,
        entityType: input.entityType,
        entityId: input.entityId,
        titleSnapshot: input.titleSnapshot ?? null,
        statusSnapshot: input.statusSnapshot,
        lastSyncedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      const event = CanonicalEventEngine.createEvent({
        eventType: 'task_created',
        actor: { type: 'user', id: 'usr_operator' },
        source: { system: 'google_tasks', interface: 'rest' },
        payload: {
          taskLinkId,
          tasklistId: input.tasklistId,
          taskId: input.taskId,
          entityType: input.entityType,
          entityId: input.entityId,
          title: input.titleSnapshot ?? 'Untitled Task',
        },
        correlationId: input.correlationId,
        causationId: input.causationId,
      });

      await AtomicWriter.ingestAndProjectAtomic(this.d1, this.db, { event });

      return {
        success: true,
        operation: 'link_task',
        eventId: event.eventId,
        entityId: taskLinkId,
        data: { taskLinkId, taskId: input.taskId },
      };
    });
  }

  /**
   * 18. link_calendar_event:
   * Semantic linkage to Google Calendar event block.
   */
  async linkCalendarEvent(
    rawInput: LinkCalendarEventInput,
    idempotency?: IdempotencyContext
  ): Promise<MutationResult> {
    const input = LinkCalendarEventInputSchema.parse(rawInput);

    return this.withIdempotency('link_calendar_event', idempotency, input, async () => {
      const calendarLinkId = generateId('callink');
      const now = new Date().toISOString();

      await EntitiesRepository.insertCalendarLink(this.db, {
        id: calendarLinkId,
        provider: input.provider,
        calendarId: input.calendarId,
        eventId: input.eventId,
        entityType: input.entityType,
        entityId: input.entityId,
        titleSnapshot: input.titleSnapshot ?? null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        statusSnapshot: input.statusSnapshot,
        lastSyncedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      return {
        success: true,
        operation: 'link_calendar_event',
        entityId: calendarLinkId,
        data: { calendarLinkId, eventId: input.eventId },
      };
    });
  }

  /**
   * 19. link_schedule:
   * Establish linkage between an existing task link and a calendar event link in schedule_links.
   */
  async linkSchedule(
    rawInput: LinkScheduleInput,
    idempotency?: IdempotencyContext
  ): Promise<MutationResult> {
    const input = LinkScheduleInputSchema.parse(rawInput);

    return this.withIdempotency('link_schedule', idempotency, input, async () => {
      // Check if relationship already exists
      const existing = await EntitiesRepository.getScheduleLinks(
        this.db,
        input.taskId,
        input.calendarEventId
      );
      if (existing.length > 0) {
        return {
          success: true,
          operation: 'link_schedule',
          entityId: existing[0].id,
          replayed: true,
          data: { scheduleLinkId: existing[0].id, taskId: input.taskId, calendarEventId: input.calendarEventId },
        };
      }

      const scheduleLinkId = generateId('schedlink');
      const now = new Date().toISOString();

      await EntitiesRepository.insertScheduleLink(this.db, {
        id: scheduleLinkId,
        taskId: input.taskId,
        calendarEventId: input.calendarEventId,
        relationshipType: input.relationshipType,
        createdAt: now,
        updatedAt: now,
      });

      return {
        success: true,
        operation: 'link_schedule',
        entityId: scheduleLinkId,
        data: { scheduleLinkId, taskId: input.taskId, calendarEventId: input.calendarEventId },
      };
    });
  }
}
