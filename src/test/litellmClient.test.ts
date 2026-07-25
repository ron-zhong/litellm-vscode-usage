/**
 * Unit tests for litellmClient utility functions.
 * These tests do not require a live VS Code instance.
 */
import * as assert from 'assert';
import { aggregateUsage, startOfMonth, today, SpendLogEntry } from '../litellmClient';

function makeLog(overrides: Partial<SpendLogEntry> = {}): SpendLogEntry {
  return {
    requestId: 'req-1',
    callType: 'completion',
    model: 'gpt-4o',
    spend: 0.01,
    totalTokens: 500,
    promptTokens: 400,
    completionTokens: 100,
    startTime: '2025-01-15T10:00:00Z',
    endTime: '2025-01-15T10:00:01Z',
    userId: 'user-1',
    ...overrides,
  };
}

// ── aggregateUsage ─────────────────────────────────────────────────────────────

describe('aggregateUsage', () => {
  it('returns empty arrays when no logs are provided', () => {
    const result = aggregateUsage([]);
    assert.deepStrictEqual(result.dailySpend, []);
    assert.deepStrictEqual(result.modelBreakdown, []);
    assert.strictEqual(result.totalMonthlySpend, 0);
    assert.strictEqual(result.totalDailySpend, 0);
  });

  it('sums spend across multiple log entries for the same day', () => {
    const logs: SpendLogEntry[] = [
      makeLog({ spend: 0.01, totalTokens: 100, startTime: '2025-01-15T08:00:00Z' }),
      makeLog({ spend: 0.02, totalTokens: 200, startTime: '2025-01-15T09:00:00Z' }),
    ];
    const result = aggregateUsage(logs);
    assert.strictEqual(result.dailySpend.length, 1);
    assert.strictEqual(result.dailySpend[0].date, '2025-01-15');
    assert.ok(Math.abs(result.dailySpend[0].spend - 0.03) < 1e-9);
    assert.strictEqual(result.dailySpend[0].tokens, 300);
  });

  it('separates spend into different days', () => {
    const logs: SpendLogEntry[] = [
      makeLog({ spend: 0.01, startTime: '2025-01-14T08:00:00Z' }),
      makeLog({ spend: 0.02, startTime: '2025-01-15T09:00:00Z' }),
    ];
    const result = aggregateUsage(logs);
    assert.strictEqual(result.dailySpend.length, 2);
    assert.strictEqual(result.dailySpend[0].date, '2025-01-14');
    assert.strictEqual(result.dailySpend[1].date, '2025-01-15');
  });

  it('sorts daily spend in ascending date order', () => {
    const logs: SpendLogEntry[] = [
      makeLog({ startTime: '2025-01-20T00:00:00Z' }),
      makeLog({ startTime: '2025-01-10T00:00:00Z' }),
      makeLog({ startTime: '2025-01-15T00:00:00Z' }),
    ];
    const result = aggregateUsage(logs);
    const dates = result.dailySpend.map((d) => d.date);
    assert.deepStrictEqual(dates, ['2025-01-10', '2025-01-15', '2025-01-20']);
  });

  it('aggregates spend per model and counts requests', () => {
    const logs: SpendLogEntry[] = [
      makeLog({ model: 'gpt-4o', spend: 0.01, totalTokens: 100 }),
      makeLog({ model: 'gpt-4o', spend: 0.02, totalTokens: 200 }),
      makeLog({ model: 'claude-3-5-sonnet', spend: 0.05, totalTokens: 500 }),
    ];
    const result = aggregateUsage(logs);
    assert.strictEqual(result.modelBreakdown.length, 2);
    // modelBreakdown is sorted descending by spend
    assert.strictEqual(result.modelBreakdown[0].model, 'claude-3-5-sonnet');
    assert.strictEqual(result.modelBreakdown[0].requests, 1);
    assert.strictEqual(result.modelBreakdown[1].model, 'gpt-4o');
    assert.strictEqual(result.modelBreakdown[1].requests, 2);
    assert.ok(Math.abs(result.modelBreakdown[1].spend - 0.03) < 1e-9);
  });

  it('uses "unknown" as model name when model field is missing', () => {
    const logs: SpendLogEntry[] = [makeLog({ model: '' })];
    const result = aggregateUsage(logs);
    assert.strictEqual(result.modelBreakdown[0].model, 'unknown');
  });

  it('calculates totalMonthlySpend as sum of all daily spend', () => {
    const logs: SpendLogEntry[] = [
      makeLog({ spend: 0.10, startTime: '2025-01-10T00:00:00Z' }),
      makeLog({ spend: 0.20, startTime: '2025-01-11T00:00:00Z' }),
      makeLog({ spend: 0.30, startTime: '2025-01-12T00:00:00Z' }),
    ];
    const result = aggregateUsage(logs);
    assert.ok(Math.abs(result.totalMonthlySpend - 0.60) < 1e-9);
  });

  it('skips log entries with an empty startTime', () => {
    const logs: SpendLogEntry[] = [makeLog({ startTime: '' })];
    const result = aggregateUsage(logs);
    assert.strictEqual(result.dailySpend.length, 0);
    // model aggregation still works
    assert.strictEqual(result.modelBreakdown.length, 1);
  });
});

// ── date helpers ───────────────────────────────────────────────────────────────

describe('today', () => {
  it('returns a string in YYYY-MM-DD format', () => {
    const t = today();
    assert.match(t, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('matches the current date', () => {
    const t = today();
    const d = new Date();
    const expected = d.toISOString().slice(0, 10);
    assert.strictEqual(t, expected);
  });
});

describe('startOfMonth', () => {
  it('returns a string in YYYY-MM-DD format', () => {
    const s = startOfMonth();
    assert.match(s, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns the first day of the current month', () => {
    const s = startOfMonth();
    assert.match(s, /-01$/);
  });
});
