import { Kysely } from 'kysely';
import { Database } from '../tables';
import { StudyProgress, DailyState } from '@personal-os/domain';

export class ProjectionsRepository {
  // ==========================================================================
  // Study Progress Projections
  // ==========================================================================

  /**
   * Generates a query to upsert (insert or replace/update) a study_progress projection row.
   */
  static createUpsertStudyProgressQuery(db: Kysely<Database>, progress: StudyProgress) {
    return db
      .insertInto('study_progress')
      .values({
        id: progress.id,
        subject_id: progress.subjectId,
        chapter_id: progress.chapterId,
        status: progress.status,
        progress_percent: progress.progressPercent,
        confidence: progress.confidence,
        last_studied_at: progress.lastStudiedAt ?? null,
        last_completed_at: progress.lastCompletedAt ?? null,
        questions_attempted: progress.questionsAttempted,
        questions_correct: progress.questionsCorrect,
        accuracy: progress.accuracy,
        updated_at: progress.updatedAt,
      })
      .onConflict(oc =>
        oc.column('chapter_id').doUpdateSet({
          status: progress.status,
          progress_percent: progress.progressPercent,
          confidence: progress.confidence,
          last_studied_at: progress.lastStudiedAt ?? null,
          last_completed_at: progress.lastCompletedAt ?? null,
          questions_attempted: progress.questionsAttempted,
          questions_correct: progress.questionsCorrect,
          accuracy: progress.accuracy,
          updated_at: progress.updatedAt,
        })
      );
  }

  static async getStudyProgressByChapter(
    db: Kysely<Database>,
    chapterId: string
  ): Promise<StudyProgress | null> {
    const row = await db
      .selectFrom('study_progress')
      .selectAll()
      .where('chapter_id', '=', chapterId)
      .executeTakeFirst();

    if (!row) return null;

    return {
      id: row.id,
      subjectId: row.subject_id,
      chapterId: row.chapter_id,
      status: row.status,
      progressPercent: row.progress_percent,
      confidence: row.confidence,
      lastStudiedAt: row.last_studied_at ?? undefined,
      lastCompletedAt: row.last_completed_at ?? undefined,
      questionsAttempted: row.questions_attempted,
      questionsCorrect: row.questions_correct,
      accuracy: row.accuracy,
      updatedAt: row.updated_at,
    };
  }

  static async getAllStudyProgress(db: Kysely<Database>): Promise<StudyProgress[]> {
    const rows = await db.selectFrom('study_progress').selectAll().execute();
    return rows.map(row => ({
      id: row.id,
      subjectId: row.subject_id,
      chapterId: row.chapter_id,
      status: row.status,
      progressPercent: row.progress_percent,
      confidence: row.confidence,
      lastStudiedAt: row.last_studied_at ?? undefined,
      lastCompletedAt: row.last_completed_at ?? undefined,
      questionsAttempted: row.questions_attempted,
      questionsCorrect: row.questions_correct,
      accuracy: row.accuracy,
      updatedAt: row.updated_at,
    }));
  }

  // ==========================================================================
  // Daily States Projections
  // ==========================================================================

  /**
   * Generates a query to upsert a daily_states projection row.
   */
  static createUpsertDailyStateQuery(db: Kysely<Database>, state: DailyState) {
    return db
      .insertInto('daily_states')
      .values({
        id: state.id,
        date: state.date,
        study_minutes: state.studyMinutes,
        completed_chapters: state.completedChapters,
        questions_attempted: state.questionsAttempted,
        questions_correct: state.questionsCorrect,
        accuracy: state.accuracy,
        missed_sessions: state.missedSessions,
        completed_tasks: state.completedTasks,
        pending_tasks: state.pendingTasks,
        state_payload: state.statePayload,
        updated_at: state.updatedAt,
      })
      .onConflict(oc =>
        oc.column('date').doUpdateSet({
          study_minutes: state.studyMinutes,
          completed_chapters: state.completedChapters,
          questions_attempted: state.questionsAttempted,
          questions_correct: state.questionsCorrect,
          accuracy: state.accuracy,
          missed_sessions: state.missedSessions,
          completed_tasks: state.completedTasks,
          pending_tasks: state.pendingTasks,
          state_payload: state.statePayload,
          updated_at: state.updatedAt,
        })
      );
  }

  static async getDailyStateByDate(
    db: Kysely<Database>,
    date: string
  ): Promise<DailyState | null> {
    const row = await db
      .selectFrom('daily_states')
      .selectAll()
      .where('date', '=', date)
      .executeTakeFirst();

    if (!row) return null;

    return {
      id: row.id,
      date: row.date,
      studyMinutes: row.study_minutes,
      completedChapters: row.completed_chapters,
      questionsAttempted: row.questions_attempted,
      questionsCorrect: row.questions_correct,
      accuracy: row.accuracy,
      missedSessions: row.missed_sessions,
      completedTasks: row.completed_tasks,
      pendingTasks: row.pending_tasks,
      statePayload: row.state_payload,
      updatedAt: row.updated_at,
    };
  }

  static async getAllDailyStates(db: Kysely<Database>): Promise<DailyState[]> {
    const rows = await db.selectFrom('daily_states').selectAll().orderBy('date', 'asc').execute();
    return rows.map(row => ({
      id: row.id,
      date: row.date,
      studyMinutes: row.study_minutes,
      completedChapters: row.completed_chapters,
      questionsAttempted: row.questions_attempted,
      questionsCorrect: row.questions_correct,
      accuracy: row.accuracy,
      missedSessions: row.missed_sessions,
      completedTasks: row.completed_tasks,
      pendingTasks: row.pending_tasks,
      statePayload: row.state_payload,
      updatedAt: row.updated_at,
    }));
  }

  // ==========================================================================
  // Projection Truncation (for Deterministic Rebuilds)
  // ==========================================================================

  static createTruncateProjectionsQueries(db: Kysely<Database>) {
    return [
      db.deleteFrom('study_progress'),
      db.deleteFrom('daily_states'),
    ];
  }
}
