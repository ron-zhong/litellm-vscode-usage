import * as https from 'https';
import * as http from 'http';

const DEFAULT_TIMEOUT_MS = 15000;
const RETRY_BACKOFF_MS = [1000, 2000];

/**
 * Normalized budget information fetched from GET /v2/user/info.
 *
 * `spend` is the spend accumulated within the user's *current budget window*
 * (e.g. a rolling 30-day window when `budget_duration=30d`), NOT a calendar
 * month. Callers should label it accordingly and surface `budgetDuration` /
 * `budgetResetAt` so the window is never misread.
 */
export interface BudgetInfo {
  spend: number;
  maxBudget: number | null;
  budgetDuration: string | null;
  budgetResetAt: string | null;
  userAlias: string | null;
  source: '/v2/user/info';
}

export class LiteLLMHttpError extends Error {
  public readonly statusCode: number | null;
  public readonly isTimeout: boolean;
  public readonly isNetworkError: boolean;

  constructor(message: string, options?: { statusCode?: number | null; isTimeout?: boolean; isNetworkError?: boolean }) {
    super(message);
    this.name = 'LiteLLMHttpError';
    this.statusCode = options?.statusCode ?? null;
    this.isTimeout = options?.isTimeout ?? false;
    this.isNetworkError = options?.isNetworkError ?? false;
  }
}

interface RequestOptions {
  method: 'GET' | 'POST';
  apiBase: string;
  apiKey: string;
  path: string;
  body?: unknown;
}

/** Small helper for exponential retry backoff. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns true only for transient failures covered by requirement retry policy. */
function shouldRetry(error: unknown): boolean {
  if (!(error instanceof LiteLLMHttpError)) {
    return false;
  }
  if (error.isTimeout || error.isNetworkError) {
    return true;
  }
  return error.statusCode !== null && error.statusCode >= 500;
}

