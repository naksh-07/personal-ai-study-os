import { z } from 'zod';

// ============================================================================
// Canonical Event Envelope Primitives
// ============================================================================

export const ActorTypeSchema = z.enum(['user', 'agent', 'system']);
export type ActorType = z.infer<typeof ActorTypeSchema>;

export const EventActorSchema = z.object({
  type: ActorTypeSchema,
  id: z.string().min(1),
});
export type EventActor = z.infer<typeof EventActorSchema>;

export const SourceSystemSchema = z.enum([
  'chatgpt',
  'spark',
  'antigravity',
  'studysourcecore',
  'notion',
  'google_tasks',
  'google_calendar',
  'system',
]);
export type SourceSystem = z.infer<typeof SourceSystemSchema>;

export const SourceInterfaceSchema = z.enum([
  'natural_language',
  'mcp',
  'rest',
  'webhook',
]);
export type SourceInterface = z.infer<typeof SourceInterfaceSchema>;

export const EventSourceSchema = z.object({
  system: SourceSystemSchema,
  interface: SourceInterfaceSchema,
});
export type EventSource = z.infer<typeof EventSourceSchema>;

export const BaseEventEnvelopeSchema = z.object({
  eventId: z.string().startsWith('evt_'),
  schemaVersion: z.number().int().min(1).default(1),
  occurredAt: z.string().datetime(),
  recordedAt: z.string().datetime(),
  actor: EventActorSchema,
  source: EventSourceSchema,
  correlationId: z.string().nullable().optional(),
  causationId: z.string().nullable().optional(),
});

// ============================================================================
// Accuracy Math Helper
// ============================================================================

export function deriveAccuracy(questionsCorrect: number, questionsAttempted: number): number {
  if (questionsAttempted === 0) return 0.0;
  const raw = questionsCorrect / questionsAttempted;
  return Math.round(raw * 10000) / 10000; // Round to 4 decimal places
}

// ============================================================================
// 1. Study Events
// ============================================================================

export const StudyStartedPayloadSchema = z.object({
  chapterId: z.string().startsWith('chap_'),
  subjectId: z.string().startsWith('subj_').optional(),
  scheduledDurationMinutes: z.number().int().min(1).optional(),
});

export const StudyCompletedPayloadSchema = z.object({
  chapterId: z.string().startsWith('chap_'),
  subjectId: z.string().startsWith('subj_').optional(),
  durationSeconds: z.number().int().min(0),
  activityType: z.enum(['revision', 'pyq_practice', 'lecture', 'deep_work']).default('deep_work'),
});

export const StudySessionRecordedPayloadSchema = z.object({
  sessionId: z.string().startsWith('sess_'),
  chapterId: z.string().startsWith('chap_'),
  subjectId: z.string().startsWith('subj_'),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  durationSeconds: z.number().int().min(0),
  activityType: z.enum(['revision', 'pyq_practice', 'lecture', 'deep_work']),
  source: z.string().default('google_calendar'),
}).refine(data => new Date(data.endedAt).getTime() >= new Date(data.startedAt).getTime(), {
  message: 'endedAt must be >= startedAt',
  path: ['endedAt'],
});

// ============================================================================
// 2. Chapter Events
// ============================================================================

export const ChapterStartedPayloadSchema = z.object({
  chapterId: z.string().startsWith('chap_'),
  subjectId: z.string().startsWith('subj_').optional(),
});

export const ChapterProgressUpdatedPayloadSchema = z.object({
  chapterId: z.string().startsWith('chap_'),
  progress: z.number().min(0.0).max(1.0),
});

export const ChapterCompletedPayloadSchema = z.object({
  chapterId: z.string().startsWith('chap_'),
  subjectId: z.string().startsWith('subj_').optional(),
});

// ============================================================================
// 3. Assessment & Questions Events (with Mathematical Constraints)
// ============================================================================

