/**
 * Unit tests for the dashboard month-to-date spend path:
 *   - buildDailySeries (pure, injectable today)
 *   - fetchSpendLogsSummarized (via a local mock server)
 */
import * as assert from 'assert';
import * as http from 'http';
import * as net from 'net';
import {
  buildDailySeries,
  fetchSpendLogsSummarized,
  SummarizedDay,
  addDayStr,
  daysAgoStr,
  todayUtcStr,
  monthStartStr,
  LiteLLMHttpError,
} from '../litellmClient';

// ─── Mock-server helpers ──────────────────────────────────────────────────────

interface MockServer {
  apiBase: string;
  close(): Promise<void>;
  paths: string[];
}

function startMockServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<MockServer> {
  const paths: string[] = [];
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      paths.push(req.url ?? '');
      handler(req, res);
    });
    server.listen(0, 'localhost', () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({
        apiBase: `http://localhost:${port}`,
        close: () => new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))),
        paths,
      });
    });
    server.on('error', reject);
  });
}

function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

// ─── buildDailySeries ──────────────────────────────────────────────────────────

describe('buildDailySeries', () => {
  const today = '2026-07-26';
  const monthStart = '2026-07-01';
  const windowDays = 26; // July 1 .. July 26

  it('returns one zero entry per day in the range when no data is provided', () => {
    const series = buildDailySeries([], monthStart, today);
    assert.strictEqual(series.length, windowDays);
    assert.ok(series.every((d) => d.spend === 0));
    // oldest -> newest, starting on monthStart, ending on today
    assert.strictEqual(series[0].date, monthStart);
    assert.strictEqual(series[windowDays - 1].date, today);
  });

  it('maps spend to the matching day and 0-fills the rest', () => {
    const days: SummarizedDay[] = [
      { date: today, spend: 1.5, models: {} },
      { date: addDayStr(today, -1), spend: 0.25, models: {} },
    ];
    const series = buildDailySeries(days, monthStart, today);
    assert.strictEqual(series.length, windowDays);
    assert.strictEqual(series[windowDays - 1].spend, 1.5);
    assert.strictEqual(series[windowDays - 2].spend, 0.25);
    assert.strictEqual(series[0].spend, 0);
  });

  it('sums multiple rows for the same date and merges models', () => {
    const days: SummarizedDay[] = [
      { date: today, spend: 1, models: { 'gpt-4o': 0.6 } },
      { date: today, spend: 2, models: { 'gpt-4o': 0.4, 'claude-3': 1.0 } },
    ];
    const series = buildDailySeries(days, monthStart, today);
    assert.strictEqual(series[windowDays - 1].spend, 3);
    assert.deepStrictEqual(series[windowDays - 1].models, { 'gpt-4o': 1.0, 'claude-3': 1.0 });
  });

  it('ignores rows outside the range', () => {
    const days: SummarizedDay[] = [
      { date: '2026-06-30', spend: 99, models: {} }, // before monthStart
      { date: addDayStr(today, 1), spend: 99, models: {} }, // after today
      { date: today, spend: 5, models: {} },
    ];
    const series = buildDailySeries(days, monthStart, today);
    assert.strictEqual(series[windowDays - 1].spend, 5);
    assert.ok(series.every((d) => d.spend !== 99));
  });

  it('respects a custom range', () => {
    const start = '2026-07-20';
    const end = '2026-07-26';
    const series = buildDailySeries([], start, end);
    assert.strictEqual(series.length, 7);
    assert.strictEqual(series[0].date, start);
    assert.strictEqual(series[6].date, end);
  });
});

// ─── date helpers ──────────────────────────────────────────────────────────────

