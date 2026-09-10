import { Generated } from 'kysely';

// ============================================================================
// Database Table Interfaces for all 24 Authoritative D1 Tables
// ============================================================================

// 1. Identity & Core Domain (3 Tables)
export interface UsersTable {
  id: string; // usr_...
  timezone: string;
  status: 'active' | 'suspended' | 'deactivated';
  created_at: string;
  updated_at: string;
}

export interface SubjectsTable {
  id: string; // subj_...
  name: string;
  slug: string;
  description: string | null;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
}

export interface ChaptersTable {
  id: string; // chap_...
  subject_id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  status: 'not_started' | 'in_progress' | 'completed';
  progress: number;
  created_at: string;
  updated_at: string;
}

// 2. Study Domain (4 Tables)
export interface CanonicalEventsTable {
  event_id: string; // evt_...
  event_type: string;
  schema_version: number;
  occurred_at: string;
  recorded_at: string;
  actor_type: 'user' | 'agent' | 'system';
  actor_id: string;
  source_system: string;
  source_interface: string;
  payload: string; // JSON string
  correlation_id: string | null;
  causation_id: string | null;
}

export interface StudySessionsTable {
  id: string; // sess_...
  subject_id: string;
  chapter_id: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  activity_type: 'revision' | 'pyq_practice' | 'lecture' | 'deep_work';
  source: string;
  status: 'completed' | 'interrupted';
  created_at: string;
  updated_at: string;
}

export interface StudyProgressTable {
  id: string; // prog_...
  subject_id: string;
  chapter_id: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  progress_percent: number;
  confidence: number;
  last_studied_at: string | null;
  last_completed_at: string | null;
  questions_attempted: number;
  questions_correct: number;
  accuracy: number;
  updated_at: string;
}

export interface DailyStatesTable {
  id: string; // daily_...
  date: string; // YYYY-MM-DD
  study_minutes: number;
  completed_chapters: number;
  questions_attempted: number;
  questions_correct: number;
  accuracy: number;
  missed_sessions: number;
  completed_tasks: number;
  pending_tasks: number;
  state_payload: string; // JSON string
  updated_at: string;
}

// 3. Sources Domain (3 Tables)
export interface SourcesTable {
  id: string; // src_...
  title: string;
  source_type: 'book' | 'pdf' | 'syllabus' | 'notes';
  author: string | null;
  publisher: string | null;
  edition: string | null;
  reference_uri: string | null;
  status: 'registered' | 'mapped' | 'archived';
  created_at: string;
  updated_at: string;
}

