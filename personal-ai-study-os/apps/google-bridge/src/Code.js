/**
 * Google Apps Script Bridge Web App — Production Implementation
 * Personal AI Study OS
 *
 * Responsibilities:
 * - Transport + Google Credential boundary ONLY.
 * - Authenticates incoming requests via body-based HMAC-SHA256 signature.
 * - Routes authorized operations to Google Calendar v3 and Google Tasks v1 Advanced Services.
 * - Normalizes application-level responses into standardized JSON envelope.
 * - Stateless: does NOT own state, leases, retries, queues, or business logic.
 */

const MAX_TIMESTAMP_SKEW_SECONDS = 300; // 5 minutes

/**
 * Deterministically serializes a JavaScript value into canonical JSON by sorting keys recursively.
 */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(value).filter(function (k) {
    return value[k] !== undefined;
  }).sort();
  const pairs = keys.map(function (k) {
    return JSON.stringify(k) + ':' + canonicalJson(value[k]);
  });
  return '{' + pairs.join(',') + '}';
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  var result = 0;
  for (var i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Computes HMAC-SHA256 signature over the canonical data string.
 */
function computeSignature(canonicalString, secret) {
  var signatureBytes = Utilities.computeHmacSha256Signature(canonicalString, secret);
  var hex = '';
  for (var i = 0; i < signatureBytes.length; i++) {
    var byteVal = signatureBytes[i] < 0 ? signatureBytes[i] + 256 : signatureBytes[i];
    hex += byteVal.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Builds standard JSON response output.
 */
function createJsonResponse(envelope) {
  return ContentService.createTextOutput(JSON.stringify(envelope)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/**
 * Main Web App POST handler.
 */
function doPost(e) {
  var requestId = 'req_unknown';
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({
        ok: false,
        statusCode: 400,
        error: { code: 'BAD_REQUEST', message: 'Missing request body' },
        request_id: requestId,
      });
    }

    var envelope;
    try {
      envelope = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return createJsonResponse({
        ok: false,
        statusCode: 400,
        error: { code: 'INVALID_JSON', message: 'Malformed JSON payload' },
        request_id: requestId,
      });
    }

    requestId = envelope.request_id || requestId;

    // Validate required envelope fields
    if (
      envelope.version !== '1' ||
      typeof envelope.timestamp !== 'number' ||
      !envelope.operation ||
      !envelope.signature ||
      typeof envelope.payload !== 'object'
    ) {
      return createJsonResponse({
        ok: false,
        statusCode: 400,
        error: { code: 'INVALID_ENVELOPE', message: 'Invalid or missing required envelope fields' },
        request_id: requestId,
      });
    }

    // Timestamp skew validation
    var nowSeconds = Math.floor(new Date().getTime() / 1000);
    if (Math.abs(nowSeconds - envelope.timestamp) > MAX_TIMESTAMP_SKEW_SECONDS) {
      return createJsonResponse({
        ok: false,
        statusCode: 401,
        error: { code: 'EXPIRED_TIMESTAMP', message: 'Request timestamp is outside allowed drift window' },
        request_id: requestId,
      });
    }

    // Load secret from Script Properties
    var secret = PropertiesService.getScriptProperties().getProperty('BRIDGE_SECRET');
    if (!secret) {
      console.error('BRIDGE_SECRET is not configured in Script Properties');
      return createJsonResponse({
        ok: false,
        statusCode: 500,
        error: { code: 'CONFIG_ERROR', message: 'Bridge secret is not configured' },
        request_id: requestId,
      });
    }

    // HMAC verification
    var canonicalString =
      'v1:' +
      envelope.timestamp +
      ':' +
      envelope.request_id +
      ':' +
      envelope.operation +
      ':' +
      canonicalJson(envelope.payload);

    var expectedSignature = computeSignature(canonicalString, secret);
    if (!timingSafeEqual(expectedSignature, envelope.signature)) {
      return createJsonResponse({
        ok: false,
        statusCode: 401,
        error: { code: 'INVALID_SIGNATURE', message: 'HMAC signature verification failed' },
        request_id: requestId,
      });
    }

    // Operation routing
    var result = dispatchOperation(envelope.operation, envelope.payload);
    result.request_id = requestId;
    return createJsonResponse(result);
  } catch (globalErr) {
    console.error('Unhandled bridge exception: ' + (globalErr.message || globalErr));
    return createJsonResponse({
      ok: false,
      statusCode: 500,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An internal error occurred in Google Apps Script bridge',
      },
      request_id: requestId,
    });
  }
}

/**
 * Dispatches verified operation to Google Advanced Services.
 */
function dispatchOperation(operation, payload) {
  switch (operation) {
    // ------------------------------------------------------------------------
    // Calendar Operations
    // ------------------------------------------------------------------------
    case 'calendar.get':
      return handleCalendarGet(payload);

    case 'calendar.create':
      return handleCalendarCreate(payload);

    case 'calendar.update':
      return handleCalendarUpdate(payload);

    case 'calendar.delete':
      return handleCalendarDelete(payload);

    // ------------------------------------------------------------------------
    // Tasks Operations
    // ------------------------------------------------------------------------
    case 'tasks.list':
      return handleTasksList(payload);

    case 'tasks.get':
      return handleTasksGet(payload);

    case 'tasks.create':
      return handleTasksCreate(payload);

    case 'tasks.update':
      return handleTasksUpdate(payload);

    case 'tasks.delete':
      return handleTasksDelete(payload);

    default:
      return {
        ok: false,
        statusCode: 400,
        error: {
          code: 'UNSUPPORTED_OPERATION',
          message: "Operation '" + operation + "' is not supported",
        },
      };
  }
}

// ============================================================================
// Google Calendar Handlers
// ============================================================================

function handleCalendarGet(payload) {
  if (!payload.calendarId || !payload.eventId) {
    return {
      ok: false,
      statusCode: 400,
      error: { code: 'INVALID_PARAMS', message: 'calendarId and eventId are required' },
    };
  }

  try {
    var event = Calendar.Events.get(payload.calendarId, payload.eventId);
    return {
      ok: true,
      statusCode: 200,
      data: event,
    };
  } catch (err) {
    var msg = String(err.message || err);
    if (msg.indexOf('Not Found') !== -1 || msg.indexOf('404') !== -1) {
      return {
        ok: true,
        statusCode: 404,
      };
    }
    return normalizeGoogleError(err);
  }
}

function handleCalendarCreate(payload) {
  if (!payload.calendarId || !payload.event || !payload.event.id) {
    return {
      ok: false,
      statusCode: 400,
      error: { code: 'INVALID_PARAMS', message: 'calendarId and event with deterministic id are required' },
    };
  }

  try {
    var created = Calendar.Events.insert(payload.event, payload.calendarId);
    return {
      ok: true,
      statusCode: 200,
      data: created,
    };
  } catch (err) {
    var msg = String(err.message || err);
    // Duplicate event ID conflict -> 409
    if (msg.indexOf('already exists') !== -1 || msg.indexOf('409') !== -1) {
      try {
        var existing = Calendar.Events.get(payload.calendarId, payload.event.id);
        return {
          ok: true,
          statusCode: 409,
          data: existing,
        };
      } catch (getErr) {
        return {
          ok: false,
          statusCode: 409,
          error: { code: 'CONFLICT', message: 'Event ID already exists but could not be fetched' },
        };
      }
    }
    return normalizeGoogleError(err);
  }
}

function handleCalendarUpdate(payload) {
  if (!payload.calendarId || !payload.eventId || !payload.event) {
    return {
      ok: false,
      statusCode: 400,
      error: { code: 'INVALID_PARAMS', message: 'calendarId, eventId, and event are required' },
    };
  }

  try {
    // If an ETag is provided, enforce optimistic concurrency check
    if (payload.etag) {
      var current = Calendar.Events.get(payload.calendarId, payload.eventId);
      var normalizedCurrentEtag = current.etag ? current.etag.replace(/"/g, '') : '';
      var normalizedTargetEtag = payload.etag.replace(/"/g, '');
      if (normalizedCurrentEtag && normalizedCurrentEtag !== normalizedTargetEtag) {
        return {
          ok: false,
          statusCode: 412,
          error: { code: 'PRECONDITION_FAILED', message: 'ETag precondition failed' },
        };
      }
    }

    var updated = Calendar.Events.patch(payload.event, payload.calendarId, payload.eventId);
    return {
      ok: true,
      statusCode: 200,
      data: updated,
    };
  } catch (err) {
    var msg = String(err.message || err);
    if (msg.indexOf('412') !== -1 || msg.indexOf('Precondition Failed') !== -1) {
      return {
        ok: false,
        statusCode: 412,
        error: { code: 'PRECONDITION_FAILED', message: 'ETag precondition failed' },
      };
    }
    return normalizeGoogleError(err);
  }
}

function handleCalendarDelete(payload) {
  if (!payload.calendarId || !payload.eventId) {
    return {
      ok: false,
      statusCode: 400,
      error: { code: 'INVALID_PARAMS', message: 'calendarId and eventId are required' },
    };
  }

  try {
    Calendar.Events.remove(payload.calendarId, payload.eventId);
    return {
      ok: true,
      statusCode: 200,
      data: { deleted: true },
    };
  } catch (err) {
    var msg = String(err.message || err);
    if (msg.indexOf('Not Found') !== -1 || msg.indexOf('404') !== -1) {
      return {
        ok: true,
        statusCode: 404,
      };
    }
    return normalizeGoogleError(err);
  }
}

// ============================================================================
// Google Tasks Handlers
// ============================================================================

function handleTasksList(payload) {
  if (!payload.tasklistId) {
    return {
      ok: false,
      statusCode: 400,
      error: { code: 'INVALID_PARAMS', message: 'tasklistId is required' },
    };
  }

  var options = {};
  if (payload.updatedMin) options.updatedMin = payload.updatedMin;
  if (typeof payload.showCompleted === 'boolean') options.showCompleted = payload.showCompleted;
  if (typeof payload.showHidden === 'boolean') options.showHidden = payload.showHidden;
  if (typeof payload.showDeleted === 'boolean') options.showDeleted = payload.showDeleted;
  if (payload.maxResults) options.maxResults = payload.maxResults;
  if (payload.pageToken) options.pageToken = payload.pageToken;

  try {
    var list = Tasks.Tasks.list(payload.tasklistId, options);
    return {
      ok: true,
      statusCode: 200,
      data: {
        items: list.items || [],
        nextPageToken: list.nextPageToken || undefined,
      },
    };
  } catch (err) {
    return normalizeGoogleError(err);
  }
}

function handleTasksGet(payload) {
  if (!payload.tasklistId || !payload.taskId) {
    return {
      ok: false,
      statusCode: 400,
      error: { code: 'INVALID_PARAMS', message: 'tasklistId and taskId are required' },
    };
  }

  try {
    var task = Tasks.Tasks.get(payload.tasklistId, payload.taskId);
    return {
      ok: true,
      statusCode: 200,
      data: task,
    };
  } catch (err) {
    var msg = String(err.message || err);
    if (msg.indexOf('Not Found') !== -1 || msg.indexOf('404') !== -1) {
      return {
        ok: true,
        statusCode: 404,
      };
    }
    return normalizeGoogleError(err);
  }
}

function handleTasksCreate(payload) {
  if (!payload.tasklistId || !payload.task) {
    return {
      ok: false,
      statusCode: 400,
      error: { code: 'INVALID_PARAMS', message: 'tasklistId and task payload are required' },
    };
  }

  try {
    var created = Tasks.Tasks.insert(payload.task, payload.tasklistId);
    return {
      ok: true,
      statusCode: 200,
      data: created,
    };
  } catch (err) {
    return normalizeGoogleError(err);
  }
}

function handleTasksUpdate(payload) {
  if (!payload.tasklistId || !payload.taskId || !payload.task) {
    return {
      ok: false,
      statusCode: 400,
      error: { code: 'INVALID_PARAMS', message: 'tasklistId, taskId, and task payload are required' },
    };
  }

  try {
    var updated = Tasks.Tasks.patch(payload.task, payload.tasklistId, payload.taskId);
    return {
      ok: true,
      statusCode: 200,
      data: updated,
    };
  } catch (err) {
    return normalizeGoogleError(err);
  }
}

function handleTasksDelete(payload) {
  if (!payload.tasklistId || !payload.taskId) {
    return {
      ok: false,
      statusCode: 400,
      error: { code: 'INVALID_PARAMS', message: 'tasklistId and taskId are required' },
    };
  }

  try {
    Tasks.Tasks.remove(payload.tasklistId, payload.taskId);
    return {
      ok: true,
      statusCode: 200,
      data: { deleted: true },
    };
  } catch (err) {
    var msg = String(err.message || err);
    if (msg.indexOf('Not Found') !== -1 || msg.indexOf('404') !== -1) {
      return {
        ok: true,
        statusCode: 404,
      };
    }
    return normalizeGoogleError(err);
  }
}

// ============================================================================
// Error Normalization
// ============================================================================

function normalizeGoogleError(err) {
  var msg = String(err.message || err);
  var statusCode = 500;
  var errorCode = 'GOOGLE_API_ERROR';

  if (msg.indexOf('401') !== -1 || msg.indexOf('Invalid Credentials') !== -1) {
    statusCode = 401;
    errorCode = 'UNAUTHORIZED';
  } else if (msg.indexOf('403') !== -1 || msg.indexOf('Rate Limit') !== -1 || msg.indexOf('quotaExceeded') !== -1) {
    statusCode = 429;
    errorCode = 'RATE_LIMIT_EXCEEDED';
  } else if (msg.indexOf('404') !== -1 || msg.indexOf('Not Found') !== -1) {
    statusCode = 404;
    errorCode = 'NOT_FOUND';
  } else if (msg.indexOf('409') !== -1 || msg.indexOf('already exists') !== -1) {
    statusCode = 409;
    errorCode = 'CONFLICT';
  } else if (msg.indexOf('412') !== -1 || msg.indexOf('Precondition Failed') !== -1) {
    statusCode = 412;
    errorCode = 'PRECONDITION_FAILED';
  } else if (msg.indexOf('429') !== -1) {
    statusCode = 429;
    errorCode = 'TOO_MANY_REQUESTS';
  } else if (msg.indexOf('503') !== -1 || msg.indexOf('Backend Error') !== -1) {
    statusCode = 503;
    errorCode = 'SERVICE_UNAVAILABLE';
  }

  return {
    ok: false,
    statusCode: statusCode,
    error: {
      code: errorCode,
      message: 'Google API operation failed: ' + msg.substring(0, 200),
    },
  };
}
