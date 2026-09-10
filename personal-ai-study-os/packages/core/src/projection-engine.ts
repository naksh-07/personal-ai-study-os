import { Kysely } from 'kysely';
import { Database, D1Database, executeD1Batch, ProjectionsRepository, Compilable } from '@personal-os/db';
import {
  CanonicalEvent,
  StudyProgress,
  DailyState,
  generateId,
  deriveAccuracy,
} from '@personal-os/domain';

export class ProjectionEngine {
  /**
   * Helper to extract localized date string (YYYY-MM-DD) from an ISO 8601 UTC timestamp.
   */
  static extractDate(isoString: string, timezone: string = 'UTC'): string {
    try {
      const date = new Date(isoString);
      // Format to YYYY-MM-DD in the given IANA timezone
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      return formatter.format(date);
    } catch {
      return isoString.substring(0, 10);
    }
  }

  /**
   * Evaluates a canonical event and produces the corresponding projection upsert queries
   * for study_progress and daily_states.
   */
  static async computeProjectionQueries(
    db: Kysely<Database>,
    event: CanonicalEvent,
    userTimezone: string = 'UTC'
  ): Promise<Compilable[]> {
    const queries: Compilable[] = [];
    const eventDate = this.extractDate(event.occurredAt, userTimezone);

    switch (event.eventType) {
      case 'study_completed': {
        const payload = event.payload as {
          chapterId: string;
          subjectId?: string;
          durationSeconds: number;
        };
        const minutes = Math.floor(payload.durationSeconds / 60);

        // 1. Update study_progress
        const existingProgress = await ProjectionsRepository.getStudyProgressByChapter(
          db,
          payload.chapterId
        );
        const resolvedSubjectId =
          payload.subjectId ?? existingProgress?.subjectId ?? 'subj_default';

        const updatedProgress: StudyProgress = {
          id: existingProgress?.id ?? generateId('prog'),
          subjectId: resolvedSubjectId,
          chapterId: payload.chapterId,
          status:
            existingProgress?.status === 'NOT_STARTED'
              ? 'IN_PROGRESS'
              : (existingProgress?.status ?? 'IN_PROGRESS'),
          progressPercent: existingProgress?.progressPercent ?? 0.0,
          confidence: existingProgress?.confidence ?? 0.0,
          lastStudiedAt: event.occurredAt,
          lastCompletedAt: existingProgress?.lastCompletedAt,
          questionsAttempted: existingProgress?.questionsAttempted ?? 0,
          questionsCorrect: existingProgress?.questionsCorrect ?? 0,
          accuracy: existingProgress?.accuracy ?? 0.0,
          updatedAt: event.recordedAt,
        };
        queries.push(ProjectionsRepository.createUpsertStudyProgressQuery(db, updatedProgress));

        // 2. Update daily_states
        const existingDaily = await ProjectionsRepository.getDailyStateByDate(db, eventDate);
        const updatedDaily: DailyState = {
          id: existingDaily?.id ?? generateId('daily'),
          date: eventDate,
          studyMinutes: (existingDaily?.studyMinutes ?? 0) + minutes,
          completedChapters: existingDaily?.completedChapters ?? 0,
          questionsAttempted: existingDaily?.questionsAttempted ?? 0,
          questionsCorrect: existingDaily?.questionsCorrect ?? 0,
          accuracy: existingDaily?.accuracy ?? 0.0,
          missedSessions: existingDaily?.missedSessions ?? 0,
          completedTasks: existingDaily?.completedTasks ?? 0,
          pendingTasks: existingDaily?.pendingTasks ?? 0,
          statePayload: existingDaily?.statePayload ?? '{}',
          updatedAt: event.recordedAt,
        };
        queries.push(ProjectionsRepository.createUpsertDailyStateQuery(db, updatedDaily));
        break;
      }

      case 'study_session_recorded': {
        const payload = event.payload as {
          chapterId: string;
          subjectId: string;
          durationSeconds: number;
        };
        const minutes = Math.floor(payload.durationSeconds / 60);

        const existingProgress = await ProjectionsRepository.getStudyProgressByChapter(
          db,
          payload.chapterId
        );
        const updatedProgress: StudyProgress = {
          id: existingProgress?.id ?? generateId('prog'),
          subjectId: payload.subjectId,
          chapterId: payload.chapterId,
          status:
            existingProgress?.status === 'NOT_STARTED'
              ? 'IN_PROGRESS'
              : (existingProgress?.status ?? 'IN_PROGRESS'),
          progressPercent: existingProgress?.progressPercent ?? 0.0,
          confidence: existingProgress?.confidence ?? 0.0,
          lastStudiedAt: event.occurredAt,
          lastCompletedAt: existingProgress?.lastCompletedAt,
          questionsAttempted: existingProgress?.questionsAttempted ?? 0,
          questionsCorrect: existingProgress?.questionsCorrect ?? 0,
          accuracy: existingProgress?.accuracy ?? 0.0,
          updatedAt: event.recordedAt,
        };
        queries.push(ProjectionsRepository.createUpsertStudyProgressQuery(db, updatedProgress));

        const existingDaily = await ProjectionsRepository.getDailyStateByDate(db, eventDate);
        const updatedDaily: DailyState = {
          id: existingDaily?.id ?? generateId('daily'),
          date: eventDate,
          studyMinutes: (existingDaily?.studyMinutes ?? 0) + minutes,
          completedChapters: existingDaily?.completedChapters ?? 0,
          questionsAttempted: existingDaily?.questionsAttempted ?? 0,
          questionsCorrect: existingDaily?.questionsCorrect ?? 0,
          accuracy: existingDaily?.accuracy ?? 0.0,
          missedSessions: existingDaily?.missedSessions ?? 0,
          completedTasks: existingDaily?.completedTasks ?? 0,
          pendingTasks: existingDaily?.pendingTasks ?? 0,
          statePayload: existingDaily?.statePayload ?? '{}',
          updatedAt: event.recordedAt,
        };
        queries.push(ProjectionsRepository.createUpsertDailyStateQuery(db, updatedDaily));
        break;
      }

      case 'questions_attempted': {
        const payload = event.payload as {
          chapterId: string;
          subjectId?: string;
          questionsAttempted: number;
          questionsCorrect: number;
        };

        // 1. Update chapter study_progress
        const existingProgress = await ProjectionsRepository.getStudyProgressByChapter(
          db,
          payload.chapterId
        );
        const newChapterAttempted =
          (existingProgress?.questionsAttempted ?? 0) + payload.questionsAttempted;
        const newChapterCorrect =
          (existingProgress?.questionsCorrect ?? 0) + payload.questionsCorrect;
        const newChapterAccuracy = deriveAccuracy(newChapterCorrect, newChapterAttempted);

        const updatedProgress: StudyProgress = {
          id: existingProgress?.id ?? generateId('prog'),
          subjectId: payload.subjectId ?? existingProgress?.subjectId ?? 'subj_default',
          chapterId: payload.chapterId,
          status:
            existingProgress?.status === 'NOT_STARTED'
              ? 'IN_PROGRESS'
              : (existingProgress?.status ?? 'IN_PROGRESS'),
          progressPercent: existingProgress?.progressPercent ?? 0.0,
          confidence: existingProgress?.confidence ?? 0.0,
          lastStudiedAt: event.occurredAt,
          lastCompletedAt: existingProgress?.lastCompletedAt,
          questionsAttempted: newChapterAttempted,
          questionsCorrect: newChapterCorrect,
          accuracy: newChapterAccuracy,
          updatedAt: event.recordedAt,
        };
        queries.push(ProjectionsRepository.createUpsertStudyProgressQuery(db, updatedProgress));

        // 2. Update daily_states
        const existingDaily = await ProjectionsRepository.getDailyStateByDate(db, eventDate);
        const newDailyAttempted =
          (existingDaily?.questionsAttempted ?? 0) + payload.questionsAttempted;
        const newDailyCorrect =
          (existingDaily?.questionsCorrect ?? 0) + payload.questionsCorrect;
        const newDailyAccuracy = deriveAccuracy(newDailyCorrect, newDailyAttempted);

        const updatedDaily: DailyState = {
          id: existingDaily?.id ?? generateId('daily'),
          date: eventDate,
          studyMinutes: existingDaily?.studyMinutes ?? 0,
          completedChapters: existingDaily?.completedChapters ?? 0,
          questionsAttempted: newDailyAttempted,
          questionsCorrect: newDailyCorrect,
          accuracy: newDailyAccuracy,
          missedSessions: existingDaily?.missedSessions ?? 0,
          completedTasks: existingDaily?.completedTasks ?? 0,
          pendingTasks: existingDaily?.pendingTasks ?? 0,
          statePayload: existingDaily?.statePayload ?? '{}',
          updatedAt: event.recordedAt,
        };
        queries.push(ProjectionsRepository.createUpsertDailyStateQuery(db, updatedDaily));
        break;
      }

      case 'chapter_progress_updated': {
        const payload = event.payload as {
          chapterId: string;
          progress: number;
        };

        const existingProgress = await ProjectionsRepository.getStudyProgressByChapter(
          db,
          payload.chapterId
        );
        const isCompleted = payload.progress >= 1.0;
        const updatedStatus = isCompleted
          ? 'COMPLETED'
          : existingProgress?.status === 'NOT_STARTED' && payload.progress > 0
          ? 'IN_PROGRESS'
          : (existingProgress?.status ?? 'IN_PROGRESS');

        const updatedProgress: StudyProgress = {
          id: existingProgress?.id ?? generateId('prog'),
          subjectId: existingProgress?.subjectId ?? 'subj_default',
          chapterId: payload.chapterId,
          status: updatedStatus,
          progressPercent: payload.progress,
          confidence: existingProgress?.confidence ?? 0.0,
          lastStudiedAt: event.occurredAt,
          lastCompletedAt: isCompleted
            ? (existingProgress?.lastCompletedAt ?? event.occurredAt)
            : existingProgress?.lastCompletedAt,
          questionsAttempted: existingProgress?.questionsAttempted ?? 0,
          questionsCorrect: existingProgress?.questionsCorrect ?? 0,
          accuracy: existingProgress?.accuracy ?? 0.0,
          updatedAt: event.recordedAt,
        };
        queries.push(ProjectionsRepository.createUpsertStudyProgressQuery(db, updatedProgress));
        break;
      }

      case 'chapter_completed': {
        const payload = event.payload as {
          chapterId: string;
          subjectId?: string;
        };

        const existingProgress = await ProjectionsRepository.getStudyProgressByChapter(
          db,
          payload.chapterId
        );
        const updatedProgress: StudyProgress = {
          id: existingProgress?.id ?? generateId('prog'),
          subjectId: payload.subjectId ?? existingProgress?.subjectId ?? 'subj_default',
          chapterId: payload.chapterId,
          status: 'COMPLETED',
          progressPercent: 1.0,
          confidence: existingProgress?.confidence ?? 1.0,
          lastStudiedAt: event.occurredAt,
          lastCompletedAt: event.occurredAt,
          questionsAttempted: existingProgress?.questionsAttempted ?? 0,
          questionsCorrect: existingProgress?.questionsCorrect ?? 0,
          accuracy: existingProgress?.accuracy ?? 0.0,
          updatedAt: event.recordedAt,
        };
        queries.push(ProjectionsRepository.createUpsertStudyProgressQuery(db, updatedProgress));

        const existingDaily = await ProjectionsRepository.getDailyStateByDate(db, eventDate);
        const updatedDaily: DailyState = {
          id: existingDaily?.id ?? generateId('daily'),
          date: eventDate,
          studyMinutes: existingDaily?.studyMinutes ?? 0,
          completedChapters: (existingDaily?.completedChapters ?? 0) + 1,
          questionsAttempted: existingDaily?.questionsAttempted ?? 0,
          questionsCorrect: existingDaily?.questionsCorrect ?? 0,
          accuracy: existingDaily?.accuracy ?? 0.0,
          missedSessions: existingDaily?.missedSessions ?? 0,
          completedTasks: existingDaily?.completedTasks ?? 0,
          pendingTasks: existingDaily?.pendingTasks ?? 0,
          statePayload: existingDaily?.statePayload ?? '{}',
          updatedAt: event.recordedAt,
        };
        queries.push(ProjectionsRepository.createUpsertDailyStateQuery(db, updatedDaily));
        break;
      }

      case 'schedule_missed': {
        const existingDaily = await ProjectionsRepository.getDailyStateByDate(db, eventDate);
        const updatedDaily: DailyState = {
          id: existingDaily?.id ?? generateId('daily'),
          date: eventDate,
          studyMinutes: existingDaily?.studyMinutes ?? 0,
          completedChapters: existingDaily?.completedChapters ?? 0,
          questionsAttempted: existingDaily?.questionsAttempted ?? 0,
          questionsCorrect: existingDaily?.questionsCorrect ?? 0,
          accuracy: existingDaily?.accuracy ?? 0.0,
          missedSessions: (existingDaily?.missedSessions ?? 0) + 1,
          completedTasks: existingDaily?.completedTasks ?? 0,
          pendingTasks: existingDaily?.pendingTasks ?? 0,
          statePayload: existingDaily?.statePayload ?? '{}',
          updatedAt: event.recordedAt,
        };
        queries.push(ProjectionsRepository.createUpsertDailyStateQuery(db, updatedDaily));
        break;
      }

      case 'task_completed': {
        const existingDaily = await ProjectionsRepository.getDailyStateByDate(db, eventDate);
        const updatedDaily: DailyState = {
          id: existingDaily?.id ?? generateId('daily'),
          date: eventDate,
          studyMinutes: existingDaily?.studyMinutes ?? 0,
          completedChapters: existingDaily?.completedChapters ?? 0,
          questionsAttempted: existingDaily?.questionsAttempted ?? 0,
          questionsCorrect: existingDaily?.questionsCorrect ?? 0,
          accuracy: existingDaily?.accuracy ?? 0.0,
          missedSessions: existingDaily?.missedSessions ?? 0,
          completedTasks: (existingDaily?.completedTasks ?? 0) + 1,
          pendingTasks: Math.max(0, (existingDaily?.pendingTasks ?? 1) - 1),
          statePayload: existingDaily?.statePayload ?? '{}',
          updatedAt: event.recordedAt,
        };
        queries.push(ProjectionsRepository.createUpsertDailyStateQuery(db, updatedDaily));
        break;
      }

      default:
        // Other events do not mutate initial projections
        break;
    }

    return queries;
  }