describe('date helpers', () => {
  it('addDayStr moves forward and backward by days', () => {
    assert.strictEqual(addDayStr('2026-07-26', 1), '2026-07-27');
    assert.strictEqual(addDayStr('2026-07-26', -29), '2026-06-27');
    assert.strictEqual(addDayStr('2026-01-01', -1), '2025-12-31'); // year rollover
  });

  it('daysAgoStr/todayUtcStr are YYYY-MM-DD', () => {
    assert.match(todayUtcStr(), /^\d{4}-\d{2}-\d{2}$/);
    assert.match(daysAgoStr(0), /^\d{4}-\d{2}-\d{2}$/);
    assert.strictEqual(daysAgoStr(0), todayUtcStr());
  });

  it('monthStartStr is the 1st of the current month', () => {
    const ms = monthStartStr();
    assert.match(ms, /^\d{4}-\d{2}-01$/);
    assert.strictEqual(ms.slice(0, 7), todayUtcStr().slice(0, 7));
  });
});

// ─── fetchSpendLogsSummarized ─────────────────────────────────────────────────

describe('fetchSpendLogsSummarized', () => {
  it('parses summarized rows, ignoring extra keys but keeping models', async () => {
    const mock = await startMockServer((_req, res) => {
      // Shape matches LiteLLM summarize=true: {startTime, spend, users, models}
      jsonResponse(res, 200, [
        { startTime: '2026-07-26', spend: 1.5, users: { u1: 1.5 }, models: { 'gpt-4o': 1.5 } },
        { startTime: '2026-07-25', spend: 0.25, users: {}, models: {} },
      ]);
    });
    try {
      const days = await fetchSpendLogsSummarized(mock.apiBase, 'key', '2026-06-27', '2026-07-27');
      assert.strictEqual(days.length, 2);
      assert.strictEqual(days[0].date, '2026-07-26');
      assert.strictEqual(days[0].spend, 1.5);
      assert.deepStrictEqual(days[0].models, { 'gpt-4o': 1.5 });
      assert.strictEqual(days[1].date, '2026-07-25');
      assert.strictEqual(days[1].spend, 0.25);
      assert.deepStrictEqual(days[1].models, {});
    } finally {
      await mock.close();
    }
  });

  it('tolerates startTime as an ISO datetime string', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 200, [{ startTime: '2026-07-26T10:00:00.000Z', spend: 2 }]);
    });
    try {
      const days = await fetchSpendLogsSummarized(mock.apiBase, 'key', '2026-07-01', '2026-07-27');
      assert.strictEqual(days[0].date, '2026-07-26');
      assert.strictEqual(days[0].spend, 2);
    } finally {
      await mock.close();
    }
  });

  it('sends start_date, end_date and summarize=true in the query', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 200, []);
    });
    try {
      await fetchSpendLogsSummarized(mock.apiBase, 'key', '2026-06-27', '2026-07-27');
      const path = mock.paths[0];
      assert.ok(path.includes('start_date=2026-06-27'), path);
      assert.ok(path.includes('end_date=2026-07-27'), path);
      assert.ok(path.includes('summarize=true'), path);
    } finally {
      await mock.close();
    }
  });

  it('returns [] for a non-array body', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 200, { message: 'no logs' });
    });
    try {
      const days = await fetchSpendLogsSummarized(mock.apiBase, 'key', '2026-07-01', '2026-07-27');
      assert.deepStrictEqual(days, []);
    } finally {
      await mock.close();
    }
  });

  it('defaults missing spend to 0', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 200, [{ startTime: '2026-07-26' }]);
    });
    try {
      const days = await fetchSpendLogsSummarized(mock.apiBase, 'key', '2026-07-01', '2026-07-27');
      assert.strictEqual(days[0].spend, 0);
    } finally {
      await mock.close();
    }
  });

  it('throws LiteLLMHttpError on HTTP 403', async () => {
    const mock = await startMockServer((_req, res) => {
      jsonResponse(res, 403, { detail: 'Forbidden' });
    });
    try {
      await assert.rejects(
        () => fetchSpendLogsSummarized(mock.apiBase, 'bad', '2026-07-01', '2026-07-27'),
        (err: unknown) => {
          assert.ok(err instanceof LiteLLMHttpError);
          assert.strictEqual((err as LiteLLMHttpError).statusCode, 403);
          return true;
        }
      );
    } finally {
      await mock.close();
    }
  });
});
