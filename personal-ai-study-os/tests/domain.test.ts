import { describe, it, expect } from 'vitest';
import {
  generateId,
  isValidId,
  UserSchema,
  SubjectSchema,
  ChapterSchema,
  StudyProgressSchema,
  StudySessionSchema,
  QuestionsAttemptedPayloadSchema,
  CanonicalEventSchema,
  deriveAccuracy,
} from '@personal-os/domain';

describe('Domain Layer: Entities, Identifiers & Mathematical Validation', () => {
  describe('Stable Opaque Identifiers', () => {
    it('generates valid prefixed opaque IDs', () => {
      const usrId = generateId('usr');
      expect(usrId).toMatch(/^usr_[0123456789ABCDEFGHJKMNPQRSTVWXYZ]+$/i);
      expect(isValidId(usrId, 'usr')).toBe(true);
      expect(isValidId(usrId, 'chap')).toBe(false);

      const chapId = generateId('chap');
      expect(isValidId(chapId, 'chap')).toBe(true);

      const evtId = generateId('evt');
      expect(isValidId(evtId, 'evt')).toBe(true);
    });

    it('rejects invalid or malformed IDs', () => {
      expect(isValidId('invalid_id_format')).toBe(false);
      expect(isValidId('')).toBe(false);
      expect(isValidId('usr_short')).toBe(false);
      expect(isValidId('usr_contains!illegal#chars')).toBe(false);
    });
  });

  describe('Entities Validation', () => {
    it('accepts valid User entity and rejects invalid', () => {
      const validUser = {
        id: generateId('usr'),
        timezone: 'Asia/Kolkata',
        status: 'active' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      expect(UserSchema.parse(validUser)).toEqual(validUser);

      // Invalid status
      expect(() =>
        UserSchema.parse({
          ...validUser,
          status: 'banned',
        })
      ).toThrow();
    });

    it('accepts valid Subject and Chapter entities', () => {
      const subjId = generateId('subj');
      const validSubj = {
        id: subjId,
        name: 'Physics',
        slug: 'physics',
        description: 'JEE Advanced Physics',
        status: 'active' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      expect(SubjectSchema.parse(validSubj)).toEqual(validSubj);

      const validChap = {
        id: generateId('chap'),
        subjectId: subjId,
        name: 'Rotational Motion',
        slug: 'rotational-motion',
        status: 'not_started' as const,
        progress: 0.0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      expect(ChapterSchema.parse(validChap)).toEqual(validChap);
    });

    it('enforces mathematical constraint on StudyProgress (questionsCorrect <= questionsAttempted)', () => {
      const validProgress = {
        id: generateId('prog'),
        subjectId: generateId('subj'),
        chapterId: generateId('chap'),
        status: 'IN_PROGRESS' as const,
        progressPercent: 0.6,
        confidence: 0.7,
        questionsAttempted: 25,
        questionsCorrect: 20,
        accuracy: 0.8,
        updatedAt: new Date().toISOString(),
      };
      expect(StudyProgressSchema.parse(validProgress)).toBeDefined();

      // Invalid: 26 correct out of 25 attempted
      expect(() =>
        StudyProgressSchema.parse({
          ...validProgress,
          questionsAttempted: 25,
          questionsCorrect: 26,
        })
      ).toThrow(/questionsCorrect cannot exceed questionsAttempted/);
    });

    it('enforces temporal constraint on StudySession (endedAt >= startedAt)', () => {
      const now = new Date();
      const past = new Date(now.getTime() - 3600000);

      const validSession = {
        id: generateId('sess'),
        subjectId: generateId('subj'),
        chapterId: generateId('chap'),
        startedAt: past.toISOString(),
        endedAt: now.toISOString(),
        durationSeconds: 3600,
        activityType: 'deep_work' as const,
        source: 'google_calendar',
        status: 'completed' as const,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      expect(StudySessionSchema.parse(validSession)).toBeDefined();

      // Inverted timestamps: endedAt before startedAt
      expect(() =>
        StudySessionSchema.parse({
          ...validSession,
          startedAt: now.toISOString(),
          endedAt: past.toISOString(),
        })
      ).toThrow(/endedAt must be greater than or equal to startedAt/);
    });
  });

  describe('Event Payloads & Mathematical Constraints', () => {
    it('enforces questionsCorrect <= questionsAttempted in QuestionsAttempted payload', () => {
      const valid = {
        chapterId: generateId('chap'),
        questionsAttempted: 10,
        questionsCorrect: 8,
      };
      expect(QuestionsAttemptedPayloadSchema.parse(valid)).toBeDefined();

      const invalid = {
        chapterId: generateId('chap'),
        questionsAttempted: 10,
        questionsCorrect: 11,
      };
      expect(() => QuestionsAttemptedPayloadSchema.parse(invalid)).toThrow(
        /questionsCorrect cannot exceed questionsAttempted/
      );
    });

    it('deriveAccuracy computes deterministic ratio with 4-decimal precision', () => {
      expect(deriveAccuracy(0, 0)).toBe(0.0);
      expect(deriveAccuracy(5, 10)).toBe(0.5);
      expect(deriveAccuracy(1, 3)).toBe(0.3333);
      expect(deriveAccuracy(2, 3)).toBe(0.6667);
      expect(deriveAccuracy(10, 10)).toBe(1.0);
    });

    it('validates canonical event envelope structure via discriminated union', () => {
      const validEvent = {
        eventId: generateId('evt'),
        eventType: 'questions_attempted',
        schemaVersion: 1,
        occurredAt: new Date().toISOString(),
        recordedAt: new Date().toISOString(),
        actor: { type: 'user' as const, id: 'usr_01J' },
        source: { system: 'chatgpt' as const, interface: 'natural_language' as const },
        payload: {
          chapterId: generateId('chap'),
          questionsAttempted: 15,
          questionsCorrect: 12,
        },
      };

      const parsed = CanonicalEventSchema.parse(validEvent);
      expect(parsed.eventType).toBe('questions_attempted');

      // Missing required envelope field (e.g. actor)
      expect(() =>
        CanonicalEventSchema.parse({
          ...validEvent,
          actor: undefined,
        })
      ).toThrow();
    });
  });
});