export const QuestionsAttemptedPayloadSchema = z.object({
  chapterId: z.string().startsWith('chap_'),
  subjectId: z.string().startsWith('subj_').optional(),
  questionsAttempted: z.number().int().min(0),
  questionsCorrect: z.number().int().min(0),
  accuracy: z.number().min(0.0).max(1.0).optional(),
}).refine(data => data.questionsCorrect <= data.questionsAttempted, {
  message: 'questionsCorrect cannot exceed questionsAttempted',
  path: ['questionsCorrect'],
});

export const AssessmentCompletedPayloadSchema = z.object({
  assessmentId: z.string().min(1),
  chapterId: z.string().startsWith('chap_').optional(),
  subjectId: z.string().startsWith('subj_').optional(),
  questionsAttempted: z.number().int().min(0),
  questionsCorrect: z.number().int().min(0),
  scorePercent: z.number().min(0.0).max(100.0).optional(),
}).refine(data => data.questionsCorrect <= data.questionsAttempted, {
  message: 'questionsCorrect cannot exceed questionsAttempted',
  path: ['questionsCorrect'],
});

// ============================================================================
// 4. Schedule Coordination Events
// ============================================================================

export const ScheduleMissedPayloadSchema = z.object({
  calendarEventId: z.string().min(1),
  scheduledStart: z.string().datetime(),
  scheduledEnd: z.string().datetime(),
  reason: z.string().optional(),
});

export const ScheduleAdjustedPayloadSchema = z.object({
  calendarEventId: z.string().min(1),
  previousStart: z.string().datetime(),
  previousEnd: z.string().datetime(),
  newStart: z.string().datetime(),
  newEnd: z.string().datetime(),
  reason: z.string().optional(),
});

// ============================================================================
// 5. Task Events
// ============================================================================

export const TaskCreatedPayloadSchema = z.object({
  taskLinkId: z.string().startsWith('tasklink_').optional(),
  tasklistId: z.string().min(1),
  taskId: z.string().min(1),
  entityType: z.enum(['chapter', 'project']),
  entityId: z.string().min(1),
  title: z.string().min(1),
});

export const TaskCompletedPayloadSchema = z.object({
  taskLinkId: z.string().startsWith('tasklink_').optional(),
  taskId: z.string().min(1),
  tasklistId: z.string().optional(),
  completedAt: z.string().datetime().optional(),
});

export const TaskReopenedPayloadSchema = z.object({
  taskLinkId: z.string().startsWith('tasklink_').optional(),
  taskId: z.string().min(1),
  tasklistId: z.string().optional(),
});

// ============================================================================
// 6. Research Events
// ============================================================================

export const ResearchStartedPayloadSchema = z.object({
  topic: z.string().min(1),
  source: z.string().min(1),
});

export const ResearchCompletedPayloadSchema = z.object({
  topic: z.string().min(1),
  source: z.string().min(1),
  summary: z.string().min(1),
  takeaways: z.array(z.string()).optional(),
});

// ============================================================================
// 7. Source Ingestion Events
// ============================================================================

export const SourceRegisteredPayloadSchema = z.object({
  sourceId: z.string().startsWith('src_'),
  title: z.string().min(1),
  sourceType: z.enum(['book', 'pdf', 'syllabus', 'notes']),
  author: z.string().optional(),
  publisher: z.string().optional(),
  edition: z.string().optional(),
  referenceUri: z.string().optional(),
});

export const SourceChapterCreatedPayloadSchema = z.object({
  sourceChapterId: z.string().startsWith('srcchap_'),
  sourceId: z.string().startsWith('src_'),
  title: z.string().min(1),
  chapterNumber: z.number().int().optional(),
  locationReference: z.string().optional(),
  parentChapterId: z.string().startsWith('srcchap_').optional(),
});

export const SourceMappedPayloadSchema = z.object({
  sourceMappingId: z.string().startsWith('map_').optional(),
  sourceChapterId: z.string().startsWith('srcchap_'),
  canonicalChapterId: z.string().startsWith('chap_'),
  subjectId: z.string().startsWith('subj_').optional(),
  mappingType: z.enum(['direct', 'partial', 'prerequisite']).default('direct'),
  relevance: z.enum(['high', 'medium', 'low']).default('high'),
  confidence: z.number().min(0.0).max(1.0).default(1.0),
  notes: z.string().optional(),
});

