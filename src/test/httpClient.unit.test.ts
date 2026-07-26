/**
 * Unit tests for fetchBudgetInfo (the single /v2/user/info data source).
 *
 * All tests use a real local HTTP server to avoid mocking libraries.
 * No live LiteLLM proxy is required.
 */
import * as assert from 'assert';
import * as http from 'http';
import * as net from 'net';
import { fetchBudgetInfo, LiteLLMHttpError } from '../litellmClient';

// ─── Mock-server helpers ──────────────────────────────────────────────────────

interface MockServer {
  apiBase: string;
  close(): Promise<void>;
  /** Captured request paths. */
  paths: string[];
  /** Captured request headers. */
  headers: http.IncomingHttpHeaders[];
}

type HandlerFn = (req: http.IncomingMessage, res: http.ServerResponse) => void;

function startMockServer(handler: HandlerFn): Promise<MockServer> {
  const paths: string[] = [];
  const headers: http.IncomingHttpHeaders[] = [];

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      headers.push({ ...req.headers });
      paths.push(req.url ?? '');
      handler(req, res);
    });

    server.listen(0, 'localhost', () => {
      const { port } = server.address() as net.AddressInfo;
      const close = (): Promise<void> =>
        new Promise((res, rej) => server.close((e) => (e ? rej(e) : res())));
      resolve({ apiBase: `http://localhost:${port}`, close, paths, headers });
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

// ─── fetchBudgetInfo ──────────────────────────────────────────────────────────

describe('fetchBudgetInfo', () => {
  it('parses a full /v2/user/info response correctly', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 200, {
        user_id: 'u-1',
        spend: 12.5,
        max_budget: 50,
        budget_duration: '30d',
        budget_reset_at: '2025-02-01T00:00:00Z',
        user_alias: 'ron',
      });
    });
    try {
      const info = await fetchBudgetInfo(mock.apiBase, 'key');
      assert.strictEqual(info.spend, 12.5);
      assert.strictEqual(info.maxBudget, 50);
      assert.strictEqual(info.budgetDuration, '30d');
      assert.strictEqual(info.budgetResetAt, '2025-02-01T00:00:00Z');
      assert.strictEqual(info.userAlias, 'ron');
      assert.strictEqual(info.source, '/v2/user/info');
    } finally {
      await mock.close();
    }
  });

  it('defaults null/missing optional fields safely', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 200, { user_id: 'u-2', spend: 0 });
    });
    try {
      const info = await fetchBudgetInfo(mock.apiBase, 'key');
      assert.strictEqual(info.spend, 0);
      assert.strictEqual(info.maxBudget, null);
      assert.strictEqual(info.budgetDuration, null);
      assert.strictEqual(info.budgetResetAt, null);
      assert.strictEqual(info.userAlias, null);
    } finally {
      await mock.close();
    }
  });

  it('treats missing spend as 0', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 200, { user_id: 'u-3' });
    });
    try {
      const info = await fetchBudgetInfo(mock.apiBase, 'key');
      assert.strictEqual(info.spend, 0);
    } finally {
      await mock.close();
    }
  });

  it('sends a Bearer Authorization header when an API key is provided', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 200, { user_id: 'u-4', spend: 1 });
    });
    try {
      await fetchBudgetInfo(mock.apiBase, 'sk-secret');
      assert.ok(
        mock.headers.some((h) => h.authorization === 'Bearer sk-secret'),
        'expected Authorization: Bearer sk-secret'
      );
    } finally {
      await mock.close();
    }
  });

  it('hits exactly /v2/user/info and never /key/info', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 200, { user_id: 'u-5', spend: 1, max_budget: 10 });
    });
    try {
      await fetchBudgetInfo(mock.apiBase, 'key');
      assert.deepStrictEqual(mock.paths, ['/v2/user/info']);
      assert.ok(
        !mock.paths.some((p) => p.includes('/key/info')),
        'must NOT fall back to /key/info in v1.0.2'
      );
    } finally {
      await mock.close();
    }
  });

  it('throws LiteLLMHttpError on HTTP 403 (no fallback attempted)', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 403, { detail: 'Forbidden' });
    });
    try {
      await assert.rejects(
        () => fetchBudgetInfo(mock.apiBase, 'bad'),
        (err: unknown) => {
          assert.ok(err instanceof LiteLLMHttpError, 'should be LiteLLMHttpError');
          assert.strictEqual((err as LiteLLMHttpError).statusCode, 403);
          return true;
        }
      );
      // Only one request — no /key/info fallback.
      assert.deepStrictEqual(mock.paths, ['/v2/user/info']);
    } finally {
      await mock.close();
    }
  });

  it('retries transient 5xx then throws after exhausting retries', async function () {
    this.timeout(8000); // 1s + 2s backoff between attempts
    let calls = 0;
    const mock = await startMockServer((_req, res) => {
      calls += 1;
      jsonResponse(res, 500, { error: 'Internal Server Error' });
    });
    try {
      await assert.rejects(() => fetchBudgetInfo(mock.apiBase, 'key'), /HTTP 500/);
      assert.strictEqual(calls, 3, 'should attempt initial + 2 retries');
      // All retries target the same endpoint.
      assert.ok(mock.paths.every((p) => p === '/v2/user/info'));
    } finally {
      await mock.close();
    }
  });
});
