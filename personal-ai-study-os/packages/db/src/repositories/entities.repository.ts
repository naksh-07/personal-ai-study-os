import { Kysely } from 'kysely';
import { Database } from '../tables';
import {
  User,
  Subject,
  Chapter,
  SyncJob,
  IdempotencyRecord,
  Project,
  ProjectEvent,
  Decision,
  ResearchEvent,
  TaskLink,
  CalendarLink,
  ScheduleLink,
  Source,
  SourceChapter,
  SourceMapping,
  MemoryFact,
  MemoryVersion,
  AgentRun,
} from '@personal-os/domain';

export class EntitiesRepository {
  // Users
  static async insertUser(db: Kysely<Database>, user: User) {
    return await db
      .insertInto('users')
      .values({
        id: user.id,
        timezone: user.timezone,
        status: user.status,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
      })
      .execute();
  }

  static async getUser(db: Kysely<Database>, id: string): Promise<User | null> {
    const row = await db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      timezone: row.timezone,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // Subjects
  static async insertSubject(db: Kysely<Database>, subject: Subject) {
    return await db
      .insertInto('subjects')
      .values({
        id: subject.id,
        name: subject.name,
        slug: subject.slug,
        description: subject.description ?? null,
        status: subject.status,
        created_at: subject.createdAt,
        updated_at: subject.updatedAt,
      })
      .execute();
  }

  static async getSubject(db: Kysely<Database>, id: string): Promise<Subject | null> {
    const row = await db.selectFrom('subjects').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // Chapters
  static async insertChapter(db: Kysely<Database>, chapter: Chapter) {
    return await db
      .insertInto('chapters')
      .values({
        id: chapter.id,
        subject_id: chapter.subjectId,
        name: chapter.name,
        slug: chapter.slug,
        parent_id: chapter.parentId ?? null,
        status: chapter.status,
        progress: chapter.progress,
        created_at: chapter.createdAt,
        updated_at: chapter.updatedAt,
      })
      .execute();
  }

  static async getChapter(db: Kysely<Database>, id: string): Promise<Chapter | null> {
    const row = await db.selectFrom('chapters').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      subjectId: row.subject_id,
      name: row.name,
      slug: row.slug,
      parentId: row.parent_id,
      status: row.status,
      progress: row.progress,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // Sync Jobs (Outbox)
  static createInsertSyncJobQuery(db: Kysely<Database>, job: SyncJob) {
    return db.insertInto('sync_jobs').values({
      job_id: job.jobId,
      idempotency_key: job.idempotencyKey,
      target_system: job.targetSystem,
      entity_type: job.entityType,
      entity_id: job.entityId,
      operation: job.operation,
      payload_json: job.payloadJson,
      status: job.status,
      attempt_count: job.attemptCount,
      next_attempt_at: job.nextAttemptAt ?? null,
      dispatched_at: job.dispatchedAt ?? null,
      processing_started_at: job.processingStartedAt ?? null,
      lease_owner: job.leaseOwner ?? null,
      lease_expires_at: job.leaseExpiresAt ?? null,
      last_error: job.lastError ?? null,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
      completed_at: job.completedAt ?? null,
    });
  }

  static async getSyncJob(db: Kysely<Database>, jobId: string): Promise<SyncJob | null> {
    const row = await db.selectFrom('sync_jobs').selectAll().where('job_id', '=', jobId).executeTakeFirst();
    if (!row) return null;
    return {
      jobId: row.job_id,
      idempotencyKey: row.idempotency_key,
      targetSystem: row.target_system,
      entityType: row.entity_type,
      entityId: row.entity_id,
      operation: row.operation,
      payloadJson: row.payload_json,
      status: row.status,
      attemptCount: row.attempt_count,
      nextAttemptAt: row.next_attempt_at ?? undefined,
      dispatchedAt: row.dispatched_at ?? undefined,
      processingStartedAt: row.processing_started_at ?? undefined,
      leaseOwner: row.lease_owner ?? undefined,
      leaseExpiresAt: row.lease_expires_at ?? undefined,
      lastError: row.last_error ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at ?? undefined,
    };
  }

  // Idempotency Records
  static createInsertIdempotencyRecordQuery(db: Kysely<Database>, record: IdempotencyRecord) {
    return db.insertInto('idempotency_records').values({
      idempotency_key: record.idempotencyKey,
      job_id: record.jobId ?? null,
      operation: record.operation,
      source_system: record.sourceSystem,
      request_hash: record.requestHash,
      result_hash: record.resultHash ?? null,
      status: record.status,
      result_payload: record.resultPayload ?? null,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      expires_at: record.expiresAt,
    });
  }

  static async getIdempotencyRecord(db: Kysely<Database>, idempotencyKey: string): Promise<IdempotencyRecord | null> {
    const row = await db
      .selectFrom('idempotency_records')
      .selectAll()
      .where('idempotency_key', '=', idempotencyKey)
      .executeTakeFirst();
    if (!row) return null;
    return {
      idempotencyKey: row.idempotency_key,
      jobId: row.job_id ?? undefined,
      operation: row.operation,
      sourceSystem: row.source_system,
      requestHash: row.request_hash,
      resultHash: row.result_hash ?? undefined,
      status: row.status,
      resultPayload: row.result_payload ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
    };
  }

  // ==========================================================================
  // Additional Read / Query Operations for Semantic State
  // ==========================================================================

  static async getAllSubjects(db: Kysely<Database>): Promise<Subject[]> {
    const rows = await db.selectFrom('subjects').selectAll().orderBy('name', 'asc').execute();
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  static async getAllChapters(db: Kysely<Database>): Promise<Chapter[]> {
    const rows = await db.selectFrom('chapters').selectAll().orderBy('name', 'asc').execute();
    return rows.map(row => ({
      id: row.id,
      subjectId: row.subject_id,
      name: row.name,
      slug: row.slug,
      parentId: row.parent_id,
      status: row.status,
      progress: row.progress,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  static async getChaptersBySubject(db: Kysely<Database>, subjectId: string): Promise<Chapter[]> {
    const rows = await db
      .selectFrom('chapters')
      .selectAll()
      .where('subject_id', '=', subjectId)
      .orderBy('name', 'asc')
      .execute();
    return rows.map(row => ({
      id: row.id,
      subjectId: row.subject_id,
      name: row.name,
      slug: row.slug,
      parentId: row.parent_id,
      status: row.status,
      progress: row.progress,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  // Projects
  static async insertProject(db: Kysely<Database>, project: Project) {
    return await db
      .insertInto('projects')
      .values({
        id: project.id,
        name: project.name,
        description: project.description ?? null,
        status: project.status,
        created_at: project.createdAt,
        updated_at: project.updatedAt,
      })
      .execute();
  }

  static async updateProject(
    db: Kysely<Database>,
    id: string,
    update: Partial<Omit<Project, 'id' | 'createdAt'>>
  ) {
    const patch: Record<string, any> = {};
    if (update.name !== undefined) patch.name = update.name;
    if (update.description !== undefined) patch.description = update.description;
    if (update.status !== undefined) patch.status = update.status;
    if (update.updatedAt !== undefined) patch.updated_at = update.updatedAt;

    return await db
      .updateTable('projects')
      .set(patch)
      .where('id', '=', id)
      .execute();
  }

  static async getProject(db: Kysely<Database>, id: string): Promise<Project | null> {
    const row = await db.selectFrom('projects').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  static async getAllProjects(db: Kysely<Database>): Promise<Project[]> {
    const rows = await db.selectFrom('projects').selectAll().orderBy('created_at', 'desc').execute();
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  // Project Events
  static async insertProjectEvent(db: Kysely<Database>, event: ProjectEvent) {
    return await db
      .insertInto('project_events')
      .values({
        id: event.id,
        project_id: event.projectId,
        event_type: event.eventType,
        actor: event.actor,
        payload_json: event.payloadJson,
        created_at: event.createdAt,
      })
      .execute();
  }

  static async getProjectEvents(db: Kysely<Database>, projectId: string, limit = 50): Promise<ProjectEvent[]> {
    const rows = await db
      .selectFrom('project_events')
      .selectAll()
      .where('project_id', '=', projectId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      eventType: row.event_type,
      actor: row.actor,
      payloadJson: row.payload_json,
      createdAt: row.created_at,
    }));
  }

  // Decisions
  static async insertDecision(db: Kysely<Database>, decision: Decision) {
    return await db
      .insertInto('decisions')
      .values({
        id: decision.id,
        project_id: decision.projectId ?? null,
        title: decision.title,
        context: decision.context,
        decision: decision.decision,
        consequences: decision.consequences ?? null,
        created_at: decision.createdAt,
      })
      .execute();
  }

  static async getDecisions(db: Kysely<Database>, projectId?: string, limit = 50): Promise<Decision[]> {
    let query = db.selectFrom('decisions').selectAll();
    if (projectId) {
      query = query.where('project_id', '=', projectId);
    }
    const rows = await query.orderBy('created_at', 'desc').limit(limit).execute();
    return rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      context: row.context,
      decision: row.decision,
      consequences: row.consequences,
      createdAt: row.created_at,
    }));
  }

  // Research Events
  static async insertResearchEvent(db: Kysely<Database>, event: ResearchEvent) {
    return await db
      .insertInto('research_events')
      .values({
        id: event.id,
        topic: event.topic,
        source: event.source,
        summary: event.summary,
        payload_json: event.payloadJson ?? null,
        created_at: event.createdAt,
      })
      .execute();
  }

  static async getResearchEvents(db: Kysely<Database>, limit = 50): Promise<ResearchEvent[]> {
    const rows = await db.selectFrom('research_events').selectAll().orderBy('created_at', 'desc').limit(limit).execute();
    return rows.map(row => ({
      id: row.id,
      topic: row.topic,
      source: row.source,
      summary: row.summary,
      payloadJson: row.payload_json,
      createdAt: row.created_at,
    }));
  }

  // Task Links
  static async insertTaskLink(db: Kysely<Database>, link: TaskLink) {
    return await db
      .insertInto('task_links')
      .values({
        id: link.id,
        provider: link.provider,
        tasklist_id: link.tasklistId,
        task_id: link.taskId,
        entity_type: link.entityType,
        entity_id: link.entityId,
        title_snapshot: link.titleSnapshot ?? null,
        status_snapshot: link.statusSnapshot ?? null,
        last_synced_at: link.lastSyncedAt ?? null,
        created_at: link.createdAt,
        updated_at: link.updatedAt,
      })
      .execute();
  }

  static async getTaskLinks(db: Kysely<Database>, entityType?: string, entityId?: string): Promise<TaskLink[]> {
    let query = db.selectFrom('task_links').selectAll();
    if (entityType) {
      query = query.where('entity_type', '=', entityType as any);
    }
    if (entityId) {
      query = query.where('entity_id', '=', entityId);
    }
    const rows = await query.orderBy('created_at', 'desc').execute();
    return rows.map(row => ({
      id: row.id,
      provider: row.provider,
      tasklistId: row.tasklist_id,
      taskId: row.task_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      titleSnapshot: row.title_snapshot,
      statusSnapshot: row.status_snapshot,
      lastSyncedAt: row.last_synced_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  static async upsertTaskLink(db: Kysely<Database>, link: TaskLink) {
    return await db
      .insertInto('task_links')
      .values({
        id: link.id,
        provider: link.provider,
        tasklist_id: link.tasklistId,
        task_id: link.taskId,
        entity_type: link.entityType,
        entity_id: link.entityId,
        title_snapshot: link.titleSnapshot ?? null,
        status_snapshot: link.statusSnapshot ?? null,
        last_synced_at: link.lastSyncedAt ?? null,
        created_at: link.createdAt,
        updated_at: link.updatedAt,
      })
      .onConflict((oc) =>
        oc.columns(['provider', 'tasklist_id', 'task_id']).doUpdateSet({
          entity_type: link.entityType,
          entity_id: link.entityId,
          title_snapshot: link.titleSnapshot ?? null,
          status_snapshot: link.statusSnapshot ?? null,
          last_synced_at: link.lastSyncedAt ?? null,
          updated_at: link.updatedAt,
        })
      )
      .execute();
  }

  // Calendar Links
  static async insertCalendarLink(db: Kysely<Database>, link: CalendarLink) {
    return await db
      .insertInto('calendar_links')
      .values({
        id: link.id,
        provider: link.provider,
        calendar_id: link.calendarId,
        event_id: link.eventId,
        entity_type: link.entityType,
        entity_id: link.entityId,
        title_snapshot: link.titleSnapshot ?? null,
        starts_at: link.startsAt,
        ends_at: link.endsAt,
        status_snapshot: link.statusSnapshot ?? null,
        last_synced_at: link.lastSyncedAt ?? null,
        created_at: link.createdAt,
        updated_at: link.updatedAt,
      })
      .execute();
  }

  static async upsertCalendarLink(db: Kysely<Database>, link: CalendarLink) {
    return await db
      .insertInto('calendar_links')
      .values({
        id: link.id,
        provider: link.provider,
        calendar_id: link.calendarId,
        event_id: link.eventId,
        entity_type: link.entityType,
        entity_id: link.entityId,
        title_snapshot: link.titleSnapshot ?? null,
        starts_at: link.startsAt,
        ends_at: link.endsAt,
        status_snapshot: link.statusSnapshot ?? null,
        last_synced_at: link.lastSyncedAt ?? null,
        created_at: link.createdAt,
        updated_at: link.updatedAt,
      })
      .onConflict((oc) =>
        oc.columns(['provider', 'calendar_id', 'event_id']).doUpdateSet({
          entity_type: link.entityType,
          entity_id: link.entityId,
          title_snapshot: link.titleSnapshot ?? null,
          starts_at: link.startsAt,
          ends_at: link.endsAt,
          status_snapshot: link.statusSnapshot ?? null,
          last_synced_at: link.lastSyncedAt ?? null,
          updated_at: link.updatedAt,
        })
      )
      .execute();
  }

  static async getCalendarLinks(db: Kysely<Database>, startDate?: string, endDate?: string): Promise<CalendarLink[]> {
    let query = db.selectFrom('calendar_links').selectAll();
    if (startDate) {
      query = query.where('starts_at', '>=', startDate);
    }
    if (endDate) {
      query = query.where('starts_at', '<=', endDate);
    }
    const rows = await query.orderBy('starts_at', 'asc').execute();
    return rows.map(row => ({
      id: row.id,
      provider: row.provider,
      calendarId: row.calendar_id,
      eventId: row.event_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      titleSnapshot: row.title_snapshot,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      statusSnapshot: row.status_snapshot,
      lastSyncedAt: row.last_synced_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  // Schedule Links
  static async insertScheduleLink(db: Kysely<Database>, link: ScheduleLink) {
    return await db
      .insertInto('schedule_links')
      .values({
        id: link.id,
        task_id: link.taskId,
        calendar_event_id: link.calendarEventId,
        relationship_type: link.relationshipType,
        created_at: link.createdAt,
        updated_at: link.updatedAt,
      })
      .execute();
  }

  static async getScheduleLinks(
    db: Kysely<Database>,
    taskId?: string,
    calendarEventId?: string
  ): Promise<ScheduleLink[]> {
    let query = db.selectFrom('schedule_links').selectAll();
    if (taskId) {
      query = query.where('task_id', '=', taskId);
    }
    if (calendarEventId) {
      query = query.where('calendar_event_id', '=', calendarEventId);
    }
    const rows = await query.orderBy('created_at', 'desc').execute();
    return rows.map(row => ({
      id: row.id,
      taskId: row.task_id,
      calendarEventId: row.calendar_event_id,
      relationshipType: row.relationship_type,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  // Source Mappings
  static async insertSource(db: Kysely<Database>, source: Source) {
    return await db
      .insertInto('sources')
      .values({
        id: source.id,
        title: source.title,
        source_type: source.sourceType,
        author: source.author ?? null,
        publisher: source.publisher ?? null,
        edition: source.edition ?? null,
        reference_uri: source.referenceUri ?? null,
        status: source.status,
        created_at: source.createdAt,
        updated_at: source.updatedAt,
      })
      .execute();
  }

  static async getSource(db: Kysely<Database>, id: string): Promise<Source | null> {
    const row = await db.selectFrom('sources').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      sourceType: row.source_type,
      author: row.author,
      publisher: row.publisher,
      edition: row.edition,
      referenceUri: row.reference_uri,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  static async listSources(db: Kysely<Database>, limit = 50): Promise<Source[]> {
    const rows = await db.selectFrom('sources').selectAll().orderBy('created_at', 'desc').limit(limit).execute();
    return rows.map(row => ({
      id: row.id,
      title: row.title,
      sourceType: row.source_type,
      author: row.author,
      publisher: row.publisher,
      edition: row.edition,
      referenceUri: row.reference_uri,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  static async insertSourceChapter(db: Kysely<Database>, chapter: SourceChapter) {
    return await db
      .insertInto('source_chapters')
      .values({
        id: chapter.id,
        source_id: chapter.sourceId,
        title: chapter.title,
        chapter_number: chapter.chapterNumber ?? null,
        location_reference: chapter.locationReference ?? null,
        parent_chapter_id: chapter.parentChapterId ?? null,
        created_at: chapter.createdAt,
        updated_at: chapter.updatedAt,
      })
      .execute();
  }

  static async getSourceChapter(db: Kysely<Database>, id: string): Promise<SourceChapter | null> {
    const row = await db.selectFrom('source_chapters').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      sourceId: row.source_id,
      title: row.title,
      chapterNumber: row.chapter_number,
      locationReference: row.location_reference,
      parentChapterId: row.parent_chapter_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  static async getSourceChapters(db: Kysely<Database>, sourceId: string): Promise<SourceChapter[]> {
    const rows = await db
      .selectFrom('source_chapters')
      .selectAll()
      .where('source_id', '=', sourceId)
      .orderBy('chapter_number', 'asc')
      .execute();
    return rows.map(row => ({
      id: row.id,
      sourceId: row.source_id,
      title: row.title,
      chapterNumber: row.chapter_number,
      locationReference: row.location_reference,
      parentChapterId: row.parent_chapter_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  static async insertSourceMapping(db: Kysely<Database>, mapping: SourceMapping) {
    return await db
      .insertInto('source_mappings')
      .values({
        id: mapping.id,
        source_chapter_id: mapping.sourceChapterId,
        canonical_chapter_id: mapping.canonicalChapterId,
        subject_id: mapping.subjectId ?? null,
        mapping_type: mapping.mappingType,
        relevance: mapping.relevance,
        confidence: mapping.confidence,
        notes: mapping.notes ?? null,
        created_at: mapping.createdAt,
        updated_at: mapping.updatedAt,
      })
      .execute();
  }

  static async getSourceMappingsForChapter(db: Kysely<Database>, chapterId: string): Promise<Array<{
    sourceMappingId: string;
    sourceTitle: string;
    sourceChapterTitle: string;
    mappingType: string;
    relevance: string;
    confidence: number;
  }>> {
    const rows = await db
      .selectFrom('source_mappings')
      .innerJoin('source_chapters', 'source_chapters.id', 'source_mappings.source_chapter_id')
      .innerJoin('sources', 'sources.id', 'source_chapters.source_id')
      .select([
        'source_mappings.id as mapping_id',
        'sources.title as source_title',
        'source_chapters.title as chapter_title',
        'source_mappings.mapping_type',
        'source_mappings.relevance',
        'source_mappings.confidence',
      ])
      .where('source_mappings.canonical_chapter_id', '=', chapterId)
      .execute();

    return rows.map(r => ({
      sourceMappingId: r.mapping_id,
      sourceTitle: r.source_title,
      sourceChapterTitle: r.chapter_title,
      mappingType: r.mapping_type,
      relevance: r.relevance,
      confidence: r.confidence,
    }));
  }

  static async getSourceMappingsBySource(db: Kysely<Database>, sourceId: string): Promise<Array<SourceMapping & { canonicalChapterName?: string }>> {
    const rows = await db
      .selectFrom('source_mappings')
      .innerJoin('source_chapters', 'source_chapters.id', 'source_mappings.source_chapter_id')
      .innerJoin('chapters', 'chapters.id', 'source_mappings.canonical_chapter_id')
      .select([
        'source_mappings.id',
        'source_mappings.source_chapter_id',
        'source_mappings.canonical_chapter_id',
        'source_mappings.subject_id',
        'source_mappings.mapping_type',
        'source_mappings.relevance',
        'source_mappings.confidence',
        'source_mappings.notes',
        'source_mappings.created_at',
        'source_mappings.updated_at',
        'chapters.name as canonical_chapter_name',
      ])
      .where('source_chapters.source_id', '=', sourceId)
      .execute();

    return rows.map(r => ({
      id: r.id,
      sourceChapterId: r.source_chapter_id,
      canonicalChapterId: r.canonical_chapter_id,
      subjectId: r.subject_id ?? undefined,
      mappingType: r.mapping_type,
      relevance: r.relevance,
      confidence: r.confidence,
      notes: r.notes ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      canonicalChapterName: r.canonical_chapter_name,
    }));
  }

  // Memory
  static async insertMemoryFact(db: Kysely<Database>, fact: MemoryFact) {
    return await db
      .insertInto('memory_facts')
      .values({
        id: fact.id,
        fact: fact.fact,
        category: fact.category,
        valid_at: fact.validAt,
        invalid_at: fact.invalidAt ?? null,
        created_at: fact.createdAt,
      })
      .execute();
  }

  static async getMemoryFacts(db: Kysely<Database>, category?: string, activeOnly = true): Promise<MemoryFact[]> {
    let query = db.selectFrom('memory_facts').selectAll();
    if (category) {
      query = query.where('category', '=', category as any);
    }
    if (activeOnly) {
      query = query.where('invalid_at', 'is', null);
    }
    const rows = await query.orderBy('created_at', 'desc').execute();
    return rows.map(row => ({
      id: row.id,
      fact: row.fact,
      category: row.category,
      validAt: row.valid_at,
      invalidAt: row.invalid_at,
      createdAt: row.created_at,
    }));
  }

  static async insertMemoryVersion(db: Kysely<Database>, version: MemoryVersion) {
    return await db
      .insertInto('memory_versions')
      .values({
        id: version.id,
        memory_fact_id: version.memoryFactId,
        operation: version.operation,
        previous_fact: version.previousFact ?? null,
        new_fact: version.newFact ?? null,
        actor_id: version.actorId,
        created_at: version.createdAt,
      })
      .execute();
  }

  static async getMemoryVersions(db: Kysely<Database>, memoryFactId: string): Promise<MemoryVersion[]> {
    const rows = await db
      .selectFrom('memory_versions')
      .selectAll()
      .where('memory_fact_id', '=', memoryFactId)
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map(row => ({
      id: row.id,
      memoryFactId: row.memory_fact_id,
      operation: row.operation,
      previousFact: row.previous_fact,
      newFact: row.new_fact,
      actorId: row.actor_id,
      createdAt: row.created_at,
    }));
  }

  // Agent Runs
  static async insertAgentRun(db: Kysely<Database>, run: AgentRun) {
    return await db
      .insertInto('agent_runs')
      .values({
        id: run.id,
        agent_name: run.agentName,
        run_type: run.runType,
        status: run.status,
        started_at: run.startedAt,
        completed_at: run.completedAt ?? null,
        result_summary: run.resultSummary ?? null,
        error_code: run.errorCode ?? null,
        payload: run.payload ?? null,
        created_at: run.createdAt,
      })
      .execute();
  }

  static async updateAgentRun(
    db: Kysely<Database>,
    id: string,
    update: Partial<Omit<AgentRun, 'id' | 'createdAt'>>
  ) {
    const patch: Record<string, any> = {};
    if (update.status !== undefined) patch.status = update.status;
    if (update.completedAt !== undefined) patch.completed_at = update.completedAt;
    if (update.resultSummary !== undefined) patch.result_summary = update.resultSummary;
    if (update.errorCode !== undefined) patch.error_code = update.errorCode;
    if (update.payload !== undefined) patch.payload = update.payload;

    return await db
      .updateTable('agent_runs')
      .set(patch)
      .where('id', '=', id)
      .execute();
  }

  static async getAgentRun(db: Kysely<Database>, id: string): Promise<AgentRun | null> {
    const row = await db.selectFrom('agent_runs').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      agentName: row.agent_name,
      runType: row.run_type,
      status: row.status as any,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      resultSummary: row.result_summary,
      errorCode: row.error_code,
      payload: row.payload,
      createdAt: row.created_at,
    };
  }

  static async getRecentAgentRuns(
    db: Kysely<Database>,
    params?: { agentName?: string; limit?: number }
  ): Promise<AgentRun[]> {
    let query = db.selectFrom('agent_runs').selectAll();
    if (params?.agentName) {
      query = query.where('agent_name', '=', params.agentName);
    }
    const rows = await query
      .orderBy('started_at', 'desc')
      .limit(params?.limit ?? 20)
      .execute();

    return rows.map((row) => ({
      id: row.id,
      agentName: row.agent_name,
      runType: row.run_type,
      status: row.status as any,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      resultSummary: row.result_summary,
      errorCode: row.error_code,
      payload: row.payload,
      createdAt: row.created_at,
    }));
  }

  // Checkpoints
  static async insertCheckpoint(db: Kysely<Database>, checkpoint: {
    id: string;
    checkpointName: string;
    checkpointType: string;
    stateData: string;
    createdAt: string;
  }) {
    return await db
      .insertInto('checkpoints')
      .values({
        id: checkpoint.id,
        checkpoint_name: checkpoint.checkpointName,
        checkpoint_type: checkpoint.checkpointType,
        state_data: checkpoint.stateData,
        created_at: checkpoint.createdAt,
      })
      .execute();
  }

  static async getCheckpoint(db: Kysely<Database>, name: string) {
    const row = await db
      .selectFrom('checkpoints')
      .selectAll()
      .where('checkpoint_name', '=', name)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      checkpointName: row.checkpoint_name,
      checkpointType: row.checkpoint_type,
      stateData: row.state_data,
      createdAt: row.created_at,
    };
  }

  static async listCheckpoints(db: Kysely<Database>, limit = 20) {
    const rows = await db
      .selectFrom('checkpoints')
      .selectAll()
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map(row => ({
      id: row.id,
      checkpointName: row.checkpoint_name,
      checkpointType: row.checkpoint_type,
      stateData: row.state_data,
      createdAt: row.created_at,
    }));
  }
}