export const SourceMappingCompletedPayloadSchema = z.object({
  sourceId: z.string().startsWith('src_'),
  mappingsCount: z.number().int().min(0).default(0),
});

// ============================================================================
// 8. Project Events
// ============================================================================

export const ProjectStartedPayloadSchema = z.object({
  projectId: z.string().startsWith('proj_'),
  name: z.string().min(1),
  description: z.string().optional(),
});

export const ProjectUpdatedPayloadSchema = z.object({
  projectId: z.string().startsWith('proj_'),
  milestone: z.string().optional(),
  status: z.enum(['planned', 'active', 'paused', 'completed', 'cancelled']).optional(),
  description: z.string().optional(),
});

export const ProjectCompletedPayloadSchema = z.object({
  projectId: z.string().startsWith('proj_'),
});

// ============================================================================
// 9. Decision Events
// ============================================================================

export const DecisionRecordedPayloadSchema = z.object({
  decisionId: z.string().startsWith('dec_'),
  projectId: z.string().startsWith('proj_').optional(),
  title: z.string().min(1),
  decision: z.string().min(1),
  consequences: z.string().optional(),
});

// ============================================================================
// 10. Agent Lifecycle Events
// ============================================================================

export const AgentStartedPayloadSchema = z.object({
  runId: z.string().startsWith('agentrun_'),
  agentName: z.string().min(1),
  runType: z.string().min(1),
});

export const AgentCompletedPayloadSchema = z.object({
  runId: z.string().startsWith('agentrun_'),
  agentName: z.string().optional(),
  resultSummary: z.string().min(1),
});

export const AgentFailedPayloadSchema = z.object({
  runId: z.string().startsWith('agentrun_'),
  agentName: z.string().optional(),
  errorCode: z.string().min(1),
  errorMessage: z.string().min(1),
});

export const CheckpointCreatedPayloadSchema = z.object({
  checkpointId: z.string().startsWith('chk_'),
  checkpointName: z.string().min(1),
  checkpointType: z.string().min(1),
});

// ============================================================================
// 11. Memory Events
// ============================================================================

export const MemoryAddedPayloadSchema = z.object({
  factId: z.string().startsWith('mem_'),
  fact: z.string().min(1),
  category: z.enum(['convention', 'preference', 'constraint', 'pattern']),
  validAt: z.string().datetime(),
});

export const MemoryUpdatedPayloadSchema = z.object({
  factId: z.string().startsWith('mem_'),
  previousFact: z.string().min(1),
  newFact: z.string().min(1),
  validAt: z.string().datetime(),
});

export const MemoryInvalidatedPayloadSchema = z.object({
  factId: z.string().startsWith('mem_'),
  invalidAt: z.string().datetime(),
});

// ============================================================================
// 12. Synchronization Events
// ============================================================================

export const SyncStartedPayloadSchema = z.object({
  jobId: z.string().startsWith('sync_'),
  targetSystem: z.enum(['notion', 'google_tasks', 'google_calendar']),
  operation: z.enum(['create', 'update', 'delete', 'sync']),
});

export const SyncCompletedPayloadSchema = z.object({
  jobId: z.string().startsWith('sync_'),
  targetSystem: z.enum(['notion', 'google_tasks', 'google_calendar']),
  resultSummary: z.string().optional(),
});

export const SyncFailedPayloadSchema = z.object({
  jobId: z.string().startsWith('sync_'),
  targetSystem: z.enum(['notion', 'google_tasks', 'google_calendar']),
  error: z.string().min(1),
  attemptCount: z.number().int().min(1),
});

// ============================================================================
// Concrete Event Schemas
// ============================================================================

export const StudyStartedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('study_started'),
  payload: StudyStartedPayloadSchema,
});

export const StudyCompletedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('study_completed'),
  payload: StudyCompletedPayloadSchema,
});

export const StudySessionRecordedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('study_session_recorded'),
  payload: StudySessionRecordedPayloadSchema,
});

