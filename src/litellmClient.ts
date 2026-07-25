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
  const url = new URL(path, apiBase);
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

/** Perform an authenticated HTTP/HTTPS POST request and return the parsed JSON body. */
async function httpPost<T>(apiBase: string, apiKey: string, path: string, body: unknown): Promise<T> {
  const url = new URL(path, apiBase);
  const lib = url.protocol === 'https:' ? https : http;
  const payload = JSON.stringify(body);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload).toString(),
  };
  if (apiKey) {
    headers['Authorization'] = 'Bearer ' + apiKey;
  }

  return new Promise<T>((resolve, reject) => {
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + (url.search || ''),
        method: 'POST',
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
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    req.write(payload);
    req.end();
  });
}

/** Maximum diff size (in characters) sent to the model to avoid exceeding context limits.
 *  12 000 chars covers typical diffs comfortably within common model context windows
 *  (e.g. ~3 000 tokens at ~4 chars/token) while leaving room for the system prompt. */
const MAX_DIFF_CHARS = 12000;

/**
 * Call LiteLLM's chat completions endpoint to generate a git commit message
 * based on the provided staged diff.
 */
export async function generateCommitMessageFromDiff(
  apiBase: string,
  apiKey: string,
  model: string,
  diff: string
): Promise<string> {
  // Truncate very large diffs to stay within typical context limits
  const truncatedDiff =
    diff.length > MAX_DIFF_CHARS
      ? diff.slice(0, MAX_DIFF_CHARS) + '\n\n[diff truncated…]'
      : diff;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await httpPost<any>(apiBase, apiKey, '/v1/chat/completions', {
    model,
    messages: [
      {
        role: 'system',
        content:
          'You are a helpful assistant that writes concise, clear git commit messages. ' +
          'Given a git diff, generate a single commit message in the imperative mood ' +
          '(e.g. "Add feature", "Fix bug"). Follow conventional commit format when ' +
          'appropriate (e.g. feat:, fix:, chore:). Output only the commit message text, ' +
          'with no explanation, markdown formatting, or extra text.',
      },
      {
        role: 'user',
        content: `Generate a git commit message for the following diff:\n\n${truncatedDiff}`,
      },
    ],
    max_tokens: 256,
    temperature: 0.3,
  });

  const message: unknown = response?.choices?.[0]?.message?.content;
  if (typeof message !== 'string' || !message.trim()) {
    throw new Error('No commit message returned from LiteLLM');
  }
  return message.trim();
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
