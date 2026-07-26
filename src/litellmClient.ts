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
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt += 1) {
    try {
      return await requestJson<T>(options);
    } catch (error) {
      const canRetry = shouldRetry(error) && attempt < RETRY_BACKOFF_MS.length;
      if (!canRetry) {
        throw error;
      }
      await delay(RETRY_BACKOFF_MS[attempt]);
    }
  }

  throw new LiteLLMHttpError('Unexpected retry state');
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
