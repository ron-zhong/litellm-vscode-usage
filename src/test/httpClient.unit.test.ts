/**
 * Unit tests for HTTP-client functions in litellmClient.ts.
 *
 * All tests use a real local HTTP server to avoid any mocking libraries.
 * No live LiteLLM proxy is required.
 */
import * as assert from 'assert';
import * as http from 'http';
import * as net from 'net';
import {
  generateCommitMessageFromDiff,
  fetchUserInfo,
  fetchSpendLogs,
  fetchAvailableModels,
} from '../litellmClient';

// ─── Mock-server helpers ──────────────────────────────────────────────────────

interface MockServer {
  apiBase: string;
  close(): Promise<void>;
  /** Captured request bodies (JSON-parsed). */
  requests: unknown[];
  /** Captured request headers. */
  headers: http.IncomingHttpHeaders[];
}

type HandlerFn = (req: http.IncomingMessage, res: http.ServerResponse) => void;

function startMockServer(handler: HandlerFn): Promise<MockServer> {
  const requests: unknown[] = [];
  const headers: http.IncomingHttpHeaders[] = [];

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      headers.push({ ...req.headers });
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try { requests.push(JSON.parse(body)); } catch { requests.push(body); }
        handler(req, res);
      });
    });

    server.listen(0, 'localhost', () => {
      const { port } = server.address() as net.AddressInfo;
      const close = (): Promise<void> =>
        new Promise((res, rej) => server.close((e) => (e ? rej(e) : res())));
      resolve({ apiBase: `http://localhost:${port}`, close, requests, headers });
    });
    server.on('error', reject);
  });
}

function jsonResponse(
  res: http.ServerResponse,
  statusCode: number,
  body: unknown
): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(payload);
}

// ─── generateCommitMessageFromDiff ───────────────────────────────────────────

describe('generateCommitMessageFromDiff', () => {
  it('returns a trimmed commit message from a successful response', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 200, {
        choices: [{ message: { content: '  feat: add awesome feature  ' } }],
      });
    });
    try {
      const msg = await generateCommitMessageFromDiff(mock.apiBase, 'key', 'gpt-4o', 'diff');
      assert.strictEqual(msg, 'feat: add awesome feature');
    } finally {
      await mock.close();
    }
  });

  it('throws when the server returns an HTTP 4xx error', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 401, { error: 'Unauthorized' });
    });
    try {
      await assert.rejects(
        () => generateCommitMessageFromDiff(mock.apiBase, 'bad-key', 'gpt-4o', 'diff'),
        /HTTP 401/
      );
    } finally {
      await mock.close();
    }
  });

  it('throws when the response has no choices', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 200, { choices: [] });
    });
    try {
      await assert.rejects(
        () => generateCommitMessageFromDiff(mock.apiBase, 'key', 'gpt-4o', 'diff'),
        /No commit message/
      );
    } finally {
      await mock.close();
    }
  });

  it('throws when message content is an empty string', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 200, { choices: [{ message: { content: '   ' } }] });
    });
    try {
      await assert.rejects(
        () => generateCommitMessageFromDiff(mock.apiBase, 'key', 'gpt-4o', 'diff'),
        /No commit message/
      );
    } finally {
      await mock.close();
    }
  });

  it('truncates diffs longer than 12 000 characters', async () => {
    let capturedBody: { messages?: Array<{ role: string; content: string }> } = {};
    const mock = await startMockServer((_req, res) => {
      // Body is captured asynchronously via mock.requests; reply inline
      // We inspect mock.requests after the call
      jsonResponse(res, 200, { choices: [{ message: { content: 'chore: truncated' } }] });
    });
    try {
      const longDiff = 'x'.repeat(13000);
      await generateCommitMessageFromDiff(mock.apiBase, 'key', 'gpt-4o', longDiff);
      capturedBody = mock.requests[0] as typeof capturedBody;
      const userMessage = capturedBody.messages?.find((m) => m.role === 'user')?.content ?? '';
      assert.ok(
        userMessage.includes('[diff truncated…]'),
        'Request body should contain truncation marker'
      );
    } finally {
      await mock.close();
    }
  });

  it('sends an Authorization header when an API key is provided', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 200, { choices: [{ message: { content: 'fix: something' } }] });
    });
    try {
      await generateCommitMessageFromDiff(mock.apiBase, 'sk-test-key', 'gpt-4o', 'diff');
      assert.ok(mock.headers[0]?.authorization?.startsWith('Bearer '), 'Auth header should be present');
    } finally {
      await mock.close();
    }
  });

  it('omits the Authorization header when no API key is provided', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 200, { choices: [{ message: { content: 'docs: update readme' } }] });
    });
    try {
      await generateCommitMessageFromDiff(mock.apiBase, '', 'gpt-4o', 'diff');
      assert.strictEqual(mock.headers[0]?.authorization, undefined);
    } finally {
      await mock.close();
    }
  });
});

// ─── fetchUserInfo ────────────────────────────────────────────────────────────

