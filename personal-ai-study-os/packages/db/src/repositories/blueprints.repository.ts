import { Kysely } from 'kysely';
import { Database } from '../tables';
import {
  ScheduleBlueprint,
  ScheduleTimeMap,
  ScheduleConstraint,
} from '@personal-os/domain';

export class BlueprintsRepository {
  // ==========================================================================
  // Schedule Blueprints
  // ==========================================================================

  static async getActiveBlueprint(
    db: Kysely<Database>,
    userId?: string
  ): Promise<ScheduleBlueprint | null> {
    let query = db
      .selectFrom('schedule_blueprints')
      .selectAll()
      .where('is_active', '=', 1);

    if (userId) {
      query = query.where('user_id', '=', userId);
    }

    const row = await query.orderBy('updated_at', 'desc').executeTakeFirst();
    if (!row) return null;

    let parsedBufferDays: number[] = [0];
    try {
      parsedBufferDays = JSON.parse(row.buffer_days || '[0]');
    } catch {
      parsedBufferDays = [0];
    }

    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      timezone: row.timezone,
      isActive: row.is_active === 1,
      version: row.version,
      maxDailyDeepWorkMinutes: row.max_daily_deep_work_minutes,
      maxDailyFocusContainers: row.max_daily_focus_containers,
      maxContinuousSessionMinutes: row.max_continuous_session_minutes,
      defaultDecompressionBufferMinutes: row.default_decompression_buffer_minutes,
      freezeWindowMinutes: row.freeze_window_minutes,
      bufferDays: parsedBufferDays,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  static async getBlueprint(
    db: Kysely<Database>,
    id: string
  ): Promise<ScheduleBlueprint | null> {
    const row = await db
      .selectFrom('schedule_blueprints')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!row) return null;

    let parsedBufferDays: number[] = [0];
    try {
      parsedBufferDays = JSON.parse(row.buffer_days || '[0]');
    } catch {
      parsedBufferDays = [0];
    }

    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      timezone: row.timezone,
      isActive: row.is_active === 1,
      version: row.version,
      maxDailyDeepWorkMinutes: row.max_daily_deep_work_minutes,
      maxDailyFocusContainers: row.max_daily_focus_containers,
      maxContinuousSessionMinutes: row.max_continuous_session_minutes,
      defaultDecompressionBufferMinutes: row.default_decompression_buffer_minutes,
      freezeWindowMinutes: row.freeze_window_minutes,
      bufferDays: parsedBufferDays,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  static async insertBlueprint(
    db: Kysely<Database>,
    blueprint: ScheduleBlueprint
  ) {
    return await db
      .insertInto('schedule_blueprints')
      .values({
        id: blueprint.id,
        user_id: blueprint.userId,
        name: blueprint.name,
        timezone: blueprint.timezone,
        is_active: blueprint.isActive ? 1 : 0,
        version: blueprint.version,
        max_daily_deep_work_minutes: blueprint.maxDailyDeepWorkMinutes,
        max_daily_focus_containers: blueprint.maxDailyFocusContainers,
        max_continuous_session_minutes: blueprint.maxContinuousSessionMinutes,
        default_decompression_buffer_minutes: blueprint.defaultDecompressionBufferMinutes,
        freeze_window_minutes: blueprint.freezeWindowMinutes,
        buffer_days: JSON.stringify(blueprint.bufferDays),
        created_at: blueprint.createdAt,
        updated_at: blueprint.updatedAt,
      })
      .execute();
  }

  static async setActiveBlueprint(
    db: Kysely<Database>,
    userId: string,
    blueprintId: string
  ) {
    // Deactivate all blueprints for user, then activate targeted blueprint
    await db
      .updateTable('schedule_blueprints')
      .set({ is_active: 0, updated_at: new Date().toISOString() })
      .where('user_id', '=', userId)
      .execute();

    return await db
      .updateTable('schedule_blueprints')
      .set({ is_active: 1, updated_at: new Date().toISOString() })
      .where('id', '=', blueprintId)
      .execute();
  }

  // ==========================================================================
  // Schedule Time Maps
  // ==========================================================================

  static async getTimeMaps(
    db: Kysely<Database>,
    blueprintId: string,
    dayOfWeek?: number | null
  ): Promise<ScheduleTimeMap[]> {
    let query = db
      .selectFrom('schedule_time_maps')
      .selectAll()
      .where('blueprint_id', '=', blueprintId);

    if (dayOfWeek !== undefined && dayOfWeek !== null) {
      // Include specific day or generic (dayOfWeek IS NULL) maps
      query = query.where((eb) =>
        eb.or([eb('day_of_week', '=', dayOfWeek), eb('day_of_week', 'is', null)])
      );
    }

    const rows = await query.orderBy('start_time', 'asc').execute();
    return rows.map((row) => ({
      id: row.id,
      blueprintId: row.blueprint_id,
      dayOfWeek: row.day_of_week,
      startTime: row.start_time,
      endTime: row.end_time,
      subjectId: row.subject_id,
      activityType: row.activity_type,
      containerId: row.container_id,
      isOptional: row.is_optional === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  static async insertTimeMap(
    db: Kysely<Database>,
    timeMap: ScheduleTimeMap
  ) {
    return await db
      .insertInto('schedule_time_maps')
      .values({
        id: timeMap.id,
        blueprint_id: timeMap.blueprintId,
        day_of_week: timeMap.dayOfWeek ?? null,
        start_time: timeMap.startTime,
        end_time: timeMap.endTime,
        subject_id: timeMap.subjectId ?? null,
        activity_type: timeMap.activityType,
        container_id: timeMap.containerId ?? null,
        is_optional: timeMap.isOptional ? 1 : 0,
        created_at: timeMap.createdAt,
        updated_at: timeMap.updatedAt,
      })
      .execute();
  }

  // ==========================================================================
  // Schedule Constraints
  // ==========================================================================

  static async getConstraints(
    db: Kysely<Database>,
    blueprintId: string,
    dayOfWeek?: number | null
  ): Promise<ScheduleConstraint[]> {
    let query = db
      .selectFrom('schedule_constraints')
      .selectAll()
      .where('blueprint_id', '=', blueprintId);

    if (dayOfWeek !== undefined && dayOfWeek !== null) {
      query = query.where((eb) =>
        eb.or([eb('day_of_week', '=', dayOfWeek), eb('day_of_week', 'is', null)])
      );
    }

    const rows = await query.orderBy('start_time', 'asc').execute();
    return rows.map((row) => ({
      id: row.id,
      blueprintId: row.blueprint_id,
      name: row.name,
      constraintType: row.constraint_type,
      dayOfWeek: row.day_of_week,
      startTime: row.start_time,
      endTime: row.end_time,
      isHard: row.is_hard === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  static async insertConstraint(
    db: Kysely<Database>,
    constraint: ScheduleConstraint
  ) {
    return await db
      .insertInto('schedule_constraints')
      .values({
        id: constraint.id,
        blueprint_id: constraint.blueprintId,
        name: constraint.name,
        constraint_type: constraint.constraintType,
        day_of_week: constraint.dayOfWeek ?? null,
        start_time: constraint.startTime,
        end_time: constraint.endTime,
        is_hard: constraint.isHard ? 1 : 0,
        created_at: constraint.createdAt,
        updated_at: constraint.updatedAt,
      })
      .execute();
  }

  /**
   * Seeds the authoritative default academic blueprint, time maps, and constraints for a user.
   */
  static async seedDefaultBlueprint(
    db: Kysely<Database>,
    userId: string = 'usr_operator',
    now: string = '2026-09-12T00:00:00.000Z'
  ) {
    const bpId = 'bp_default_academic';
    await db
      .insertInto('schedule_blueprints')
      .values({
        id: bpId,
        user_id: userId,
        name: 'Standard Academic Blueprint',
        timezone: 'Asia/Kolkata',
        is_active: 1,
        version: 1,
        max_daily_deep_work_minutes: 270,
        max_daily_focus_containers: 3,
        max_continuous_session_minutes: 90,
        default_decompression_buffer_minutes: 15,
        freeze_window_minutes: 120,
        buffer_days: '[0]',
        created_at: now,
        updated_at: now,
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();

    await db
      .insertInto('schedule_time_maps')
      .values([
        {
          id: 'tm_morning_focus',
          blueprint_id: bpId,
          day_of_week: null,
          start_time: '09:00',
          end_time: '11:30',
          subject_id: null,
          activity_type: 'deep_work',
          container_id: 'morning_focus',
          is_optional: 0,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'tm_afternoon_practice',
          blueprint_id: bpId,
          day_of_week: null,
          start_time: '14:30',
          end_time: '17:00',
          subject_id: null,
          activity_type: 'pyq_practice',
          container_id: 'afternoon_practice',
          is_optional: 0,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'tm_evening_consolidation',
          blueprint_id: bpId,
          day_of_week: null,
          start_time: '19:30',
          end_time: '21:30',
          subject_id: null,
          activity_type: 'revision',
          container_id: 'evening_consolidation',
          is_optional: 1,
          created_at: now,
          updated_at: now,
        },
      ])
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();

    await db
      .insertInto('schedule_constraints')
      .values([
        {
          id: 'sc_sleep_window',
          blueprint_id: bpId,
          name: 'Sleep & Recovery Window',
          constraint_type: 'biological_invariant',
          day_of_week: null,
          start_time: '23:00',
          end_time: '07:00',
          is_hard: 1,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'sc_lunch_routine',
          blueprint_id: bpId,
          name: 'Lunch & Mental Break',
          constraint_type: 'biological_invariant',
          day_of_week: null,
          start_time: '12:30',
          end_time: '13:30',
          is_hard: 1,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'sc_dinner_routine',
          blueprint_id: bpId,
          name: 'Dinner & Evening Break',
          constraint_type: 'biological_invariant',
          day_of_week: null,
          start_time: '20:30',
          end_time: '21:30',
          is_hard: 1,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'sc_physical_exercise',
          blueprint_id: bpId,
          name: 'Physical Exercise / Health',
          constraint_type: 'personal_routine',
          day_of_week: null,
          start_time: '17:30',
          end_time: '18:30',
          is_hard: 0,
          created_at: now,
          updated_at: now,
        },
      ])
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
  }
}
