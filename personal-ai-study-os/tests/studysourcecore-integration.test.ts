import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { createTestDatabase, TestContext } from './test-helper';
import { PersonalStateService } from '@personal-os/core';
import { EntitiesRepository } from '@personal-os/db';
import { Subject, Chapter } from '@personal-os/domain';
import app from '../apps/worker/src/index';

describe('Slice 6: StudySourceCore Specialist Source Integration', () => {
  let ctx: TestContext;
  let service: PersonalStateService;
  const testJwtSecret = 'test-jwt-secret-key-at-least-32-chars-for-hmac-sha256';

  const testSubjectId = 'subj_pathology';
  const testChapterId1 = 'chap_cellular_injury';
  const testChapterId2 = 'chap_inflammation';

  function makeJwt(payload: Record<string, any>, secret: string = testJwtSecret): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const unsigned = `${header}.${body}`;
    const signature = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
    return `${unsigned}.${signature}`;
  }

  const writeToken = makeJwt({
    sub: 'usr_operator',
    aud: 'personal-ai-study-os',
    scope: 'read write',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const readToken = makeJwt({
    sub: 'usr_operator',
    aud: 'personal-ai-study-os',
    scope: 'read',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const makeEnv = () => ({
    DB: ctx.d1,
    ENVIRONMENT: 'test',
    JWT_SECRET: testJwtSecret,
  });

  beforeEach(async () => {
    ctx = createTestDatabase();
    service = new PersonalStateService(ctx.d1, ctx.db);
    const now = new Date().toISOString();

    // 1. Operator user
    await EntitiesRepository.insertUser(ctx.db, {
      id: 'usr_operator',
      timezone: 'UTC',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });

    // 2. Canonical Subject
    const subject: Subject = {
      id: testSubjectId,
      name: 'General Pathology',
      slug: 'general-pathology',
      description: 'Foundational pathology curriculum',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await EntitiesRepository.insertSubject(ctx.db, subject);

    // 3. Canonical Chapters
    const chap1: Chapter = {
      id: testChapterId1,
      subjectId: testSubjectId,
      name: 'Cellular Injury and Adaptation',
      slug: 'cellular-injury',
      status: 'not_started',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };
    await EntitiesRepository.insertChapter(ctx.db, chap1);

    const chap2: Chapter = {
      id: testChapterId2,
      subjectId: testSubjectId,
      name: 'Inflammation and Repair',
      slug: 'inflammation-repair',
      status: 'not_started',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };
    await EntitiesRepository.insertChapter(ctx.db, chap2);
  });

  describe('Source Registration & Zero Copyright Invariant', () => {
    it('registers external study source metadata without storing full-text content', async () => {
      const sourceId = 'src_robbins_pathology_10e';

      const regRes = await service.recordEvent({
        eventType: 'source_registered',
        actor: { type: 'agent', id: 'agt_studysourcecore' },
        source: { system: 'studysourcecore', interface: 'rest' },
        payload: {
          sourceId,
          title: 'Robbins & Cotran Pathologic Basis of Disease',
          sourceType: 'book',
          author: 'Kumar, Abbas, Aster',
          publisher: 'Elsevier',
          edition: '10th Edition',
          referenceUri: 'isbn:978-0323531139',
        },
      });
      expect(regRes.success).toBe(true);

      // Verify source details in D1
      const sourceState = await service.getSourceState(sourceId);
      expect(sourceState.source.id).toBe(sourceId);
      expect(sourceState.source.title).toBe('Robbins & Cotran Pathologic Basis of Disease');
      expect(sourceState.source.author).toBe('Kumar, Abbas, Aster');
      expect(sourceState.source.publisher).toBe('Elsevier');
      expect(sourceState.source.edition).toBe('10th Edition');
      expect(sourceState.source.referenceUri).toBe('isbn:978-0323531139');
      expect(sourceState.source.status).toBe('registered');

      // Verify zero copyrighted full-text fields exist in DB schema
      const dbRow: any = await ctx.db
        .selectFrom('sources')
        .selectAll()
        .where('id', '=', sourceId)
        .executeTakeFirstOrThrow();

      expect(dbRow.content).toBeUndefined();
      expect(dbRow.full_text).toBeUndefined();
      expect(dbRow.text_content).toBeUndefined();
      expect(dbRow.raw_pdf).toBeUndefined();
    });
  });

  describe('Table of Contents (TOC) & Canonical Curriculum Mapping', () => {
    it('indexes TOC chapters and maps them to canonical curriculum chapters', async () => {
      const sourceId = 'src_robbins_pathology_10e';

      // 1. Register Source
      await service.recordEvent({
        eventType: 'source_registered',
        actor: { type: 'agent', id: 'agt_studysourcecore' },
        source: { system: 'studysourcecore', interface: 'rest' },
        payload: {
          sourceId,
          title: 'Robbins & Cotran Pathologic Basis of Disease',
          sourceType: 'book',
          edition: '10th Edition',
        },
      });

      // 2. Create Source Chapters (TOC items)
      const srcChap1 = 'srcchap_robbins_ch01';
      await service.recordEvent({
        eventType: 'source_chapter_created',
        actor: { type: 'agent', id: 'agt_studysourcecore' },
        source: { system: 'studysourcecore', interface: 'rest' },
        payload: {
          sourceChapterId: srcChap1,
          sourceId,
          title: 'The Genome and Disease',
          chapterNumber: 1,
          locationReference: 'pp. 1-30',
        },
      });

      const srcChap2 = 'srcchap_robbins_ch02';
      await service.recordEvent({
        eventType: 'source_chapter_created',
        actor: { type: 'agent', id: 'agt_studysourcecore' },
        source: { system: 'studysourcecore', interface: 'rest' },
        payload: {
          sourceChapterId: srcChap2,
          sourceId,
          title: 'Cellular Responses to Stress and Toxic Insults: Adaptation, Injury, and Death',
          chapterNumber: 2,
          locationReference: 'pp. 31-68',
        },
      });

      const srcChap3 = 'srcchap_robbins_ch03';
      await service.recordEvent({
        eventType: 'source_chapter_created',
        actor: { type: 'agent', id: 'agt_studysourcecore' },
        source: { system: 'studysourcecore', interface: 'rest' },
        payload: {
          sourceChapterId: srcChap3,
          sourceId,
          title: 'Inflammation and Repair',
          chapterNumber: 3,
          locationReference: 'pp. 69-112',
        },
      });

      // 3. Map Source Chapters to Canonical Curriculum
      await service.recordEvent({
        eventType: 'source_mapped',
        actor: { type: 'agent', id: 'agt_studysourcecore' },
        source: { system: 'studysourcecore', interface: 'rest' },
        payload: {
          sourceChapterId: srcChap2,
          canonicalChapterId: testChapterId1,
          subjectId: testSubjectId,
          mappingType: 'direct',
          relevance: 'high',
          confidence: 0.98,
          notes: 'Comprehensive coverage of cell necrosis and apoptosis',
        },
      });

      await service.recordEvent({
        eventType: 'source_mapped',
        actor: { type: 'agent', id: 'agt_studysourcecore' },
        source: { system: 'studysourcecore', interface: 'rest' },
        payload: {
          sourceChapterId: srcChap3,
          canonicalChapterId: testChapterId2,
          subjectId: testSubjectId,
          mappingType: 'direct',
          relevance: 'high',
          confidence: 0.95,
          notes: 'Acute and chronic inflammation mediators',
        },
      });

      // 4. Mark Mapping Completed
      await service.recordEvent({
        eventType: 'source_mapping_completed',
        actor: { type: 'agent', id: 'agt_studysourcecore' },
        source: { system: 'studysourcecore', interface: 'rest' },
        payload: {
          sourceId,
        },
      });

      // 5. Verify State
      const sourceState = await service.getSourceState(sourceId);
      expect(sourceState.source.status).toBe('mapped');
      expect(sourceState.chapters.length).toBe(3);
      expect(sourceState.chapters[0].chapterNumber).toBe(1);
      expect(sourceState.chapters[1].chapterNumber).toBe(2);
      expect(sourceState.mappings.length).toBe(2);
      expect(sourceState.mappings[0].canonicalChapterName).toBe('Cellular Injury and Adaptation');
      expect(sourceState.mappings[1].canonicalChapterName).toBe('Inflammation and Repair');
    });
  });

  describe('REST Endpoints for Sources', () => {
    it('supports POST /v1/sources/register, /sources/chapters, /sources/mappings and GET /v1/state/sources', async () => {
      const sourceId = 'src_rest_pathology';

      // 1. Register Source
      const regRes = await app.request('/v1/sources/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${writeToken}`,
        },
        body: JSON.stringify({
          sourceId,
          title: 'Pathoma: Fundamentals of Pathology',
          sourceType: 'book',
          author: 'Dr. Husain A. Sattar',
          edition: '2021 Edition',
        }),
      }, makeEnv());

      expect(regRes.status).toBe(201);

      // 2. Create Chapter
      const chapRes = await app.request('/v1/sources/chapters', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${writeToken}`,
        },
        body: JSON.stringify({
          sourceChapterId: 'srcchap_pathoma_ch01',
          sourceId,
          title: 'Growth Adaptations, Cellular Injury, and Cell Death',
          chapterNumber: 1,
        }),
      }, makeEnv());

      expect(chapRes.status).toBe(201);

      // 3. Map Chapter
      const mapRes = await app.request('/v1/sources/mappings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${writeToken}`,
        },
        body: JSON.stringify({
          sourceChapterId: 'srcchap_pathoma_ch01',
          canonicalChapterId: testChapterId1,
          subjectId: testSubjectId,
          mappingType: 'direct',
          relevance: 'high',
        }),
      }, makeEnv());

      expect(mapRes.status).toBe(201);

      // 4. Query Sources List
      const listRes = await app.request('/v1/state/sources', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${readToken}`,
        },
      }, makeEnv());

      expect(listRes.status).toBe(200);
      const listJson: any = await listRes.json();
      expect(listJson.data.sources.length).toBeGreaterThanOrEqual(1);

      // 5. Query Specific Source State
      const stateRes = await app.request(`/v1/state/sources/${sourceId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${readToken}`,
        },
      }, makeEnv());

      expect(stateRes.status).toBe(200);
      const stateJson: any = await stateRes.json();
      expect(stateJson.data.source.title).toBe('Pathoma: Fundamentals of Pathology');
      expect(stateJson.data.chapters.length).toBe(1);
      expect(stateJson.data.mappings.length).toBe(1);
    });
  });

  describe('MCP Tools for StudySourceCore', () => {
    it('registers source and records source mapping via MCP protocol', async () => {
      const sourceId = 'src_mcp_atlas';

      // 1. Register Source via MCP
      const writeRes1 = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${writeToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'mcp_src_1',
          method: 'tools/call',
          params: {
            name: 'register_source',
            arguments: {
              sourceId,
              title: 'Netter Atlas of Human Anatomy',
              sourceType: 'book',
              author: 'Frank H. Netter',
              edition: '8th Edition',
            },
          },
        }),
      }, makeEnv());

      expect(writeRes1.status).toBe(200);
      const writeJson1: any = await writeRes1.json();
      expect(writeJson1.result.isError).toBeFalsy();

      // Seed a chapter for mapping
      await service.recordEvent({
        eventType: 'source_chapter_created',
        actor: { type: 'agent', id: 'agt_studysourcecore' },
        source: { system: 'studysourcecore', interface: 'mcp' },
        payload: {
          sourceChapterId: 'srcchap_netter_section1',
          sourceId,
          title: 'Section 1: Head and Neck',
          chapterNumber: 1,
        },
      });

      // 2. Record Mapping via MCP
      const writeRes2 = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${writeToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'mcp_src_2',
          method: 'tools/call',
          params: {
            name: 'record_source_mapping',
            arguments: {
              sourceChapterId: 'srcchap_netter_section1',
              canonicalChapterId: testChapterId1,
              mappingType: 'direct',
              relevance: 'high',
              confidence: 0.9,
            },
          },
        }),
      }, makeEnv());

      expect(writeRes2.status).toBe(200);
      const writeJson2: any = await writeRes2.json();
      expect(writeJson2.result.isError).toBeFalsy();

      // 3. Read Source State via MCP
      const readRes = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${readToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'mcp_src_3',
          method: 'tools/call',
          params: {
            name: 'get_source_state',
            arguments: { sourceId },
          },
        }),
      }, makeEnv());

      expect(readRes.status).toBe(200);
      const readJson: any = await readRes.json();
      expect(readJson.result.isError).toBeFalsy();
      const readData = JSON.parse(readJson.result.content[0].text);
      expect(readData.source.title).toBe('Netter Atlas of Human Anatomy');
      expect(readData.chapters.length).toBe(1);
      expect(readData.mappings.length).toBe(1);
    });
  });
});