  /**
   * Deterministic Rebuild Capability:
   * 1. Reads all canonical events ordered chronologically (occurred_at ASC).
   * 2. Sequentially reduces all events in memory to derive study_progress and daily_states.
   * 3. Truncates derived projection tables in D1.
   * 4. Batches in the newly computed deterministic projection rows.
   */
  static async rebuildProjections(
    d1: D1Database,
    db: Kysely<Database>,
    userTimezone: string = 'UTC'
  ): Promise<{ eventsProcessed: number; progressCount: number; dailyCount: number }> {
    // 1. Fetch all canonical events strictly ordered chronologically
    const events = await db
      .selectFrom('canonical_events')
      .selectAll()
      .orderBy('occurred_at', 'asc')
      .execute();

    const progressMap = new Map<string, StudyProgress>();
    const dailyMap = new Map<string, DailyState>();

    // 2. In-memory deterministic reduction
    for (const raw of events) {
      const event: CanonicalEvent = {
        eventId: raw.event_id,
        eventType: raw.event_type as any,
        schemaVersion: raw.schema_version,
        occurredAt: raw.occurred_at,
        recordedAt: raw.recorded_at,
        actor: { type: raw.actor_type, id: raw.actor_id },
        source: { system: raw.source_system as any, interface: raw.source_interface as any },
        payload: JSON.parse(raw.payload),
        correlationId: raw.correlation_id ?? undefined,
        causationId: raw.causation_id ?? undefined,
      };

      const eventDate = this.extractDate(event.occurredAt, userTimezone);

      // Ensure daily state object exists in map
      if (!dailyMap.has(eventDate)) {
        dailyMap.set(eventDate, {
          id: generateId('daily'),
          date: eventDate,
          studyMinutes: 0,
          completedChapters: 0,
          questionsAttempted: 0,
          questionsCorrect: 0,
          accuracy: 0.0,
          missedSessions: 0,
          completedTasks: 0,
          pendingTasks: 0,
          statePayload: '{}',
          updatedAt: event.recordedAt,
        });
      }
      const daily = dailyMap.get(eventDate)!;

      switch (event.eventType) {
        case 'study_completed': {
          const payload = event.payload as {
            chapterId: string;
            subjectId?: string;
            durationSeconds: number;
          };
          const minutes = Math.floor(payload.durationSeconds / 60);

          if (!progressMap.has(payload.chapterId)) {
            progressMap.set(payload.chapterId, {
              id: generateId('prog'),
              subjectId: payload.subjectId ?? 'subj_default',
              chapterId: payload.chapterId,
              status: 'IN_PROGRESS',
              progressPercent: 0.0,
              confidence: 0.0,
              lastStudiedAt: event.occurredAt,
              lastCompletedAt: undefined,
              questionsAttempted: 0,
              questionsCorrect: 0,
              accuracy: 0.0,
              updatedAt: event.recordedAt,
            });
          } else {
            const prog = progressMap.get(payload.chapterId)!;
            prog.lastStudiedAt = event.occurredAt;
            if (prog.status === 'NOT_STARTED') prog.status = 'IN_PROGRESS';
            prog.updatedAt = event.recordedAt;
          }

          daily.studyMinutes += minutes;
          daily.updatedAt = event.recordedAt;
          break;
        }

        case 'study_session_recorded': {
          const payload = event.payload as {
            chapterId: string;
            subjectId: string;
            durationSeconds: number;
          };
          const minutes = Math.floor(payload.durationSeconds / 60);

          if (!progressMap.has(payload.chapterId)) {
            progressMap.set(payload.chapterId, {
              id: generateId('prog'),
              subjectId: payload.subjectId,
              chapterId: payload.chapterId,
              status: 'IN_PROGRESS',
              progressPercent: 0.0,
              confidence: 0.0,
              lastStudiedAt: event.occurredAt,
              lastCompletedAt: undefined,
              questionsAttempted: 0,
              questionsCorrect: 0,
              accuracy: 0.0,
              updatedAt: event.recordedAt,
            });
          } else {
            const prog = progressMap.get(payload.chapterId)!;
            prog.lastStudiedAt = event.occurredAt;
            if (prog.status === 'NOT_STARTED') prog.status = 'IN_PROGRESS';
            prog.updatedAt = event.recordedAt;
          }

          daily.studyMinutes += minutes;
          daily.updatedAt = event.recordedAt;
          break;
        }

        case 'questions_attempted': {
          const payload = event.payload as {
            chapterId: string;
            subjectId?: string;
            questionsAttempted: number;
            questionsCorrect: number;
          };

          if (!progressMap.has(payload.chapterId)) {
            const acc = deriveAccuracy(payload.questionsCorrect, payload.questionsAttempted);
            progressMap.set(payload.chapterId, {
              id: generateId('prog'),
              subjectId: payload.subjectId ?? 'subj_default',
              chapterId: payload.chapterId,
              status: 'IN_PROGRESS',
              progressPercent: 0.0,
              confidence: 0.0,
              lastStudiedAt: event.occurredAt,
              lastCompletedAt: undefined,
              questionsAttempted: payload.questionsAttempted,
              questionsCorrect: payload.questionsCorrect,
              accuracy: acc,
              updatedAt: event.recordedAt,
            });
          } else {
            const prog = progressMap.get(payload.chapterId)!;
            prog.questionsAttempted += payload.questionsAttempted;
            prog.questionsCorrect += payload.questionsCorrect;
            prog.accuracy = deriveAccuracy(prog.questionsCorrect, prog.questionsAttempted);
            prog.lastStudiedAt = event.occurredAt;
            if (prog.status === 'NOT_STARTED') prog.status = 'IN_PROGRESS';
            prog.updatedAt = event.recordedAt;
          }

          daily.questionsAttempted += payload.questionsAttempted;
          daily.questionsCorrect += payload.questionsCorrect;
          daily.accuracy = deriveAccuracy(daily.questionsCorrect, daily.questionsAttempted);
          daily.updatedAt = event.recordedAt;
          break;
        }

        case 'chapter_progress_updated': {
          const payload = event.payload as {
            chapterId: string;
            progress: number;
          };
          const isComp = payload.progress >= 1.0;

          if (!progressMap.has(payload.chapterId)) {
            progressMap.set(payload.chapterId, {
              id: generateId('prog'),
              subjectId: 'subj_default',
              chapterId: payload.chapterId,
              status: isComp ? 'COMPLETED' : payload.progress > 0 ? 'IN_PROGRESS' : 'NOT_STARTED',
              progressPercent: payload.progress,
              confidence: 0.0,
              lastStudiedAt: event.occurredAt,
              lastCompletedAt: isComp ? event.occurredAt : undefined,
              questionsAttempted: 0,
              questionsCorrect: 0,
              accuracy: 0.0,
              updatedAt: event.recordedAt,
            });
          } else {
            const prog = progressMap.get(payload.chapterId)!;
            prog.progressPercent = payload.progress;
            if (isComp) {
              prog.status = 'COMPLETED';
              prog.lastCompletedAt = prog.lastCompletedAt ?? event.occurredAt;
            }
            prog.updatedAt = event.recordedAt;
          }
          break;
        }

        case 'chapter_completed': {
          const payload = event.payload as {
            chapterId: string;
            subjectId?: string;
          };

          if (!progressMap.has(payload.chapterId)) {
            progressMap.set(payload.chapterId, {
              id: generateId('prog'),
              subjectId: payload.subjectId ?? 'subj_default',
              chapterId: payload.chapterId,
              status: 'COMPLETED',
              progressPercent: 1.0,
              confidence: 1.0,
              lastStudiedAt: event.occurredAt,
              lastCompletedAt: event.occurredAt,
              questionsAttempted: 0,
              questionsCorrect: 0,
              accuracy: 0.0,
              updatedAt: event.recordedAt,
            });
          } else {
            const prog = progressMap.get(payload.chapterId)!;
            prog.status = 'COMPLETED';
            prog.progressPercent = 1.0;
            prog.lastStudiedAt = event.occurredAt;
            prog.lastCompletedAt = event.occurredAt;
            prog.updatedAt = event.recordedAt;
          }

          daily.completedChapters += 1;
          daily.updatedAt = event.recordedAt;
          break;
        }

        case 'schedule_missed': {
          daily.missedSessions += 1;
          daily.updatedAt = event.recordedAt;
          break;
        }

        case 'task_completed': {
          daily.completedTasks += 1;
          daily.pendingTasks = Math.max(0, daily.pendingTasks - 1);
          daily.updatedAt = event.recordedAt;
          break;
        }
      }
    }

    // 3. Atomically truncate and re-insert all projections using D1 batch
    const truncateQueries = ProjectionsRepository.createTruncateProjectionsQueries(db);

    const insertProgressQueries = Array.from(progressMap.values()).map(prog =>
      ProjectionsRepository.createUpsertStudyProgressQuery(db, prog)
    );

    const insertDailyQueries = Array.from(dailyMap.values()).map(daily =>
      ProjectionsRepository.createUpsertDailyStateQuery(db, daily)
    );

    await executeD1Batch(d1, [
      ...truncateQueries,
      ...insertProgressQueries,
      ...insertDailyQueries,
    ]);

    return {
      eventsProcessed: events.length,
      progressCount: progressMap.size,
      dailyCount: dailyMap.size,
    };
  }
}