export const ChapterStartedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('chapter_started'),
  payload: ChapterStartedPayloadSchema,
});

export const ChapterProgressUpdatedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('chapter_progress_updated'),
  payload: ChapterProgressUpdatedPayloadSchema,
});

export const ChapterCompletedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('chapter_completed'),
  payload: ChapterCompletedPayloadSchema,
});

export const QuestionsAttemptedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('questions_attempted'),
  payload: QuestionsAttemptedPayloadSchema,
});

export const AssessmentCompletedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('assessment_completed'),
  payload: AssessmentCompletedPayloadSchema,
});

export const ScheduleMissedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('schedule_missed'),
  payload: ScheduleMissedPayloadSchema,
});

export const ScheduleAdjustedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('schedule_adjusted'),
  payload: ScheduleAdjustedPayloadSchema,
});

export const TaskCreatedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('task_created'),
  payload: TaskCreatedPayloadSchema,
});

export const TaskCompletedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('task_completed'),
  payload: TaskCompletedPayloadSchema,
});

export const TaskReopenedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('task_reopened'),
  payload: TaskReopenedPayloadSchema,
});

export const ResearchStartedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('research_started'),
  payload: ResearchStartedPayloadSchema,
});

export const ResearchCompletedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('research_completed'),
  payload: ResearchCompletedPayloadSchema,
});

export const SourceRegisteredEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('source_registered'),
  payload: SourceRegisteredPayloadSchema,
});

export const SourceChapterCreatedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('source_chapter_created'),
  payload: SourceChapterCreatedPayloadSchema,
});

export const SourceMappedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('source_mapped'),
  payload: SourceMappedPayloadSchema,
});

export const SourceMappingCompletedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('source_mapping_completed'),
  payload: SourceMappingCompletedPayloadSchema,
});

export const ProjectStartedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('project_started'),
  payload: ProjectStartedPayloadSchema,
});

export const ProjectUpdatedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('project_updated'),
  payload: ProjectUpdatedPayloadSchema,
});

export const ProjectCompletedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('project_completed'),
  payload: ProjectCompletedPayloadSchema,
});

export const DecisionRecordedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('decision_recorded'),
  payload: DecisionRecordedPayloadSchema,
});

export const AgentStartedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('agent_started'),
  payload: AgentStartedPayloadSchema,
});

export const AgentCompletedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('agent_completed'),
  payload: AgentCompletedPayloadSchema,
});

export const AgentFailedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('agent_failed'),
  payload: AgentFailedPayloadSchema,
});

export const CheckpointCreatedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('checkpoint_created'),
  payload: CheckpointCreatedPayloadSchema,
});

export const MemoryAddedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('memory_added'),
  payload: MemoryAddedPayloadSchema,
});

export const MemoryUpdatedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('memory_updated'),
  payload: MemoryUpdatedPayloadSchema,
});

export const MemoryInvalidatedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('memory_invalidated'),
  payload: MemoryInvalidatedPayloadSchema,
});

export const SyncStartedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('sync_started'),
  payload: SyncStartedPayloadSchema,
});

export const SyncCompletedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('sync_completed'),
  payload: SyncCompletedPayloadSchema,
});

export const SyncFailedEventSchema = BaseEventEnvelopeSchema.extend({
  eventType: z.literal('sync_failed'),
  payload: SyncFailedPayloadSchema,
});

// ============================================================================
// Canonical Event Discriminated Union
// ============================================================================

