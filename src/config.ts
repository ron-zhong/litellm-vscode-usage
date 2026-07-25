import * as vscode from 'vscode';

export interface ConnectionConfig {
  apiBase: string;
  apiKey: string;
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
