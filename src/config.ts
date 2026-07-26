import * as vscode from 'vscode';
import {
  DEFAULT_REFRESH_INTERVAL_SECONDS,
  REFRESH_INTERVAL_FLOOR_SECONDS,
  SOFT_BUDGET_DEFAULT_MAX,
  SOFT_BUDGET_DEFAULT_PRO,
  SOFT_BUDGET_DEFAULT_STANDARD,
} from './constants';

export interface ConnectionConfig {
  apiBase: string;
  apiKey: string;
}

export interface SoftBudgetThresholds {
  standard: number;
  pro: number;
  max: number;
}

/**
 * Retrieve LiteLLM connection settings from VS Code config then env vars.
 * Returns null if no API base URL is configured.
 */
export function getConnectionConfig(): ConnectionConfig | null {
  const config = vscode.workspace.getConfiguration('litellm');

  const apiBase =
    (config.get<string>('apiBase') || '').trim() ||
    (process.env['LITELLM_API_BASE'] || '').trim();

  const apiKey =
    (config.get<string>('apiKey') || '').trim() ||
    (process.env['LITELLM_API_KEY'] || '').trim();

  if (!apiBase) {
    return null;
  }

  return { apiBase: apiBase.replace(/\/$/, ''), apiKey };
}

/**
 * Read and clamp status-bar refresh interval according to hardcoded floor.
 */
export function getRefreshIntervalSeconds(): number {
  const config = vscode.workspace.getConfiguration('litellm');
  const configured = config.get<number>('refreshIntervalSeconds') ?? DEFAULT_REFRESH_INTERVAL_SECONDS;
  return Math.max(REFRESH_INTERVAL_FLOOR_SECONDS, configured);
}

/**
 * Read soft-budget thresholds from settings while keeping ascending order sane.
 */
export function getSoftBudgetThresholds(): SoftBudgetThresholds {
  const config = vscode.workspace.getConfiguration('litellm');

  const standardRaw = config.get<number>('softBudgetStandardUsd') ?? SOFT_BUDGET_DEFAULT_STANDARD;
  const proRaw = config.get<number>('softBudgetProUsd') ?? SOFT_BUDGET_DEFAULT_PRO;
  const maxRaw = config.get<number>('softBudgetMaxUsd') ?? SOFT_BUDGET_DEFAULT_MAX;

  const standard = Math.max(0, standardRaw);
  const pro = Math.max(standard, proRaw);
  const max = Math.max(pro, maxRaw);

  return { standard, pro, max };
}
