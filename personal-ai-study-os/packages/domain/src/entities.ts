import { z } from 'zod';

// ============================================================================
// 1. IDENTITY & CORE DOMAIN
// ============================================================================

export const UserStatusSchema = z.enum(['active', 'suspended', 'deactivated']);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const UserSchema = z.object({
  id: z.string().startsWith('usr_'),
  timezone: z.string().default('UTC'),
  status: UserStatusSchema.default('active'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type User = z.infer<typeof UserSchema>;

export const SubjectStatusSchema = z.enum(['active', 'archived']);
export type SubjectStatus = z.infer<typeof SubjectStatusSchema>;

export const SubjectSchema = z.object({
  id: z.string().startsWith('subj_'),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().nullable().optional(),
  status: SubjectStatusSchema.default('active'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Subject = z.infer<typeof SubjectSchema>;

export const ChapterStatusSchema = z.enum(['not_started', 'in_progress', 'completed']);
export type ChapterStatus = z.infer<typeof ChapterStatusSchema>;

export const ChapterSchema = z.object({
  id: z.string().startsWith('chap_'),
  subjectId: z.string().startsWith('subj_'),
  name: z.string().min(1),
  slug: z.string().min(1),
  parentId: z.string().startsWith('chap_').nullable().optional(),
  status: ChapterStatusSchema.default('not_started'),
  progress: z.number().min(0.0).max(1.0).default(0.0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Chapter = z.infer<typeof ChapterSchema>;

// ============================================================================
// 2. STUDY DOMAIN
// ============================================================================

export const StudyActivityTypeSchema = z.enum(['revision', 'pyq_practice', 'lecture', 'deep_work']);
export type StudyActivityType = z.infer<typeof StudyActivityTypeSchema>;

export const StudySessionStatusSchema = z.enum(['completed', 'interrupted']);
export type StudySessionStatus = z.infer<typeof StudySessionStatusSchema>;

export const StudySessionSchema = z.object({
  id: z.string().startsWith('sess_'),
  subjectId: z.string().startsWith('subj_'),
  chapterId: z.string().startsWith('chap_'),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  durationSeconds: z.number().int().min(0),
  activityType: StudyActivityTypeSchema,
  source: z.string().min(1),
  status: StudySessionStatusSchema.default('completed'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).refine(data => new Date(data.endedAt).getTime() >= new Date(data.startedAt).getTime(), {
  message: 'endedAt must be greater than or equal to startedAt',
  path: ['endedAt'],
});
export type StudySession = z.infer<typeof StudySessionSchema>;

export const StudyProgressStatusSchema = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']);
export type StudyProgressStatus = z.infer<typeof StudyProgressStatusSchema>;

export const StudyProgressSchema = z.object({
  id: z.string().startsWith('prog_'),
  subjectId: z.string().startsWith('subj_'),
  chapterId: z.string().startsWith('chap_'),
  status: StudyProgressStatusSchema.default('NOT_STARTED'),
  progressPercent: z.number().min(0.0).max(1.0).default(0.0),
  confidence: z.number().min(0.0).max(1.0).default(0.0),
  lastStudiedAt: z.string().datetime().nullable().optional(),
  lastCompletedAt: z.string().datetime().nullable().optional(),
  questionsAttempted: z.number().int().min(0).default(0),
  questionsCorrect: z.number().int().min(0).default(0),
  accuracy: z.number().min(0.0).max(1.0).default(0.0),
  updatedAt: z.string().datetime(),
}).refine(data => data.questionsCorrect <= data.questionsAttempted, {
  message: 'questionsCorrect cannot exceed questionsAttempted',
  path: ['questionsCorrect'],
});
export type StudyProgress = z.infer<typeof StudyProgressSchema>;

export const DailyStateSchema = z.object({
  id: z.string().startsWith('daily_'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be formatted YYYY-MM-DD'),
  studyMinutes: z.number().int().min(0).default(0),
  completedChapters: z.number().int().min(0).default(0),
  questionsAttempted: z.number().int().min(0).default(0),
  questionsCorrect: z.number().int().min(0).default(0),
  accuracy: z.number().min(0.0).max(1.0).default(0.0),
  missedSessions: z.number().int().min(0).default(0),
  completedTasks: z.number().int().min(0).default(0),
  pendingTasks: z.number().int().min(0).default(0),
  statePayload: z.string().default('{}'),
  updatedAt: z.string().datetime(),
}).refine(data => data.questionsCorrect <= data.questionsAttempted, {
  message: 'questionsCorrect cannot exceed questionsAttempted',
  path: ['questionsCorrect'],
});
export type DailyState = z.infer<typeof DailyStateSchema>;

// ============================================================================
// 3. SOURCES DOMAIN
// ============================================================================

export const SourceTypeSchema = z.enum(['book', 'pdf', 'syllabus', 'notes']);
export type SourceType = z.infer<typeof SourceTypeSchema>;

export const SourceStatusSchema = z.enum(['registered', 'mapped', 'archived']);
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

export const SourceSchema = z.object({
  id: z.string().startsWith('src_'),
  title: z.string().min(1),
  sourceType: SourceTypeSchema,
  author: z.string().nullable().optional(),
  publisher: z.string().nullable().optional(),
  edition: z.string().nullable().optional(),
  referenceUri: z.string().nullable().optional(),
  status: SourceStatusSchema.default('registered'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Source = z.infer<typeof SourceSchema>;

export const SourceChapterSchema = z.object({
  id: z.string().startsWith('srcchap_'),
  sourceId: z.string().startsWith('src_'),
  title: z.string().min(1),
  chapterNumber: z.number().int().nullable().optional(),
  locationReference: z.string().nullable().optional(),
  parentChapterId: z.string().startsWith('srcchap_').nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SourceChapter = z.infer<typeof SourceChapterSchema>;

export const SourceMappingTypeSchema = z.enum(['direct', 'partial', 'prerequisite']);
export type SourceMappingType = z.infer<typeof SourceMappingTypeSchema>;

export const SourceMappingRelevanceSchema = z.enum(['high', 'medium', 'low']);
export type SourceMappingRelevance = z.infer<typeof SourceMappingRelevanceSchema>;

export const SourceMappingSchema = z.object({
  id: z.string().startsWith('map_'),
  sourceChapterId: z.string().startsWith('srcchap_'),
  canonicalChapterId: z.string().startsWith('chap_'),
  subjectId: z.string().startsWith('subj_').nullable().optional(),
  mappingType: SourceMappingTypeSchema.default('direct'),
  relevance: SourceMappingRelevanceSchema.default('high'),
  confidence: z.number().min(0.0).max(1.0).default(1.0),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SourceMapping = z.infer<typeof SourceMappingSchema>;

// ============================================================================
// 4. TASKS & CALENDAR EXTERNAL COORDINATION DOMAIN
// ============================================================================

export const TaskLinkEntityTypeSchema = z.enum(['chapter', 'project']);
export type TaskLinkEntityType = z.infer<typeof TaskLinkEntityTypeSchema>;

export const TaskLinkStatusSnapshotSchema = z.enum(['needsAction', 'completed']).nullable().optional();
export type TaskLinkStatusSnapshot = z.infer<typeof TaskLinkStatusSnapshotSchema>;

export const TaskLinkSchema = z.object({
  id: z.string().startsWith('tasklink_'),
  provider: z.string().default('google_tasks'),
  tasklistId: z.string().min(1),
  taskId: z.string().min(1),
  entityType: TaskLinkEntityTypeSchema,
  entityId: z.string().min(1),
  titleSnapshot: z.string().nullable().optional(),
  statusSnapshot: TaskLinkStatusSnapshotSchema,
  lastSyncedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaskLink = z.infer<typeof TaskLinkSchema>;

export const CalendarLinkEntityTypeSchema = z.enum(['study_session', 'task']);
export type CalendarLinkEntityType = z.infer<typeof CalendarLinkEntityTypeSchema>;

export const CalendarLinkStatusSnapshotSchema = z.enum(['confirmed', 'tentative', 'cancelled']).nullable().optional();
export type CalendarLinkStatusSnapshot = z.infer<typeof CalendarLinkStatusSnapshotSchema>;

export const CalendarLinkSchema = z.object({
  id: z.string().startsWith('callink_'),
  provider: z.string().default('google_calendar'),
  calendarId: z.string().min(1),
  eventId: z.string().min(1),
  entityType: CalendarLinkEntityTypeSchema,
  entityId: z.string().min(1),
  titleSnapshot: z.string().nullable().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  statusSnapshot: CalendarLinkStatusSnapshotSchema,
  lastSyncedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CalendarLink = z.infer<typeof CalendarLinkSchema>;

export const ScheduleLinkRelationshipTypeSchema = z.enum(['session_for_task', 'deadline']);
export type ScheduleLinkRelationshipType = z.infer<typeof ScheduleLinkRelationshipTypeSchema>;

export const ScheduleLinkSchema = z.object({
  id: z.string().startsWith('schedlink_'),
  taskId: z.string().startsWith('tasklink_'),
  calendarEventId: z.string().startsWith('callink_'),
  relationshipType: ScheduleLinkRelationshipTypeSchema.default('session_for_task'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ScheduleLink = z.infer<typeof ScheduleLinkSchema>;

// ============================================================================
// 5. RESEARCH & PROJECTS DOMAIN
// ============================================================================

export const ProjectStatusSchema = z.enum(['planned', 'active', 'paused', 'completed', 'cancelled']);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectSchema = z.object({
  id: z.string().startsWith('proj_'),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  status: ProjectStatusSchema.default('planned'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ProjectEventTypeSchema = z.enum(['started', 'milestone_reached', 'completed']);
export type ProjectEventType = z.infer<typeof ProjectEventTypeSchema>;

export const ProjectEventSchema = z.object({
  id: z.string().startsWith('progevt_'),
  projectId: z.string().startsWith('proj_'),
  eventType: ProjectEventTypeSchema,
  actor: z.string().min(1),
  payloadJson: z.string().default('{}'),
  createdAt: z.string().datetime(),
});
export type ProjectEvent = z.infer<typeof ProjectEventSchema>;

export const ResearchEventSchema = z.object({
  id: z.string().startsWith('resevt_'),
  topic: z.string().min(1),
  source: z.string().min(1),
  summary: z.string().min(1),
  payloadJson: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type ResearchEvent = z.infer<typeof ResearchEventSchema>;

export const DecisionSchema = z.object({
  id: z.string().startsWith('dec_'),
  projectId: z.string().startsWith('proj_').nullable().optional(),
  title: z.string().min(1),
  context: z.string().min(1),
  decision: z.string().min(1),
  consequences: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type Decision = z.infer<typeof DecisionSchema>;

// ============================================================================
// 6. MEMORY DOMAIN
// ============================================================================

export const MemoryCategorySchema = z.enum(['convention', 'preference', 'constraint', 'pattern']);
export type MemoryCategory = z.infer<typeof MemoryCategorySchema>;

export const MemoryFactSchema = z.object({
  id: z.string().startsWith('mem_'),
  fact: z.string().min(1),
  category: MemoryCategorySchema,
  validAt: z.string().datetime(),
  invalidAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type MemoryFact = z.infer<typeof MemoryFactSchema>;

export const MemoryOperationSchema = z.enum(['ADD', 'UPDATE', 'INVALIDATE', 'NONE']);
export type MemoryOperation = z.infer<typeof MemoryOperationSchema>;

export const MemoryVersionSchema = z.object({
  id: z.string().startsWith('memver_'),
  memoryFactId: z.string().startsWith('mem_'),
  operation: MemoryOperationSchema,
  previousFact: z.string().nullable().optional(),
  newFact: z.string().nullable().optional(),
  actorId: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type MemoryVersion = z.infer<typeof MemoryVersionSchema>;

// ============================================================================
// 7. AGENT & OPERATIONS DOMAIN
// ============================================================================

export const AgentRunStatusSchema = z.enum(['started', 'running', 'completed', 'failed']);
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;

export const AgentRunSchema = z.object({
  id: z.string().startsWith('agentrun_'),
  agentName: z.string().min(1),
  runType: z.string().min(1),
  status: AgentRunStatusSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable().optional(),
  resultSummary: z.string().nullable().optional(),
  errorCode: z.string().nullable().optional(),
  payload: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type AgentRun = z.infer<typeof AgentRunSchema>;

export const StateSnapshotTypeSchema = z.enum(['daily', 'milestone', 'pre_migration']);
export type StateSnapshotType = z.infer<typeof StateSnapshotTypeSchema>;

export const StateSnapshotSchema = z.object({
  id: z.string().startsWith('snap_'),
  snapshotType: StateSnapshotTypeSchema,
  stateJson: z.string().min(1),
  schemaVersion: z.number().int().default(1),
  createdAt: z.string().datetime(),
});
export type StateSnapshot = z.infer<typeof StateSnapshotSchema>;

export const CheckpointSchema = z.object({
  id: z.string().startsWith('chk_'),
  checkpointName: z.string().min(1),
  checkpointType: z.string().min(1),
  stateData: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

// ============================================================================
// 8. SYNCHRONIZATION & RELIABILITY DOMAIN
// ============================================================================

export const TargetSystemSchema = z.enum(['notion', 'google_tasks', 'google_calendar']);
export type TargetSystem = z.infer<typeof TargetSystemSchema>;

export const SyncEntityTypeSchema = z.enum(['study_progress', 'daily_state', 'task', 'chapter']);
export type SyncEntityType = z.infer<typeof SyncEntityTypeSchema>;

export const SyncOperationSchema = z.enum(['create', 'update', 'delete', 'sync']);
export type SyncOperation = z.infer<typeof SyncOperationSchema>;

export const SyncJobStatusSchema = z.enum(['PENDING', 'DISPATCHED', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER']);
export type SyncJobStatus = z.infer<typeof SyncJobStatusSchema>;

export const SyncJobSchema = z.object({
  jobId: z.string().startsWith('sync_'),
  idempotencyKey: z.string().min(1),
  targetSystem: TargetSystemSchema,
  entityType: SyncEntityTypeSchema,
  entityId: z.string().min(1),
  operation: SyncOperationSchema,
  payloadJson: z.string().default('{}'),
  status: SyncJobStatusSchema.default('PENDING'),
  attemptCount: z.number().int().min(0).default(0),
  nextAttemptAt: z.string().datetime().nullable().optional(),
  dispatchedAt: z.string().datetime().nullable().optional(),
  processingStartedAt: z.string().datetime().nullable().optional(),
  leaseOwner: z.string().nullable().optional(),
  leaseExpiresAt: z.string().datetime().nullable().optional(),
  lastError: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable().optional(),
});
export type SyncJob = z.infer<typeof SyncJobSchema>;

export const IdempotencyStatusSchema = z.enum(['PENDING', 'COMPLETED', 'FAILED']);
export type IdempotencyStatus = z.infer<typeof IdempotencyStatusSchema>;

export const IdempotencyRecordSchema = z.object({
  idempotencyKey: z.string().min(1),
  jobId: z.string().startsWith('sync_').nullable().optional(),
  operation: z.string().min(1),
  sourceSystem: z.string().min(1),
  requestHash: z.string().length(64), // SHA-256 hex digest
  resultHash: z.string().length(64).nullable().optional(),
  status: IdempotencyStatusSchema,
  resultPayload: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type IdempotencyRecord = z.infer<typeof IdempotencyRecordSchema>;

// ============================================================================
// 9. SEMANTIC STATE SERVICE CONTRACTS & DTOs
// ============================================================================

export interface TodayState {
  date: string;
  timezone: string;
  studyProgress: {
    studyMinutes: number;
    completedChapters: number;
    questionsAttempted: number;
    questionsCorrect: number;
    accuracy: number;
    missedSessions: number;
  };
  completedActivity: {
    eventsCount: number;
    recentSessions: Array<{
      sessionId?: string;
      chapterId: string;
      durationMinutes: number;
      activityType: string;
    }>;
  };
  pendingWork: {
    pendingTasksCount: number;
    failedSyncJobsCount: number;
  };
  taskLinkageState: {
    activeTaskLinksCount: number;
    completedTaskLinksCount: number;
  };
  scheduleContext: {
    scheduledBlocksCount: number;
    missedBlocksCount: number;
  };
  warnings: string[];
  synchronizationStatus: {
    healthy: boolean;
    pendingSyncJobsCount: number;
    deadLetterCount: number;
  };
}

export interface StudyState {
  totalStudyMinutes: number;
  completedChaptersCount: number;
  activeChaptersCount: number;
  totalChaptersCount: number;
  questionsAttempted: number;
  questionsCorrect: number;
  accuracy: number;
  subjectSummaries: Array<{
    subjectId: string;
    name: string;
    completedChapters: number;
    totalChapters: number;
    progressPercent: number;
  }>;
  recentActivity: Array<{
    eventId: string;
    eventType: string;
    occurredAt: string;
    summary: string;
  }>;
}

export interface ChapterHierarchyItem {
  id: string;
  name: string;
  slug: string;
  parentId?: string | null;
  status: ChapterStatus;
  progress: number;
  children?: ChapterHierarchyItem[];
}

export interface SubjectState {
  subject: Subject;
  chapters: ChapterHierarchyItem[];
  progress: {
    completedChapters: number;
    totalChapters: number;
    overallProgressPercent: number;
    questionsAttempted: number;
    questionsCorrect: number;
    accuracy: number;
  };
  recentActivity: Array<{
    eventId: string;
    eventType: string;
    occurredAt: string;
  }>;
  completionState: {
    isFullyCompleted: boolean;
    remainingChaptersCount: number;
  };
}

export interface ChapterState {
  chapter: Chapter;
  subject: Subject;
  parentChapter: Chapter | null;
  completionState: {
    status: ChapterStatus;
    isCompleted: boolean;
    completedAt?: string;
  };
  progress: {
    progressPercent: number;
    confidence: number;
    questionsAttempted: number;
    questionsCorrect: number;
    accuracy: number;
    studyTimeMinutes: number;
    lastStudiedAt?: string;
  };
  recentEvents: Array<{
    eventId: string;
    eventType: string;
    occurredAt: string;
  }>;
  lastActivity?: {
    occurredAt: string;
    eventType: string;
  };
  linkedSourceMappings: Array<{
    sourceMappingId: string;
    sourceTitle: string;
    sourceChapterTitle: string;
    mappingType: string;
    relevance: string;
    confidence: number;
  }>;
}

export interface PendingWorkItem {
  id: string;
  category: 'study' | 'external_task' | 'sync';
  title: string;
  status: string;
  entityType?: string;
  entityId?: string;
  priority?: string;
  due?: string;
  lastError?: string;
  attemptCount?: number;
}

export interface PendingWorkState {
  totalPendingCount: number;
  studyWork: PendingWorkItem[];
  externalTasks: PendingWorkItem[];
  syncWork: PendingWorkItem[];
}

export interface ScheduleContextBlock {
  id: string;
  calendarEventId: string;
  entityType: CalendarLinkEntityType;
  entityId: string;
  titleSnapshot?: string | null;
  startsAt: string;
  endsAt: string;
  statusSnapshot?: CalendarLinkStatusSnapshot;
}

export interface ScheduleContextState {
  date: string;
  timezone: string;
  calendarBlocks: ScheduleContextBlock[];
  currentOrNextBlock: ScheduleContextBlock | null;
  conflicts: Array<{
    blockA: ScheduleContextBlock;
    blockB: ScheduleContextBlock;
  }>;
  missedSessions: Array<{
    calendarEventId: string;
    scheduledStart: string;
    scheduledEnd: string;
    reason?: string;
  }>;
  linkedStudyActivity: Array<{
    sessionId: string;
    chapterId: string;
    startsAt: string;
    endsAt: string;
  }>;
}

export interface MemorySearchItem {
  id: string;
  type: 'fact' | 'decision' | 'research' | 'project';
  title: string;
  content: string;
  category?: string;
  createdAt: string;
  validAt?: string;
  invalidAt?: string | null;
  provenance?: Record<string, unknown>;
  versionsCount?: number;
}

export interface MemorySearchState {
  query?: string;
  totalFound: number;
  items: MemorySearchItem[];
}

export interface ProjectState {
  project: Project;
  recentEvents: ProjectEvent[];
  decisions: Decision[];
  research: ResearchEvent[];
  taskLinks: TaskLink[];
  syncStatus: {
    pendingSyncJobsCount: number;
  };
  latestProgress: {
    milestonesCount: number;
    completedMilestonesCount: number;
  };
}

export interface SyncStatusState {
  healthy: boolean;
  pendingJobsCount: number;
  processingJobsCount: number;
  failedJobsCount: number;
  deadLetterJobsCount: number;
  recentSuccessfulSync: Array<{
    jobId: string;
    targetSystem: TargetSystem;
    entityType: SyncEntityType;
    entityId: string;
    operation: SyncOperation;
    completedAt?: string;
  }>;
  activeJobs: Array<{
    jobId: string;
    targetSystem: TargetSystem;
    entityType: SyncEntityType;
    entityId: string;
    status: SyncJobStatus;
    attemptCount: number;
    nextAttemptAt?: string;
  }>;
  systemBreakdown: {
    notion: { total: number; failed: number };
    google_tasks: { total: number; failed: number };
    google_calendar: { total: number; failed: number };
  };
}

// Mutation Input Schemas & Types
export const RecordStudySessionInputSchema = z.object({
  subjectId: z.string().startsWith('subj_'),
  chapterId: z.string().startsWith('chap_'),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  durationSeconds: z.number().int().min(0),
  activityType: StudyActivityTypeSchema.default('deep_work'),
  source: z.string().default('rest_api'),
  questionsAttempted: z.number().int().min(0).default(0),
  questionsCorrect: z.number().int().min(0).default(0),
  notes: z.string().optional(),
  correlationId: z.string().optional(),
  causationId: z.string().optional(),
}).refine(data => new Date(data.endedAt).getTime() >= new Date(data.startedAt).getTime(), {
  message: 'endedAt must be greater than or equal to startedAt',
  path: ['endedAt'],
}).refine(data => data.questionsCorrect <= data.questionsAttempted, {
  message: 'questionsCorrect cannot exceed questionsAttempted',
  path: ['questionsCorrect'],
});
export type RecordStudySessionInput = z.input<typeof RecordStudySessionInputSchema>;

export const UpdateProgressInputSchema = z.object({
  chapterId: z.string().startsWith('chap_'),
  progress: z.number().min(0.0).max(1.0),
  confidence: z.number().min(0.0).max(1.0).optional(),
  correlationId: z.string().optional(),
  causationId: z.string().optional(),
});
export type UpdateProgressInput = z.input<typeof UpdateProgressInputSchema>;

export const CompleteChapterInputSchema = z.object({
  chapterId: z.string().startsWith('chap_'),
  subjectId: z.string().startsWith('subj_').optional(),
  correlationId: z.string().optional(),
  causationId: z.string().optional(),
});
export type CompleteChapterInput = z.input<typeof CompleteChapterInputSchema>;

export const RecordResearchInputSchema = z.object({
  topic: z.string().min(1),
  source: z.string().min(1),
  summary: z.string().min(1),
  takeaways: z.array(z.string()).optional(),
  projectId: z.string().startsWith('proj_').optional(),
  chapterId: z.string().startsWith('chap_').optional(),
  payloadJson: z.string().optional(),
  correlationId: z.string().optional(),
  causationId: z.string().optional(),
});
export type RecordResearchInput = z.input<typeof RecordResearchInputSchema>;

export const RecordDecisionInputSchema = z.object({
  title: z.string().min(1),
  context: z.string().min(1),
  decision: z.string().min(1),
  consequences: z.string().optional(),
  projectId: z.string().startsWith('proj_').optional(),
  correlationId: z.string().optional(),
  causationId: z.string().optional(),
});
export type RecordDecisionInput = z.input<typeof RecordDecisionInputSchema>;

export const LinkTaskInputSchema = z.object({
  provider: z.string().default('google_tasks'),
  tasklistId: z.string().min(1),
  taskId: z.string().min(1),
  entityType: TaskLinkEntityTypeSchema,
  entityId: z.string().min(1),
  titleSnapshot: z.string().optional(),
  statusSnapshot: TaskLinkStatusSnapshotSchema.default('needsAction'),
  correlationId: z.string().optional(),
  causationId: z.string().optional(),
});
export type LinkTaskInput = z.input<typeof LinkTaskInputSchema>;

export const LinkCalendarEventInputSchema = z.object({
  provider: z.string().default('google_calendar'),
  calendarId: z.string().min(1),
  eventId: z.string().min(1),
  entityType: CalendarLinkEntityTypeSchema,
  entityId: z.string().min(1),
  titleSnapshot: z.string().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  statusSnapshot: CalendarLinkStatusSnapshotSchema.default('confirmed'),
  correlationId: z.string().optional(),
  causationId: z.string().optional(),
}).refine(data => new Date(data.endsAt).getTime() >= new Date(data.startsAt).getTime(), {
  message: 'endsAt must be greater than or equal to startsAt',
  path: ['endsAt'],
});
export type LinkCalendarEventInput = z.input<typeof LinkCalendarEventInputSchema>;