export interface SourceChaptersTable {
  id: string; // srcchap_...
  source_id: string;
  title: string;
  chapter_number: number | null;
  location_reference: string | null;
  parent_chapter_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SourceMappingsTable {
  id: string; // map_...
  source_chapter_id: string;
  canonical_chapter_id: string;
  subject_id: string | null;
  mapping_type: 'direct' | 'partial' | 'prerequisite';
  relevance: 'high' | 'medium' | 'low';
  confidence: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// 4. Tasks & Calendar External Coordination Domain (3 Tables)
export interface TaskLinksTable {
  id: string; // tasklink_...
  provider: string;
  tasklist_id: string;
  task_id: string;
  entity_type: 'chapter' | 'project';
  entity_id: string;
  title_snapshot: string | null;
  status_snapshot: 'needsAction' | 'completed' | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarLinksTable {
  id: string; // callink_...
  provider: string;
  calendar_id: string;
  event_id: string;
  entity_type: 'study_session' | 'task';
  entity_id: string;
  title_snapshot: string | null;
  starts_at: string;
  ends_at: string;
  status_snapshot: 'confirmed' | 'tentative' | 'cancelled' | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleLinksTable {
  id: string; // schedlink_...
  task_id: string;
  calendar_event_id: string;
  relationship_type: 'session_for_task' | 'deadline';
  created_at: string;
  updated_at: string;
}

// 5. Research & Projects Domain (4 Tables)
export interface ProjectsTable {
  id: string; // proj_...
  name: string;
  description: string | null;
  status: 'planned' | 'active' | 'paused' | 'completed' | 'cancelled';
  created_at: string;
  updated_at: string;
}

export interface ProjectEventsTable {
  id: string; // progevt_...
  project_id: string;
  event_type: 'started' | 'milestone_reached' | 'completed';
  actor: string;
  payload_json: string;
  created_at: string;
}

export interface ResearchEventsTable {
  id: string; // resevt_...
  topic: string;
  source: string;
  summary: string;
  payload_json: string | null;
  created_at: string;
}

export interface DecisionsTable {
  id: string; // dec_...
  project_id: string | null;
  title: string;
  context: string;
  decision: string;
  consequences: string | null;
  created_at: string;
}

// 6. Memory Domain (2 Tables)
export interface MemoryFactsTable {
  id: string; // mem_...
  fact: string;
  category: 'convention' | 'preference' | 'constraint' | 'pattern';
  valid_at: string;
  invalid_at: string | null;
  created_at: string;
}

export interface MemoryVersionsTable {
  id: string; // memver_...
  memory_fact_id: string;
  operation: 'ADD' | 'UPDATE' | 'INVALIDATE' | 'NONE';
  previous_fact: string | null;
  new_fact: string | null;
  actor_id: string;
  created_at: string;
}

// 7. Agent & Operations Domain (3 Tables)
export interface AgentRunsTable {
  id: string; // agentrun_...
  agent_name: string;
  run_type: string;
  status: 'started' | 'running' | 'completed' | 'failed';
  started_at: string;
  completed_at: string | null;
  result_summary: string | null;
  error_code: string | null;
  payload: string | null;
  created_at: string;
}

export interface StateSnapshotsTable {
  id: string; // snap_...
  snapshot_type: 'daily' | 'milestone' | 'pre_migration';
  state_json: string;
  schema_version: number;
  created_at: string;
}

export interface CheckpointsTable {
  id: string; // chk_...
  checkpoint_name: string;
  checkpoint_type: string;
  state_data: string;
  created_at: string;
}

// 8. Synchronization & Reliability Domain (2 Tables)
export interface SyncJobsTable {
  job_id: string; // sync_...
  idempotency_key: string;
  target_system: 'notion' | 'google_tasks' | 'google_calendar';
  entity_type: 'study_progress' | 'daily_state' | 'task' | 'chapter';
  entity_id: string;
  operation: 'create' | 'update' | 'delete' | 'sync';
  payload_json: string;
  status: 'PENDING' | 'DISPATCHED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'DEAD_LETTER';
  attempt_count: number;
  next_attempt_at: string | null;
  dispatched_at: string | null;
  processing_started_at: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface IdempotencyRecordsTable {
  idempotency_key: string; // idemp_...
  job_id: string | null;
  operation: string;
  source_system: string;
  request_hash: string;
  result_hash: string | null;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  result_payload: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

// ============================================================================
// Top-Level Database Interface (24 Tables)
// ============================================================================

export interface Database {
  users: UsersTable;
  subjects: SubjectsTable;
  chapters: ChaptersTable;
  canonical_events: CanonicalEventsTable;
  study_sessions: StudySessionsTable;
  study_progress: StudyProgressTable;
  daily_states: DailyStatesTable;
  sources: SourcesTable;
  source_chapters: SourceChaptersTable;
  source_mappings: SourceMappingsTable;
  task_links: TaskLinksTable;
  calendar_links: CalendarLinksTable;
  schedule_links: ScheduleLinksTable;
  projects: ProjectsTable;
  project_events: ProjectEventsTable;
  research_events: ResearchEventsTable;
  decisions: DecisionsTable;
  memory_facts: MemoryFactsTable;
  memory_versions: MemoryVersionsTable;
  agent_runs: AgentRunsTable;
  state_snapshots: StateSnapshotsTable;
  checkpoints: CheckpointsTable;
  sync_jobs: SyncJobsTable;
  idempotency_records: IdempotencyRecordsTable;
}
