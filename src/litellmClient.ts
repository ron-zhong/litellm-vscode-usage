import * as https from 'https';
import * as http from 'http';

export interface UserBudgetInfo {
  userId: string;
  maxBudget: number | null;
  spend: number;
  budgetDuration: string | null;
  budgetResetAt: string | null;
}

export interface KeyInfo {
  key: string;
  maxBudget: number | null;
  spend: number;
  budgetDuration: string | null;
  budgetResetAt: string | null;
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

/** Perform an authenticated HTTP/HTTPS GET request and return the parsed JSON body. */
async function httpGet<T>(apiBase: string, apiKey: string, path: string): Promise<T> {
  const url = new URL(path.replace(/^\/+/, ''), apiBase.endsWith('/') ? apiBase : apiBase + '/');
  const lib = url.protocol === 'https:' ? https : http;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = 'Bearer ' + apiKey;
  }

  return new Promise<T>((resolve, reject) => {
    const req = lib.get(
      {
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
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            return;
          }
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            reject(new Error(`Failed to parse JSON response: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

/** A model entry returned by the LiteLLM /v1/models endpoint. */
export interface ModelInfo {
  id: string;
}

/**
 * Fetch the list of models available on the LiteLLM proxy.
 * Handles both the OpenAI-compatible `{ data: [...] }` envelope and bare arrays.
 */
export async function fetchAvailableModels(apiBase: string, apiKey: string): Promise<ModelInfo[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await httpGet<any>(apiBase, apiKey, '/v1/models');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any[] = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
  return data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((m: any) => ({ id: String(m.id ?? m.name ?? '') }))
    .filter((m) => m.id)
    .sort((a, b) => a.id.localeCompare(b.id));
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
    maxBudget: k.max_budget ?? null,
    spend: k.spend ?? 0,
    budgetDuration: k.budget_duration ?? null,
    budgetResetAt: k.budget_reset_at ?? null,
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
  const path = `/spend/logs?start_date=${startDate}&end_date=${endDate}`;
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
