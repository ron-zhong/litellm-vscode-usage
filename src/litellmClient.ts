import * as https from 'https';
import * as http from 'http';

const DEFAULT_TIMEOUT_MS = 15000;
const RETRY_BACKOFF_MS = [1000, 2000];

export interface UserBudgetInfo {
  userId: string;
  maxBudget: number | null;
  spend: number;
  budgetDuration: string | null;
  budgetResetAt: string | null;
}

export interface KeyInfo {
  key: string;
  spend: number;
  tpm_limit: number;
  rpm_limit: number;
  maxBudget: number | null;
  budgetDuration: string | null;
  budgetResetAt: string | null;
  key_alias: string | null;
  models: string[];
}

export interface UserInfo {
  userId: string;
  userInfo: UserBudgetInfo | null;
  keys: KeyInfo[];
}

export interface SpendLogEntry {
  requestId: string;
  callType: string;
  model: string;
  spend: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  startTime: string;
  endTime: string;
  userId: string | null;
}

export interface DailySpend {
  date: string;
  spend: number;
  tokens: number;
}

export interface ModelSpend {
  model: string;
  spend: number;
  tokens: number;
  requests: number;
}

export interface UsageSummary {
  dailySpend: DailySpend[];
  modelBreakdown: ModelSpend[];
  totalMonthlySpend: number;
  totalDailySpend: number;
}

export interface BudgetInfo {
  spend: number;
  maxBudget: number | null;
  budgetResetAt: string | null;
  keyAlias: string | null;
  source: '/v2/user/info' | '/key/info';
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

/** Fetch current user information including budget and spend. */
export async function fetchUserInfo(apiBase: string, apiKey: string): Promise<UserInfo> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await httpGet<any>(apiBase, apiKey, '/user/info');

  const userBudget: UserBudgetInfo | null = raw.user_info
    ? {
        userId: raw.user_info.user_id ?? '',
        maxBudget: raw.user_info.max_budget ?? null,
        spend: raw.user_info.spend ?? 0,
        budgetDuration: raw.user_info.budget_duration ?? null,
        budgetResetAt: raw.user_info.budget_reset_at ?? null,
      }
    : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const keys: KeyInfo[] = (raw.keys ?? []).map((k: any) => ({
    key: k.token ?? k.key ?? '',
    tpm_limit: k.tpm_limit ?? 0,
    rpm_limit: k.rpm_limit ?? 0,
    maxBudget: k.max_budget ?? null,
    spend: k.spend ?? 0,
    budgetDuration: k.budget_duration ?? null,
    budgetResetAt: k.budget_reset_at ?? null,
    key_alias: k.key_alias ?? null,
    models: k.models ?? [],
  }));

  return {
    userId: raw.user_id ?? '',
    userInfo: userBudget,
    keys,
  };
}

/** Fetch spend logs between two dates (YYYY-MM-DD). */
export async function fetchSpendLogs(
  apiBase: string,
  apiKey: string,
  startDate: string,
  endDate: string
): Promise<SpendLogEntry[]> {
  const path = `/spend/logs?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}&summarize=false`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await httpGet<any[]>(apiBase, apiKey, path);

  if (!Array.isArray(raw)) {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return raw.map((entry: any) => ({
    requestId: entry.request_id ?? '',
    callType: entry.call_type ?? '',
    model: entry.model ?? '',
    spend: entry.spend ?? 0,
    totalTokens: entry.total_tokens ?? 0,
    promptTokens: entry.prompt_tokens ?? 0,
    completionTokens: entry.completion_tokens ?? 0,
    startTime: entry.startTime ?? entry.start_time ?? '',
    endTime: entry.endTime ?? entry.end_time ?? '',
    userId: entry.user ?? null,
  }));
}

/** Fetch user budget from /v2/user/info first, fallback to /key/info for compatibility. */
export async function fetchBudgetInfo(apiBase: string, apiKey: string): Promise<BudgetInfo> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await httpGet<any>(apiBase, apiKey, '/v2/user/info');
    return {
      spend: raw.spend ?? 0,
      maxBudget: raw.max_budget ?? null,
      budgetResetAt: raw.budget_reset_at ?? null,
      keyAlias: null,
      source: '/v2/user/info',
    };
  } catch {
    // Fallback for deployments where v2 endpoint is unavailable/disabled.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await httpGet<any>(apiBase, apiKey, '/key/info');
    return {
      spend: raw.spend ?? 0,
      maxBudget: raw.max_budget ?? null,
      budgetResetAt: raw.budget_reset_at ?? null,
      keyAlias: raw.key_alias ?? null,
      source: '/key/info',
    };
  }
}

/** Aggregate spend logs into daily and model-level summaries. */
export function aggregateUsage(logs: SpendLogEntry[]): UsageSummary {
  const dailyMap = new Map<string, { spend: number; tokens: number }>();
  const modelMap = new Map<string, { spend: number; tokens: number; requests: number }>();

  for (const log of logs) {
    const date = (log.startTime || '').slice(0, 10);
    if (date) {
      const existing = dailyMap.get(date) ?? { spend: 0, tokens: 0 };
      dailyMap.set(date, {
        spend: existing.spend + log.spend,
        tokens: existing.tokens + log.totalTokens,
      });
    }

    const model = log.model || 'unknown';
    const existingModel = modelMap.get(model) ?? { spend: 0, tokens: 0, requests: 0 };
    modelMap.set(model, {
      spend: existingModel.spend + log.spend,
      tokens: existingModel.tokens + log.totalTokens,
      requests: existingModel.requests + 1,
    });
  }

  const dailySpend: DailySpend[] = Array.from(dailyMap.entries())
    .map(([date, v]) => ({ date, spend: v.spend, tokens: v.tokens }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const modelBreakdown: ModelSpend[] = Array.from(modelMap.entries())
    .map(([model, v]) => ({ model, spend: v.spend, tokens: v.tokens, requests: v.requests }))
    .sort((a, b) => b.spend - a.spend);

  const today = new Date().toISOString().slice(0, 10);
  const totalDailySpend = dailyMap.get(today)?.spend ?? 0;
  const totalMonthlySpend = dailySpend.reduce((sum, d) => sum + d.spend, 0);

  return { dailySpend, modelBreakdown, totalMonthlySpend, totalDailySpend };
}

/** Return today's date string (YYYY-MM-DD). */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Return the first day of the current month (YYYY-MM-DD). */
export function startOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
