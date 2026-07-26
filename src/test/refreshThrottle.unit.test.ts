/**
 * Unit tests for the refresh controller (cooldown + single-flight + cache).
 *
 * These are pure logic tests with an injectable clock and a fake fetcher — no
 * VS Code, no network.
 */
import * as assert from 'assert';
import { makeRefreshController, RefreshController } from '../refreshController';
import { BudgetInfo } from '../litellmClient';

function makeInfo(spend: number, maxBudget: number | null = null): BudgetInfo {
  return {
    spend,
    maxBudget,
    budgetDuration: '30d',
    budgetResetAt: null,
    userAlias: null,
    source: '/v2/user/info',
  };
}

interface FakeClock {
  now: number;
  tick(ms: number): void;
}

function makeController(opts: {
  intervalMs: number;
  clock: FakeClock;
  fetcher: () => Promise<BudgetInfo>;
  onResult?: (i: BudgetInfo) => void;
  onError?: (e: unknown) => void;
}): RefreshController {
  return makeRefreshController({
    getIntervalMs: () => opts.intervalMs,
    now: () => opts.clock.now,
    fetcher: opts.fetcher,
    onResult: opts.onResult,
    onError: opts.onError,
  });
}

describe('RefreshController', () => {
  it('fires the fetcher on the first call and caches the result', async () => {
    const clock: FakeClock = { now: 1000, tick: (ms) => (clock.now += ms) };
    let calls = 0;
    const c = makeController({
      intervalMs: 60_000,
      clock,
      fetcher: async () => {
        calls += 1;
        return makeInfo(5);
      },
    });
    const info = await c.refresh();
    assert.strictEqual(calls, 1);
    assert.strictEqual(info?.spend, 5);
    assert.strictEqual(c.getCache()?.spend, 5);
  });

  it('returns cached data and does NOT fetch within the cooldown', async () => {
    const clock: FakeClock = { now: 1000, tick: (ms) => (clock.now += ms) };
    let calls = 0;
    const c = makeController({
      intervalMs: 60_000,
      clock,
      fetcher: async () => {
        calls += 1;
        return makeInfo(calls);
      },
    });
    await c.refresh(); // calls=1, spend=1
    const again = await c.refresh(); // within cooldown
    assert.strictEqual(calls, 1, 'should not fetch again within cooldown');
    assert.strictEqual(again?.spend, 1, 'should return cached value');
  });

  it('fires again after the cooldown elapses', async () => {
    const clock: FakeClock = { now: 1000, tick: (ms) => (clock.now += ms) };
    let calls = 0;
    const c = makeController({
      intervalMs: 60_000,
      clock,
      fetcher: async () => {
        calls += 1;
        return makeInfo(calls);
      },
    });
    await c.refresh();
    assert.strictEqual(calls, 1);
    clock.tick(60_000);
    const info = await c.refresh();
    assert.strictEqual(calls, 2, 'should fetch after cooldown elapses');
    assert.strictEqual(info?.spend, 2);
  });

  it('dedupes concurrent calls via single-flight (one fetch shared)', async () => {
    const clock: FakeClock = { now: 1000, tick: (ms) => (clock.now += ms) };
    let calls = 0;
    let resolveFetch!: (v: BudgetInfo) => void;
    const gate = new Promise<BudgetInfo>((r) => (resolveFetch = r));
    const c = makeController({
      intervalMs: 60_000,
      clock,
      fetcher: async () => {
        calls += 1;
        return gate;
      },
    });
    const a = c.refresh();
    const b = c.refresh();
    const d = c.refresh();
    assert.strictEqual(calls, 1, 'concurrent calls should share one fetch');
    resolveFetch(makeInfo(7));
    const [ra, rb, rd] = await Promise.all([a, b, d]);
    assert.strictEqual(ra?.spend, 7);
    assert.strictEqual(rb?.spend, 7);
    assert.strictEqual(rd?.spend, 7);
    assert.strictEqual(calls, 1);
  });

  it('force: true bypasses the cooldown', async () => {
    const clock: FakeClock = { now: 1000, tick: (ms) => (clock.now += ms) };
    let calls = 0;
    const c = makeController({
      intervalMs: 60_000,
      clock,
      fetcher: async () => {
        calls += 1;
        return makeInfo(calls);
      },
    });
    await c.refresh();
    assert.strictEqual(calls, 1);
    // Within cooldown but forced:
    const forced = await c.refresh({ force: true });
    assert.strictEqual(calls, 2, 'force should bypass cooldown');
    assert.strictEqual(forced?.spend, 2);
  });

  it('does not bypass cooldown for force when a fetch is already in-flight', async () => {
    const clock: FakeClock = { now: 1000, tick: (ms) => (clock.now += ms) };
    let calls = 0;
    let resolveFetch!: (v: BudgetInfo) => void;
    const gate = new Promise<BudgetInfo>((r) => (resolveFetch = r));
    const c = makeController({
      intervalMs: 60_000,
      clock,
      fetcher: async () => {
        calls += 1;
        return gate;
      },
    });
    const a = c.refresh();
    const b = c.refresh({ force: true }); // should share, not start a 2nd
    resolveFetch(makeInfo(3));
    await Promise.all([a, b]);
    assert.strictEqual(calls, 1);
  });

  it('advances cooldown on failure so transient errors do not retry-storm', async () => {
    const clock: FakeClock = { now: 1000, tick: (ms) => (clock.now += ms) };
    let calls = 0;
    const c = makeController({
      intervalMs: 60_000,
      clock,
      fetcher: async () => {
        calls += 1;
        throw new Error('boom');
      },
    });
    await assert.rejects(c.refresh(), /boom/);
    assert.strictEqual(calls, 1);
    // Within cooldown after a failure: no refetch, and no cache to return.
    const second = await c.refresh();
    assert.strictEqual(second, undefined, 'should return cached (undefined) without fetching');
    assert.strictEqual(calls, 1, 'cooldown should block immediate retry');
    // After cooldown elapses, it tries again and fails again.
    clock.tick(60_000);
    await assert.rejects(c.refresh(), /boom/);
    assert.strictEqual(calls, 2);
  });

  it('invokes onResult on success and onError on failure', async () => {
    const clock: FakeClock = { now: 1000, tick: (ms) => (clock.now += ms) };
    const results: number[] = [];
    const errors: string[] = [];
    let succeed = true;
    const c = makeController({
      intervalMs: 60_000,
      clock,
      fetcher: async () => {
        if (succeed) return makeInfo(11);
        throw new Error('fail');
      },
      onResult: (i) => results.push(i.spend),
      onError: (e) => errors.push((e as Error).message),
    });
    await c.refresh();
    assert.deepStrictEqual(results, [11]);
    assert.deepStrictEqual(errors, []);
    clock.tick(60_000);
    succeed = false;
    await assert.rejects(c.refresh(), /fail/);
    assert.deepStrictEqual(errors, ['fail']);
    assert.deepStrictEqual(results, [11], 'no new success result on failure');
  });

  it('resetCooldown() allows the next refresh to fire immediately', async () => {
    const clock: FakeClock = { now: 1000, tick: (ms) => (clock.now += ms) };
    let calls = 0;
    const c = makeController({
      intervalMs: 60_000,
      clock,
      fetcher: async () => {
        calls += 1;
        return makeInfo(calls);
      },
    });
    await c.refresh();
    assert.strictEqual(calls, 1);
    c.resetCooldown();
    const info = await c.refresh();
    assert.strictEqual(calls, 2, 'resetCooldown should allow immediate fetch');
    assert.strictEqual(info?.spend, 2);
  });

  it('clearCache() drops the cached value', async () => {
    const clock: FakeClock = { now: 1000, tick: (ms) => (clock.now += ms) };
    const c = makeController({
      intervalMs: 60_000,
      clock,
      fetcher: async () => makeInfo(9),
    });
    await c.refresh();
    assert.ok(c.getCache() !== undefined);
    c.clearCache();
    assert.strictEqual(c.getCache(), undefined);
    // Cooldown still active: refresh returns undefined (no cache, no fetch).
    const info = await c.refresh();
    assert.strictEqual(info, undefined);
  });

  it('msUntilNextRefresh reports remaining cooldown', async () => {
    const clock: FakeClock = { now: 1000, tick: (ms) => (clock.now += ms) };
    const c = makeController({
      intervalMs: 60_000,
      clock,
      fetcher: async () => makeInfo(1),
    });
    assert.strictEqual(c.msUntilNextRefresh(), 0, 'no fetch yet → 0');
    await c.refresh();
    assert.strictEqual(c.msUntilNextRefresh(), 60_000);
    clock.tick(20_000);
    assert.strictEqual(c.msUntilNextRefresh(), 40_000);
    clock.tick(40_000);
    assert.strictEqual(c.msUntilNextRefresh(), 0);
  });
});
