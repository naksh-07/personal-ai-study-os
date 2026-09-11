import { Hono } from 'hono';
import { AppContext, Env } from '../types';
import { verifyJwt, AudienceMismatchError, TokenClaims, decodeBase64UrlJson } from '../middleware/auth';
import { listMcpTools, executeMcpTool } from './server';

export const mcpRouter = new Hono<AppContext>();

export const MCP_ALLOWED_AUDIENCES = [
  'https://api.personal-os.com/mcp',
  'personal-ai-study-os',
  'personal-study-os-api',
];

function getOrigin(c: any): string {
  try {
    const url = new URL(c.req.url);
    return url.origin;
  } catch {
    return 'https://personal-ai-study-os-staging.riyasaksena502.workers.dev';
  }
}

function make401Response(c: any, message: string): Response {
  const origin = getOrigin(c);
  return c.json(
    {
      error: {
        code: 'UNAUTHORIZED',
        category: 'authorization',
        message,
      },
    },
    401,
    {
      'WWW-Authenticate': `Bearer realm="personal-ai-study-os", resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
      Link: `<${origin}/.well-known/oauth-protected-resource>; rel="oauth-protected-resource"`,
    }
  );
}

/**
 * Authenticates an incoming MCP request using OAuth 2.1 Bearer tokens.
 * Enforces mandatory audience check against MCP_ALLOWED_AUDIENCES.
 */
async function authenticateMcpRequest(
  c: any,
  env: Env
): Promise<{ success: boolean; claims?: TokenClaims; errorResponse?: Response }> {
  const authHeader = c.req.header('authorization') || c.req.header('Authorization');
  const queryToken = c.req.query('token');
  const tokenStr = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7).trim()
    : queryToken;

  if (!tokenStr && env?.SKIP_AUTH === 'true') {
    if (env?.ENVIRONMENT !== 'test') {
      return {
        success: false,
        errorResponse: make401Response(
          c,
          'Unauthorized: SKIP_AUTH is only permitted in test environment'
        ),
      };
    }
    return {
      success: true,
      claims: {
        sub: 'usr_operator',
        aud: 'https://api.personal-os.com/mcp',
        scopes: ['read', 'write', 'admin'],
      } as any,
    };
  }

  if (!tokenStr) {
    return {
      success: false,
      errorResponse: make401Response(
        c,
        'Unauthorized: Missing Bearer token in Authorization header'
      ),
    };
  }

  // Support mock tokens strictly in test environments (SEC-01)
  if (tokenStr.startsWith('mock-')) {
    if (env?.ENVIRONMENT !== 'test') {
      return {
        success: false,
        errorResponse: c.json(
          {
            error: {
              code: 'UNAUTHORIZED',
              category: 'authorization',
              message: 'Unauthorized: Mock tokens are only permitted in test environment',
            },
          },
          401
        ),
      };
    }
    const mockScope = tokenStr.includes('admin')
      ? 'admin'
      : tokenStr.includes('write')
      ? 'write'
      : 'read';
    return {
      success: true,
      claims: {
        sub: 'usr_operator',
        aud: 'https://api.personal-os.com/mcp',
        scope: mockScope,
        scp: [mockScope],
      },
    };
  }

  // Support test suite mock-signature tokens strictly in test environment
  const parts = tokenStr.split('.');
  if (env?.ENVIRONMENT === 'test' && parts.length === 3 && parts[2] === 'mock_signature') {
    const claims = decodeBase64UrlJson<TokenClaims>(parts[1]);
    if (claims) {
      const tokenAudiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      const hasValidAudience = tokenAudiences.some((aud) => MCP_ALLOWED_AUDIENCES.includes(aud));
      if (!hasValidAudience) {
        return {
          success: false,
          errorResponse: c.json(
            {
              error: {
                code: 'AUDIENCE_MISMATCH',
                category: 'authorization',
                message: `Forbidden: Token audience '${tokenAudiences.join(', ')}' is not authorized for Personal State Service (AUDIENCE_MISMATCH)`,
              },
            },
            403
          ),
        };
      }
      return { success: true, claims };
    }
  }


  try {
    const claims = await verifyJwt(tokenStr, env, MCP_ALLOWED_AUDIENCES);
    return { success: true, claims };
  } catch (err: any) {
    if (err instanceof AudienceMismatchError || err?.message?.includes('AUDIENCE_MISMATCH')) {
      return {
        success: false,
        errorResponse: c.json(
          {
            error: {
              code: 'AUDIENCE_MISMATCH',
              category: 'authorization',
              message: err.message || 'Forbidden: Token audience mismatch (AUDIENCE_MISMATCH)',
            },
          },
          403
        ),
      };
    }
    return {
      success: false,
      errorResponse: make401Response(
        c,
        err.message || 'Unauthorized'
      ),
    };
  }
}

/**
 * Handles JSON-RPC 2.0 message logic.
 */
async function processJsonRpcMessage(
  msg: any,
  userScopes: string[],
  env: Env,
  claims?: TokenClaims
): Promise<any> {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2026-07-28',
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo: {
          name: 'personal-ai-study-os',
          version: '1.2.3',
        },
      },
    };
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  if (method === 'notifications/initialized') {
    return null; // Notification, no response required
  }

  const isGeminiSpark =
    (claims as any)?.client_id === 'gemini-spark' ||
    (claims as any)?.client_id === 'gemini' ||
    claims?.sub === 'gemini-spark';

  if (method === 'tools/list') {
    let tools = listMcpTools();
    if (isGeminiSpark) {
      // Expose strictly get_study_state and record_schedule_decision (Section 6)
      tools = tools.filter(
        (t) => t.name === 'get_study_state' || t.name === 'record_schedule_decision'
      );
    }
    return {
      jsonrpc: '2.0',
      id,
      result: { tools },
    };
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const toolArgs = params?.arguments ?? {};

    if (
      isGeminiSpark &&
      toolName !== 'get_study_state' &&
      toolName !== 'record_schedule_decision'
    ) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32000,
          message: `Forbidden: Tool '${toolName}' is not permitted for Gemini Spark client. Allowed tools: get_study_state, record_schedule_decision`,
        },
      };
    }

    try {
      const toolResult = await executeMcpTool(toolName, toolArgs, userScopes, env);
      return {
        jsonrpc: '2.0',
        id,
        result: toolResult,
      };
    } catch (err: any) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32000,
          message: err.message || 'Tool execution failed',
        },
      };
    }
  }

  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32601,
      message: `Method '${method}' not found`,
    },
  };
}

// ============================================================================
// MCP 2026-07-28 Streamable HTTP (Primary Remote Transport)
// ============================================================================
mcpRouter.get('/mcp', async (c) => {
  const accept = c.req.header('accept') || c.req.header('Accept') || '';
  if (accept.includes('text/event-stream')) {
    const auth = await authenticateMcpRequest(c, c.env);
    if (!auth.success) {
      return auth.errorResponse!;
    }

    const sessionId = crypto.randomUUID();
    const endpointMessage = `event: endpoint\ndata: /mcp/messages?sessionId=${sessionId}\n\n`;

    return new Response(endpointMessage, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  // Non-SSE GET probe: check authentication
  const auth = await authenticateMcpRequest(c, c.env);
  if (!auth.success) {
    return auth.errorResponse!;
  }

  // Authenticated probe: return server info & capabilities
  return c.json({
    name: 'personal-ai-study-os',
    version: '1.2.3',
    protocolVersion: '2026-07-28',
    capabilities: {
      tools: {
        listChanged: false,
      },
    },
  });
});

mcpRouter.post('/mcp', async (c) => {
  const auth = await authenticateMcpRequest(c, c.env);
  if (!auth.success) {
    return auth.errorResponse!;
  }

  const scopes: string[] =
    auth.claims?.scp || (auth.claims?.scope ? auth.claims.scope.split(' ') : ['read']);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error: Invalid JSON' },
      },
      400
    );
  }

  const isBatch = Array.isArray(body);
  const requests = isBatch ? body : [body];
  const responses = [];

  for (const req of requests) {
    const resp = await processJsonRpcMessage(req, scopes, c.env, auth.claims);
    if (resp !== null) {
      responses.push(resp);
    }
  }

  const accept = c.req.header('accept') || c.req.header('Accept') || '';
  const finalResponse = isBatch ? responses : responses[0] ?? {};

  if (accept.includes('text/event-stream')) {
    // Streamable HTTP chunked SSE stream response
    const ssePayload = `event: message\ndata: ${JSON.stringify(finalResponse)}\n\n`;
    return new Response(ssePayload, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  return c.json(finalResponse, 200);
});

// ============================================================================
// Legacy SSE Fallback (GET /mcp/sse + POST /mcp/messages)
// ============================================================================
mcpRouter.get('/mcp/sse', async (c) => {
  const auth = await authenticateMcpRequest(c, c.env);
  if (!auth.success) {
    return auth.errorResponse!;
  }

  const sessionId = crypto.randomUUID();
  const endpointMessage = `event: endpoint\ndata: /mcp/messages?sessionId=${sessionId}\n\n`;

  return new Response(endpointMessage, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

mcpRouter.get('/sse', async (c) => {
  const auth = await authenticateMcpRequest(c, c.env);
  if (!auth.success) {
    return auth.errorResponse!;
  }

  const sessionId = crypto.randomUUID();
  const endpointMessage = `event: endpoint\ndata: /sse/messages?sessionId=${sessionId}\n\n`;

  return new Response(endpointMessage, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

mcpRouter.post('/mcp/messages', async (c) => {
  const auth = await authenticateMcpRequest(c, c.env);
  if (!auth.success) {
    return auth.errorResponse!;
  }

  const scopes: string[] =
    auth.claims?.scp || (auth.claims?.scope ? auth.claims.scope.split(' ') : ['read']);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      },
      400
    );
  }

  const response = await processJsonRpcMessage(body, scopes, c.env, auth.claims);
  return c.json(response ?? { jsonrpc: '2.0', result: 'ack' }, 200);
});

mcpRouter.post('/sse/messages', async (c) => {
  const auth = await authenticateMcpRequest(c, c.env);
  if (!auth.success) {
    return auth.errorResponse!;
  }

  const scopes: string[] =
    auth.claims?.scp || (auth.claims?.scope ? auth.claims.scope.split(' ') : ['read']);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      },
      400
    );
  }

  const response = await processJsonRpcMessage(body, scopes, c.env, auth.claims);
  return c.json(response ?? { jsonrpc: '2.0', result: 'ack' }, 200);
});

// CORS Preflight for MCP
mcpRouter.options('/mcp', (c) => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
    },
  });
});
