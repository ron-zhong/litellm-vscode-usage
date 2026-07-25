import * as vscode from 'vscode';
import {
  fetchSpendLogs,
  aggregateUsage,
  UsageSummary,
  DailySpend,
  ModelSpend,
} from './litellmClient';

export class UsagePanel {
  public static currentPanel: UsagePanel | undefined;
  private static readonly viewType = 'litellmUsage';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionUri: vscode.Uri,
    apiBase: string,
    apiKey: string
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (UsagePanel.currentPanel) {
      UsagePanel.currentPanel._panel.reveal(column);
      UsagePanel.currentPanel.refresh(apiBase, apiKey);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      UsagePanel.viewType,
      'LiteLLM Usage Dashboard',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    UsagePanel.currentPanel = new UsagePanel(panel, extensionUri, apiBase, apiKey);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    apiBase: string,
    apiKey: string
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this.refresh(apiBase, apiKey);
  }

  public async refresh(apiBase: string, apiKey: string): Promise<void> {
    this._panel.webview.html = this._getLoadingHtml();

    try {
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const todayStr = now.toISOString().slice(0, 10);

      const [monthLogs, dayLogs] = await Promise.all([
        fetchSpendLogs(apiBase, apiKey, monthStart, todayStr),
        fetchSpendLogs(apiBase, apiKey, todayStr, todayStr),
      ]);

      const monthSummary = aggregateUsage(monthLogs);
      const daySummary = aggregateUsage(dayLogs);

      this._panel.webview.html = this._getHtml(monthSummary, daySummary, monthStart, todayStr);
    } catch (err) {
      this._panel.webview.html = this._getErrorHtml(
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  public dispose(): void {
    UsagePanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }

  private _getLoadingHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>LiteLLM Usage</title>${this._commonStyles()}</head>
<body>
  <div class="container">
    <h1>LiteLLM Usage Dashboard</h1>
    <p class="loading">Loading usage data…</p>
  </div>
</body>
</html>`;
  }

  private _getErrorHtml(message: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>LiteLLM Usage</title>${this._commonStyles()}</head>
<body>
  <div class="container">
    <h1>LiteLLM Usage Dashboard</h1>
    <div class="error">
      <strong>Error loading usage data</strong><br>
      ${escapeHtml(message)}<br><br>
      Please verify your <code>litellm.apiBase</code> and <code>litellm.apiKey</code> settings
      (or the <code>LITELLM_API_BASE</code> / <code>LITELLM_API_KEY</code> environment variables).
    </div>
  </div>
</body>
</html>`;
  }

  private _getHtml(
    monthSummary: UsageSummary,
    daySummary: UsageSummary,
    monthStart: string,
    todayStr: string
  ): string {
    const dailyRows = monthSummary.dailySpend
      .map(
        (d: DailySpend) =>
          `<tr><td>${escapeHtml(d.date)}</td><td>$${d.spend.toFixed(4)}</td><td>${d.tokens.toLocaleString()}</td></tr>`
      )
      .join('');

    const modelRows = monthSummary.modelBreakdown
      .map(
        (m: ModelSpend) =>
          `<tr><td>${escapeHtml(m.model)}</td><td>$${m.spend.toFixed(4)}</td><td>${m.tokens.toLocaleString()}</td><td>${m.requests.toLocaleString()}</td></tr>`
      )
      .join('');

    const dayModelRows = daySummary.modelBreakdown
      .map(
        (m: ModelSpend) =>
          `<tr><td>${escapeHtml(m.model)}</td><td>$${m.spend.toFixed(4)}</td><td>${m.tokens.toLocaleString()}</td><td>${m.requests.toLocaleString()}</td></tr>`
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LiteLLM Usage Dashboard</title>
  ${this._commonStyles()}
</head>
<body>
  <div class="container">
    <h1>LiteLLM Usage Dashboard</h1>

    <div class="summary-cards">
      <div class="card">
        <div class="card-label">Today's Spend</div>
        <div class="card-value">$${daySummary.totalMonthlySpend.toFixed(4)}</div>
        <div class="card-sub">${escapeHtml(todayStr)}</div>
      </div>
      <div class="card">
        <div class="card-label">Monthly Spend</div>
        <div class="card-value">$${monthSummary.totalMonthlySpend.toFixed(4)}</div>
        <div class="card-sub">${escapeHtml(monthStart)} – ${escapeHtml(todayStr)}</div>
      </div>
      <div class="card">
        <div class="card-label">Requests Today</div>
        <div class="card-value">${daySummary.modelBreakdown.reduce((s: number, m: ModelSpend) => s + m.requests, 0).toLocaleString()}</div>
      </div>
      <div class="card">
        <div class="card-label">Requests This Month</div>
        <div class="card-value">${monthSummary.modelBreakdown.reduce((s: number, m: ModelSpend) => s + m.requests, 0).toLocaleString()}</div>
      </div>
    </div>

    <h2>Today's Usage by Model</h2>
    ${
      daySummary.modelBreakdown.length === 0
        ? '<p class="empty">No usage data for today.</p>'
        : `<table>
        <thead><tr><th>Model</th><th>Spend</th><th>Tokens</th><th>Requests</th></tr></thead>
        <tbody>${dayModelRows}</tbody>
      </table>`
    }

    <h2>Monthly Usage by Day</h2>
    ${
      monthSummary.dailySpend.length === 0
        ? '<p class="empty">No usage data this month.</p>'
        : `<table>
        <thead><tr><th>Date</th><th>Spend</th><th>Tokens</th></tr></thead>
        <tbody>${dailyRows}</tbody>
      </table>`
    }

    <h2>Monthly Usage by Model</h2>
    ${
      monthSummary.modelBreakdown.length === 0
        ? '<p class="empty">No usage data this month.</p>'
        : `<table>
        <thead><tr><th>Model</th><th>Spend</th><th>Tokens</th><th>Requests</th></tr></thead>
        <tbody>${modelRows}</tbody>
      </table>`
    }
  </div>
</body>
</html>`;
  }

  private _commonStyles(): string {
    return `<style>
  body {
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background-color: var(--vscode-editor-background);
    margin: 0;
    padding: 0;
  }
  .container {
    max-width: 900px;
    margin: 0 auto;
    padding: 24px;
  }
  h1 {
    font-size: 1.6em;
    margin-bottom: 20px;
    color: var(--vscode-foreground);
  }
  h2 {
    font-size: 1.2em;
    margin-top: 32px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--vscode-panel-border, #444);
    padding-bottom: 6px;
  }
  .summary-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  }
  .card {
    background: var(--vscode-editor-inactiveSelectionBackground, #2a2d2e);
    border: 1px solid var(--vscode-panel-border, #444);
    border-radius: 6px;
    padding: 16px;
  }
  .card-label {
    font-size: 0.8em;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vscode-descriptionForeground, #888);
    margin-bottom: 6px;
  }
  .card-value {
    font-size: 1.8em;
    font-weight: bold;
    color: var(--vscode-textLink-foreground, #4fc1ff);
  }
  .card-sub {
    font-size: 0.75em;
    color: var(--vscode-descriptionForeground, #888);
    margin-top: 4px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 16px;
  }
  th, td {
    text-align: left;
    padding: 8px 12px;
    border-bottom: 1px solid var(--vscode-panel-border, #333);
  }
  th {
    background: var(--vscode-editor-inactiveSelectionBackground, #2a2d2e);
    font-weight: 600;
    font-size: 0.85em;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  tr:hover td {
    background: var(--vscode-list-hoverBackground, #2a2d2e);
  }
  .loading {
    color: var(--vscode-descriptionForeground, #888);
    font-style: italic;
  }
  .empty {
    color: var(--vscode-descriptionForeground, #888);
  }
  .error {
    background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
    border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
    border-radius: 4px;
    padding: 16px;
    line-height: 1.6;
  }
</style>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
