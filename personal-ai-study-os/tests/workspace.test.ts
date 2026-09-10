import { describe, it, expect } from 'vitest';
import workerApp from '@personal-os/worker';
import { createTestDatabase } from './test-helper';
import * as DomainModule from '@personal-os/domain';
import * as DbModule from '@personal-os/db';
import * as CoreModule from '@personal-os/core';

describe('Workspace & Worker Foundation', () => {
  it('exports required symbols from packages/domain', () => {
    expect(DomainModule.generateId).toBeDefined();
    expect(DomainModule.isValidId).toBeDefined();
    expect(DomainModule.CanonicalEventSchema).toBeDefined();
    expect(DomainModule.UserSchema).toBeDefined();
    expect(DomainModule.ChapterSchema).toBeDefined();
    expect(DomainModule.deriveAccuracy).toBeDefined();
  });

  it('exports required symbols from packages/db', () => {
    expect(DbModule.createKyselyD1).toBeDefined();
    expect(DbModule.executeD1Batch).toBeDefined();
    expect(DbModule.CanonicalEventsRepository).toBeDefined();
    expect(DbModule.ProjectionsRepository).toBeDefined();
    expect(DbModule.EntitiesRepository).toBeDefined();
  });

  it('exports required symbols from packages/core', () => {
    expect(CoreModule.CanonicalEventEngine).toBeDefined();
    expect(CoreModule.ProjectionEngine).toBeDefined();
    expect(CoreModule.AtomicWriter).toBeDefined();
  });

  it('worker application responds to /health endpoint', async () => {
    const { d1 } = createTestDatabase();
    const env = {
      DB: d1,
      SYNC_QUEUE: {},
      ENVIRONMENT: 'test',
    };

    const req = new Request('http://localhost/health');
    const res = await workerApp.fetch(req, env);
    expect(res.status).toBe(200);

    const json = await res.json() as any;
    expect(json.status).toBe('healthy');
    expect(json.environment).toBe('test');
  });

  it('worker application responds to /v1/status endpoint', async () => {
    const { d1 } = createTestDatabase();
    const env = {
      DB: d1,
      SYNC_QUEUE: {},
      ENVIRONMENT: 'test',
    };

    const req = new Request('http://localhost/v1/status');
    const res = await workerApp.fetch(req, env);
    expect(res.status).toBe(200);

    const json = await res.json() as any;
    expect(json.system).toBe('Personal AI Study OS');
    expect(json.version).toBe('1.2.3');
    expect(json.operatorConfigured).toBe(false);
    expect(json.eventsRecorded).toBe(0);
  });
});
