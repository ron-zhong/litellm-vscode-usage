import type { BudgetInfo } from './litellmClient';

/**
 * A small, VS-Code-independent throttle + single-flight controller around a
 * `fetcher` that returns `BudgetInfo`.
 *
 * Design goals (see versions/v1.0.2_PLAN.md §4–§5):
 * - **Cooldown:** once a fetch has settled, do not fetch again until at least
 *   `getIntervalMs()` has elapsed (unless `force: true`).
 * - **Single-flight:** concurrent callers share the same in-flight promise
 *   instead of issuing parallel requests.
 * - **Cache:** the last successful result is cached and returned to any caller
 *   that hits the cooldown, so UI surfaces (status bar, pop-up, dashboard) can
 *   render from cache without triggering extra API calls.
 *
 * The controller owns the cache; callers read it via `getCache()`. Callbacks
 * `onResult` / `onError` let the host react to fresh data (e.g. re-render).
 */
export interface RefreshControllerOptions {
  /** Effective cooldown / refresh interval, read live so config changes apply. */
  getIntervalMs: () => number;
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
  /** Produces fresh BudgetInfo. Should throw on failure. */
  fetcher: () => Promise<BudgetInfo>;
  /** Called after a successful fetch, with the new info. */
  onResult?: (info: BudgetInfo) => void;
  /** Called after a failed fetch. Cooldown is still advanced to prevent storms. */
  onError?: (err: unknown) => void;
}

export interface RefreshOptions {
  force?: boolean;
}

export interface RefreshController {
  /** Fetch (respecting cooldown) or return cached/single-flight result. */
  refresh(opts?: RefreshOptions): Promise<BudgetInfo | undefined>;
  /** Last successful BudgetInfo, or undefined if none yet. */
  getCache(): BudgetInfo | undefined;
  /** Drop the cached value (e.g. when the connection endpoint changes). */
  clearCache(): void;
  /** Allow the next `refresh()` to fire immediately (bypass cooldown). */
  resetCooldown(): void;
  /**
   * Milliseconds remaining before a non-forced refresh would actually fetch.
   * Returns 0 when the cooldown has elapsed or no fetch has happened yet.
   */
  msUntilNextRefresh(): number;
}

/**
 * Build a RefreshController. The returned object closes over mutable state and
 * is intended to be a process-wide singleton for the extension.
 */
export function makeRefreshController(opts: RefreshControllerOptions): RefreshController {
  const now = opts.now ?? (() => Date.now());
  let cache: BudgetInfo | undefined;
  let lastFetchAt = 0;
  let inFlight: Promise<BudgetInfo> | undefined;

  async function refresh({ force = false }: RefreshOptions = {}): Promise<BudgetInfo | undefined> {
    // Single-flight: share any in-flight request with concurrent callers.
    if (inFlight) {
      return inFlight;
    }

    const intervalMs = opts.getIntervalMs();
    if (!force && lastFetchAt > 0 && now() - lastFetchAt < intervalMs) {
      return cache;
    }

    const p = (async () => {
      try {
        const info = await opts.fetcher();
        cache = info;
        lastFetchAt = now();
        opts.onResult?.(info);
        return info;
      } catch (err) {
        // Advance the cooldown even on failure so transient outages don't
        // cause a retry storm on every UI interaction.
        lastFetchAt = now();
        opts.onError?.(err);
        throw err;
      } finally {
        inFlight = undefined;
      }
    })();

    inFlight = p;
    return p;
  }

  return {
    refresh,
    getCache: () => cache,
    clearCache: () => {
      cache = undefined;
    },
    resetCooldown: () => {
      lastFetchAt = 0;
    },
    msUntilNextRefresh: () => {
      if (lastFetchAt <= 0) {
        return 0;
      }
      const intervalMs = opts.getIntervalMs();
      const remaining = intervalMs - (now() - lastFetchAt);
      return remaining > 0 ? remaining : 0;
    },
  };
}
