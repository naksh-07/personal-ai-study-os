import { Hono, Context } from 'hono';
import { createKyselyD1 } from '@personal-os/db';
import { PersonalStateService } from '@personal-os/core';
import { requireAuth } from '../middleware/auth';
import { AppContext } from '../types';

export const stateRoutes = new Hono<AppContext>();

stateRoutes.use('/state/*', requireAuth('read'));
stateRoutes.use('/activity/*', requireAuth('read'));
stateRoutes.use('/work/*', requireAuth('read'));
stateRoutes.use('/schedule/*', requireAuth('read'));
stateRoutes.use('/memory/*', requireAuth('read'));
stateRoutes.use('/projects/*', requireAuth('read'));
stateRoutes.use('/sync/*', requireAuth('read'));
stateRoutes.use('/study/progress', requireAuth('read'));

function formatResponse(c: Context<AppContext>, data: unknown) {
  return c.json({
    data,
    meta: {
      requestId: c.get('requestId'),
      correlationId: c.get('correlationId'),
      generatedAt: new Date().toISOString(),
    },
  });
}

// 1. Today State
stateRoutes.get('/state/today', async (c) => {
  const date = c.req.query('date');
  const timezone = c.req.query('timezone');
  const service = new PersonalStateService(c.env.DB, createKyselyD1(c.env.DB));
  const state = await service.getTodayState({ date, timezone });
  return formatResponse(c, state);
});

// 2. Study State
stateRoutes.get('/state/study', async (c) => {
  const service = new PersonalStateService(c.env.DB, createKyselyD1(c.env.DB));
  const state = await service.getStudyState();
  return formatResponse(c, state);
});

stateRoutes.get('/study/progress', async (c) => {
  const service = new PersonalStateService(c.env.DB, createKyselyD1(c.env.DB));
  const state = await service.getStudyState();
  return formatResponse(c, state);
});

// 3. Subject State
stateRoutes.get('/state/subjects/:subjectId', async (c) => {
  const subjectId = c.req.param('subjectId');
  const service = new PersonalStateService(c.env.DB, createKyselyD1(c.env.DB));
  const state = await service.getSubjectState(subjectId);
  return formatResponse(c, state);
});

// 4. Chapter State
stateRoutes.get('/state/chapters/:chapterId', async (c) => {
  const chapterId = c.req.param('chapterId');
  const service = new PersonalStateService(c.env.DB, createKyselyD1(c.env.DB));
  const state = await service.getChapterState(chapterId);
  return formatResponse(c, state);
});

// 5. Recent Activity (Dual routes: /activity/recent and /state/activity)
const handleRecentActivity = async (c: Context<AppContext>) => {
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const subjectId = c.req.query('subjectId');
  const chapterId = c.req.query('chapterId');
  const eventType = c.req.query('eventType');
  const activityType = c.req.query('activityType');
  const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined;
  const offset = c.req.query('offset') ? Number(c.req.query('offset')) : undefined;

  const service = new PersonalStateService(c.env.DB, createKyselyD1(c.env.DB));
  const events = await service.getRecentActivity({
    startDate,
    endDate,
    subjectId,
    chapterId,
    eventType,
    activityType,
    limit,
    offset,
  });
  return formatResponse(c, events);
};

stateRoutes.get('/activity/recent', handleRecentActivity);
stateRoutes.get('/state/activity', handleRecentActivity);

// 6. Pending Work (Dual routes: /work/pending and /state/work)
const handlePendingWork = async (c: Context<AppContext>) => {
  const service = new PersonalStateService(c.env.DB, createKyselyD1(c.env.DB));
  const work = await service.getPendingWork();
  return formatResponse(c, work);
};

stateRoutes.get('/work/pending', handlePendingWork);
stateRoutes.get('/state/work', handlePendingWork);

// 7. Schedule Context (Dual routes: /schedule/context and /state/schedule)
const handleScheduleContext = async (c: Context<AppContext>) => {
  const date = c.req.query('date');
  const timezone = c.req.query('timezone');
  const currentTimestamp = c.req.query('currentTimestamp');
  const service = new PersonalStateService(c.env.DB, createKyselyD1(c.env.DB));
  const context = await service.getScheduleContext({ date, timezone, currentTimestamp });
  return formatResponse(c, context);
};

stateRoutes.get('/schedule/context', handleScheduleContext);
stateRoutes.get('/state/schedule', handleScheduleContext);

// 8. Memory Search
stateRoutes.get('/memory/search', async (c) => {
  const query = c.req.query('query') || c.req.query('q');
  const category = c.req.query('category');
  const includeHistorical = c.req.query('includeHistorical') === 'true';
  const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined;

  const service = new PersonalStateService(c.env.DB, createKyselyD1(c.env.DB));
  const result = await service.searchMemory({ query, category, includeHistorical, limit });
  return formatResponse(c, result);
});

// 9. Project State (Dual routes: /projects/:projectId and /state/projects/:projectId)
const handleProjectState = async (c: Context<AppContext>) => {
  const projectId = c.req.param('projectId')!;
  const service = new PersonalStateService(c.env.DB, createKyselyD1(c.env.DB));
  const state = await service.getProjectState(projectId);
  return formatResponse(c, state);
};

stateRoutes.get('/projects/:projectId', handleProjectState);
stateRoutes.get('/state/projects/:projectId', handleProjectState);

// 10. Sync Status
stateRoutes.get('/sync/status', async (c) => {
  const service = new PersonalStateService(c.env.DB, createKyselyD1(c.env.DB));
  const status = await service.getSyncStatus();
  return formatResponse(c, status);
});

// 11. Agent State (Dual routes: /agents/:runId and /state/agents/:runId)
const handleAgentState = async (c: Context<AppContext>) => {
  const runId = c.req.param('runId')!;
  const service = new PersonalStateService(c.env.DB, createKyselyD1(c.env.DB));
  const state = await service.getAgentState(runId);
  return formatResponse(c, state);
};

stateRoutes.get('/agents/:runId', handleAgentState);
stateRoutes.get('/state/agents/:runId', handleAgentState);

// 12. Sources List & State (Dual routes: /sources, /state/sources, /sources/:sourceId, /state/sources/:sourceId)
const handleSourcesList = async (c: Context<AppContext>) => {
  const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined;
  const service = new PersonalStateService(c.env.DB, createKyselyD1(c.env.DB));
  const sources = await service.listSources(limit);
  return formatResponse(c, { sources });
};

stateRoutes.get('/sources', handleSourcesList);
stateRoutes.get('/state/sources', handleSourcesList);

const handleSourceState = async (c: Context<AppContext>) => {
  const sourceId = c.req.param('sourceId')!;
  const service = new PersonalStateService(c.env.DB, createKyselyD1(c.env.DB));
  const state = await service.getSourceState(sourceId);
  return formatResponse(c, state);
};

stateRoutes.get('/sources/:sourceId', handleSourceState);
stateRoutes.get('/state/sources/:sourceId', handleSourceState);