describe('fetchUserInfo', () => {
  it('parses a full user_info and keys response correctly', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 200, {
        user_id: 'u-1',
        user_info: {
          user_id: 'u-1',
          max_budget: 50,
          spend: 12.5,
          budget_duration: 'monthly',
          budget_reset_at: '2025-02-01T00:00:00Z',
        },
        keys: [
          {
            token: 'tok-1',
            max_budget: 10,
            spend: 2.5,
            budget_duration: 'weekly',
            budget_reset_at: '2025-01-20T00:00:00Z',
            models: ['gpt-4o'],
          },
        ],
      });
    });
    try {
      const info = await fetchUserInfo(mock.apiBase, 'key');
      assert.strictEqual(info.userId, 'u-1');
      assert.strictEqual(info.userInfo?.maxBudget, 50);
      assert.strictEqual(info.userInfo?.spend, 12.5);
      assert.strictEqual(info.userInfo?.budgetDuration, 'monthly');
      assert.strictEqual(info.keys.length, 1);
      assert.strictEqual(info.keys[0].key, 'tok-1');
      assert.deepStrictEqual(info.keys[0].models, ['gpt-4o']);
    } finally {
      await mock.close();
    }
  });

  it('returns null userInfo when user_info is absent', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 200, { user_id: 'u-2', keys: [] });
    });
    try {
      const info = await fetchUserInfo(mock.apiBase, 'key');
      assert.strictEqual(info.userInfo, null);
      assert.deepStrictEqual(info.keys, []);
    } finally {
      await mock.close();
    }
  });

  it('throws on HTTP 403', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 403, { detail: 'Forbidden' });
    });
    try {
      await assert.rejects(() => fetchUserInfo(mock.apiBase, 'bad'), /HTTP 403/);
    } finally {
      await mock.close();
    }
  });
});

// ─── fetchSpendLogs ───────────────────────────────────────────────────────────

describe('fetchSpendLogs', () => {
  it('maps snake_case API fields to camelCase correctly', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 200, [
        {
          request_id: 'req-1',
          call_type: 'completion',
          model: 'gpt-4o',
          spend: 0.05,
          total_tokens: 500,
          prompt_tokens: 400,
          completion_tokens: 100,
          start_time: '2025-01-15T10:00:00Z',
          end_time: '2025-01-15T10:00:01Z',
          user: 'u-1',
        },
      ]);
    });
    try {
      const logs = await fetchSpendLogs(mock.apiBase, 'key', '2025-01-15', '2025-01-15');
      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0].requestId, 'req-1');
      assert.strictEqual(logs[0].model, 'gpt-4o');
      assert.strictEqual(logs[0].spend, 0.05);
      assert.strictEqual(logs[0].totalTokens, 500);
      assert.strictEqual(logs[0].startTime, '2025-01-15T10:00:00Z');
      assert.strictEqual(logs[0].userId, 'u-1');
    } finally {
      await mock.close();
    }
  });

  it('returns an empty array when the server returns a non-array', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 200, { message: 'no logs' });
    });
    try {
      const logs = await fetchSpendLogs(mock.apiBase, 'key', '2025-01-01', '2025-01-31');
      assert.deepStrictEqual(logs, []);
    } finally {
      await mock.close();
    }
  });

  it('throws on HTTP 500', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 500, { error: 'Internal Server Error' });
    });
    try {
      await assert.rejects(
        () => fetchSpendLogs(mock.apiBase, 'key', '2025-01-01', '2025-01-31'),
        /HTTP 500/
      );
    } finally {
      await mock.close();
    }
  });

  it('includes the date range in the request URL', async () => {
    let capturedPath = '';
    const mock = await startMockServer((req, res) => {
      capturedPath = req.url ?? '';
      jsonResponse(res, 200, []);
    });
    try {
      await fetchSpendLogs(mock.apiBase, 'key', '2025-01-10', '2025-01-20');
      assert.ok(capturedPath.includes('start_date=2025-01-10'), 'start_date missing');
      assert.ok(capturedPath.includes('end_date=2025-01-20'), 'end_date missing');
    } finally {
      await mock.close();
    }
  });
});

// ─── fetchAvailableModels ─────────────────────────────────────────────────────

describe('fetchAvailableModels', () => {
  it('returns sorted model IDs from an OpenAI-compatible response', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 200, {
        data: [
          { id: 'gpt-4o', object: 'model' },
          { id: 'claude-3-5-sonnet', object: 'model' },
          { id: 'mistral-large', object: 'model' },
        ],
      });
    });
    try {
      const models = await fetchAvailableModels(mock.apiBase, 'key');
      assert.deepStrictEqual(
        models.map((m) => m.id),
        ['claude-3-5-sonnet', 'gpt-4o', 'mistral-large']
      );
    } finally {
      await mock.close();
    }
  });

  it('handles a bare array response', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 200, [{ id: 'llama-3-70b' }, { id: 'gemma-2-9b' }]);
    });
    try {
      const models = await fetchAvailableModels(mock.apiBase, 'key');
      assert.deepStrictEqual(
        models.map((m) => m.id),
        ['gemma-2-9b', 'llama-3-70b']
      );
    } finally {
      await mock.close();
    }
  });

  it('returns an empty array when data is empty', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 200, { data: [] });
    });
    try {
      const models = await fetchAvailableModels(mock.apiBase, 'key');
      assert.deepStrictEqual(models, []);
    } finally {
      await mock.close();
    }
  });

  it('filters out entries with no id field', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 200, { data: [{ id: 'gpt-4o' }, { object: 'model' }] });
    });
    try {
      const models = await fetchAvailableModels(mock.apiBase, 'key');
      assert.strictEqual(models.length, 1);
      assert.strictEqual(models[0].id, 'gpt-4o');
    } finally {
      await mock.close();
    }
  });

  it('throws on HTTP error', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 401, { error: 'Unauthorized' });
    });
    try {
      await assert.rejects(() => fetchAvailableModels(mock.apiBase, 'bad'), /HTTP 401/);
    } finally {
      await mock.close();
    }
  });
});