/** Perform an authenticated HTTP/HTTPS request and return parsed JSON body. */
async function requestJson<T>(options: RequestOptions): Promise<T> {
  const { method, apiBase, apiKey, path, body } = options;
  const url = new URL(path.replace(/^\/+/, ''), apiBase.endsWith('/') ? apiBase : apiBase + '/');
  const lib = url.protocol === 'https:' ? https : http;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = 'Bearer ' + apiKey;
  }

  const payload = body !== undefined ? JSON.stringify(body) : undefined;

  return new Promise<T>((resolve, reject) => {
    const req = lib.request(
      {
        method,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + (url.search || ''),
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          const status = res.statusCode ?? null;
          if (status !== null && status >= 400) {
            reject(new LiteLLMHttpError(`HTTP ${status}: ${data}`, { statusCode: status }));
            return;
          }
          if (!data) {
            resolve({} as T);
            return;
          }
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            reject(new LiteLLMHttpError(`Failed to parse JSON response: ${data}`));
          }
        });
      }
    );

    req.on('error', (err: NodeJS.ErrnoException) => {
      reject(
        new LiteLLMHttpError(err.message, {
          isNetworkError: true,
        })
      );
    });

    req.setTimeout(DEFAULT_TIMEOUT_MS, () => {
      req.destroy();
      reject(new LiteLLMHttpError('Request timed out', { isTimeout: true }));
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

/** Retry transient failures (5xx + timeout/network), max 2 retries with 1s/2s backoff. */
async function requestJsonWithRetry<T>(options: RequestOptions): Promise<T> {
  for (let attempt = 0; attempt < RETRY_BACKOFF_MS.length; attempt += 1) {
    try {
      return await requestJson<T>(options);
    } catch (error) {
      if (!shouldRetry(error)) {
        throw error;
      }
      await delay(RETRY_BACKOFF_MS[attempt]);
    }
  }

  return requestJson<T>(options);
}

/** Perform an authenticated HTTP/HTTPS GET request and return parsed JSON body. */
async function httpGet<T>(apiBase: string, apiKey: string, path: string): Promise<T> {
  return requestJsonWithRetry<T>({
    method: 'GET',
    apiBase,
    apiKey,
    path,
  });
}

/**
 * Fetch the current budget-window spend and limits from GET /v2/user/info.
 *
 * This is the single source of truth for the extension. The `/key/info`
 * fallback was removed in v1.0.2 per the requirement to use only
 * `/v2/user/info`; deployments must expose this endpoint.
 */
export async function fetchBudgetInfo(apiBase: string, apiKey: string): Promise<BudgetInfo> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await httpGet<any>(apiBase, apiKey, '/v2/user/info');
  return {
    spend: raw.spend ?? 0,
    maxBudget: raw.max_budget ?? null,
    budgetDuration: raw.budget_duration ?? null,
    budgetResetAt: raw.budget_reset_at ?? null,
    userAlias: raw.user_alias ?? null,
    source: '/v2/user/info',
  };
}

// ─── Dashboard month-to-date spend (GET /spend/logs?summarize=true) ───────────

/** One day's aggregated spend from the summarized /spend/logs response. */
export interface SummarizedDay {
  date: string; // YYYY-MM-DD
  spend: number;
  /** Per-model spend map, e.g. { "gpt-4o": 1.5, "claude-3": 0.3 }. */
  models: Record<string, number>;
}

/** One bar in the month-to-date dashboard chart. */
export interface DailyPoint {
  date: string; // YYYY-MM-DD
  spend: number;
  /** Per-model spend map, e.g. { "gpt-4o": 1.5, "claude-3": 0.3 }. */
  models: Record<string, number>;
}

/** Today's date as YYYY-MM-DD (UTC, matching the API's UTC date handling). */
export function todayUtcStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** First day of the current month as YYYY-MM-DD (UTC). */
export function monthStartStr(): string {
  return new Date().toISOString().slice(0, 8) + '01';
}

/** First day of the month containing `dateStr` as YYYY-MM-DD. */
export function monthStartOfStr(dateStr: string): string {
  return dateStr.slice(0, 8) + '01';
}

/** Date string (YYYY-MM-DD) for `n` days before today (UTC). */
export function daysAgoStr(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Add `n` days to a YYYY-MM-DD date string (UTC), returning YYYY-MM-DD. */
export function addDayStr(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Fetch daily aggregated spend for a date range via
 * `GET /spend/logs?start_date=…&end_date=…&summarize=true`.
 *
 * The summarized response is one object per day: `{"startTime":"YYYY-MM-DD",
 * "spend":<num>, "users":{...}, "models":{...}}`, zero-padded for missing days.
 * We keep `date` (normalized from `startTime` / `start_time`), `spend`, and
 * `models` (per-model spend map); extra keys are ignored. Used at most once per
 * user per calendar day (see extension.ts cache).
 */
export async function fetchSpendLogsSummarized(
  apiBase: string,
  apiKey: string,
  startDate: string,
  endDate: string
): Promise<SummarizedDay[]> {
  const path = `/spend/logs?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}&summarize=true`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await httpGet<any[]>(apiBase, apiKey, path);
  if (!Array.isArray(raw)) {
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return raw.map((row: any) => ({
    date: String(row.startTime ?? row.start_time ?? row.date ?? row.day ?? '').slice(0, 10),
    spend: Number(row.spend ?? 0),
    models: normalizeModels(row.models),
  }));
}

/** Coerce an unknown `models` field into Record<string, number>. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeModels(models: any): Record<string, number> {
  if (!models || typeof models !== 'object') {
    return {};
  }
  const result: Record<string, number> = {};
  for (const [key, val] of Object.entries(models)) {
    const n = Number(val);
    if (!isNaN(n) && n !== 0) {
      result[key] = n;
    }
  }
  return result;
}

/**
 * Build a fixed-length daily series for the inclusive range
 * `startDate` .. `endDate`, 0-filling any day with no data. Result is ordered
 * oldest → newest (left → right on the chart). Pure / unit-testable.
 *
 * Days outside the range are ignored. Multiple rows for the same date have
 * their spend summed and their per-model spends merged.
 */
export function buildDailySeries(
  days: SummarizedDay[],
  startDate: string,
  endDate: string
): DailyPoint[] {
  const spendByDate = new Map<string, number>();
  const modelsByDate = new Map<string, Record<string, number>>();
  for (const d of days) {
    if (!d.date) {
      continue;
    }
    spendByDate.set(d.date, (spendByDate.get(d.date) ?? 0) + d.spend);
    const existing = modelsByDate.get(d.date) ?? {};
    for (const [model, amt] of Object.entries(d.models)) {
      existing[model] = (existing[model] ?? 0) + amt;
    }
    modelsByDate.set(d.date, existing);
  }
  const series: DailyPoint[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    series.push({
      date: cursor,
      spend: spendByDate.get(cursor) ?? 0,
      models: modelsByDate.get(cursor) ?? {},
    });
    cursor = addDayStr(cursor, 1);
  }
  return series;
}