export const CanonicalEventSchema = z.discriminatedUnion('eventType', [
  StudyStartedEventSchema,
  StudyCompletedEventSchema,
  StudySessionRecordedEventSchema,
  ChapterStartedEventSchema,
  ChapterProgressUpdatedEventSchema,
  ChapterCompletedEventSchema,
  QuestionsAttemptedEventSchema,
  AssessmentCompletedEventSchema,
  ScheduleMissedEventSchema,
  ScheduleAdjustedEventSchema,
  TaskCreatedEventSchema,
  TaskCompletedEventSchema,
  TaskReopenedEventSchema,
  ResearchStartedEventSchema,
  ResearchCompletedEventSchema,
  SourceRegisteredEventSchema,
  SourceChapterCreatedEventSchema,
  SourceMappedEventSchema,
  SourceMappingCompletedEventSchema,
  ProjectStartedEventSchema,
  ProjectUpdatedEventSchema,
  ProjectCompletedEventSchema,
  DecisionRecordedEventSchema,
  AgentStartedEventSchema,
  AgentCompletedEventSchema,
  AgentFailedEventSchema,
  CheckpointCreatedEventSchema,
  MemoryAddedEventSchema,
  MemoryUpdatedEventSchema,
  MemoryInvalidatedEventSchema,
  SyncStartedEventSchema,
  SyncCompletedEventSchema,
  SyncFailedEventSchema,
]);

export type CanonicalEvent = z.infer<typeof CanonicalEventSchema>;
export type CanonicalEventType = CanonicalEvent['eventType'];

export type StudyStartedEvent = z.infer<typeof StudyStartedEventSchema>;
export type StudyCompletedEvent = z.infer<typeof StudyCompletedEventSchema>;
export type StudySessionRecordedEvent = z.infer<typeof StudySessionRecordedEventSchema>;
export type ChapterStartedEvent = z.infer<typeof ChapterStartedEventSchema>;
export type ChapterProgressUpdatedEvent = z.infer<typeof ChapterProgressUpdatedEventSchema>;
export type ChapterCompletedEvent = z.infer<typeof ChapterCompletedEventSchema>;
export type QuestionsAttemptedEvent = z.infer<typeof QuestionsAttemptedEventSchema>;
export type AssessmentCompletedEvent = z.infer<typeof AssessmentCompletedEventSchema>;
export type ScheduleMissedEvent = z.infer<typeof ScheduleMissedEventSchema>;
export type ScheduleAdjustedEvent = z.infer<typeof ScheduleAdjustedEventSchema>;
export type TaskCreatedEvent = z.infer<typeof TaskCreatedEventSchema>;
export type TaskCompletedEvent = z.infer<typeof TaskCompletedEventSchema>;
export type TaskReopenedEvent = z.infer<typeof TaskReopenedEventSchema>;
export type ResearchStartedEvent = z.infer<typeof ResearchStartedEventSchema>;
export type ResearchCompletedEvent = z.infer<typeof ResearchCompletedEventSchema>;
export type SourceRegisteredEvent = z.infer<typeof SourceRegisteredEventSchema>;
export type SourceChapterCreatedEvent = z.infer<typeof SourceChapterCreatedEventSchema>;
export type SourceMappedEvent = z.infer<typeof SourceMappedEventSchema>;
export type SourceMappingCompletedEvent = z.infer<typeof SourceMappingCompletedEventSchema>;
export type ProjectStartedEvent = z.infer<typeof ProjectStartedEventSchema>;
export type ProjectUpdatedEvent = z.infer<typeof ProjectUpdatedEventSchema>;
export type ProjectCompletedEvent = z.infer<typeof ProjectCompletedEventSchema>;
export type DecisionRecordedEvent = z.infer<typeof DecisionRecordedEventSchema>;
export type AgentStartedEvent = z.infer<typeof AgentStartedEventSchema>;
export type AgentCompletedEvent = z.infer<typeof AgentCompletedEventSchema>;
export type AgentFailedEvent = z.infer<typeof AgentFailedEventSchema>;
export type CheckpointCreatedEvent = z.infer<typeof CheckpointCreatedEventSchema>;
export type MemoryAddedEvent = z.infer<typeof MemoryAddedEventSchema>;
export type MemoryUpdatedEvent = z.infer<typeof MemoryUpdatedEventSchema>;
export type MemoryInvalidatedEvent = z.infer<typeof MemoryInvalidatedEventSchema>;
export type SyncStartedEvent = z.infer<typeof SyncStartedEventSchema>;
export type SyncCompletedEvent = z.infer<typeof SyncCompletedEventSchema>;
export type SyncFailedEvent = z.infer<typeof SyncFailedEventSchema>;
