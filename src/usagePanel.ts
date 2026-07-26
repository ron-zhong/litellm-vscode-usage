import * as vscode from 'vscode';
import { BudgetInfo } from './litellmClient';

/**
 * Static webview that renders a snapshot of the current BudgetInfo fetched via
 * GET /v2/user/info. The panel issues NO API calls of its own; it only displays
 * the BudgetInfo handed to it (kept fresh by the extension's refresh callbacks).
 */
export class UsagePanel {
  public static currentPanel: UsagePanel | undefined;
  private static readonly viewType = 'litellmUsage';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _productName: string;
  private readonly _apiBase: string;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(
    info: BudgetInfo,
    apiBase: string,
    productName: string
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (UsagePanel.currentPanel) {
      UsagePanel.currentPanel._panel.reveal(column);
      UsagePanel.currentPanel.update(info);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      UsagePanel.viewType,
      `${productName} Usage Dashboard`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: false,
        retainContextWhenHidden: true,
      }
    );

    UsagePanel.currentPanel = new UsagePanel(panel, info, apiBase, productName);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    info: BudgetInfo,
    apiBase: string,
    productName: string
  ) {
    this._panel = panel;
    this._apiBase = apiBase;
    this._productName = productName;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = this._getHtml(info);
  }

  /** Re-render the panel with an updated BudgetInfo snapshot. */
  public update(info: BudgetInfo): void {
    if (this._panel.visible) {
      this._panel.webview.html = this._getHtml(info);
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

  private _getHtml(info: BudgetInfo): string {
    const spend = info.spend;
    const maxBudget = info.maxBudget;
    const pct =
      maxBudget && maxBudget > 0
        ? Math.min((spend / maxBudget) * 100, 100).toFixed(1)
        : null;
    const bar = maxBudget && maxBudget > 0 ? buildBudgetBar(spend, maxBudget) : '';
    const windowLabel = info.budgetDuration ?? '—';
    const resetLabel = info.budgetResetAt
      ? new Date(info.budgetResetAt).toLocaleString()
      : '—';
    const aliasLabel = info.userAlias ?? '—';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(this._productName)} Usage Dashboard</title>
  ${this._commonStyles()}
</head>
<body>
  <div class="container">
    <h1>${escapeHtml(this._productName)} Usage Dashboard</h1>
    <p class="subtitle">Source: <code>GET /v2/user/info</code> &middot; spend is the current budget-window total (not a calendar month).</p>

    <div class="summary-cards">
      <div class="card">
        <div class="card-label">Current Spend</div>
        <div class="card-value">$${spend.toFixed(4)}</div>
      </div>
      <div class="card">
        <div class="card-label">Budget Limit</div>
        <div class="card-value">${maxBudget ? `$${maxBudget.toFixed(2)}` : '—'}</div>
      </div>
      <div class="card">
        <div class="card-label">Budget Used</div>
        <div class="card-value">${pct ? `${pct}%` : '—'}</div>
      </div>
      <div class="card">
        <div class="card-label">Budget Duration</div>
        <div class="card-value">${escapeHtml(windowLabel)}</div>
      </div>
      <div class="card">
        <div class="card-label">Resets At</div>
        <div class="card-value small">${escapeHtml(resetLabel)}</div>
      </div>
    </div>

    ${
      bar
        ? `<h2>Budget</h2>
    <div class="bar-row"><code>${escapeHtml(bar)}</code> ${pct ? `<span class="muted">${pct}% used</span>` : ''}</div>`
        : ''
    }

    <h2>Details</h2>
    <table>
      <tbody>
        <tr><th>Current Spend</th><td>$${spend.toFixed(4)}</td></tr>
        <tr><th>Budget Limit</th><td>${maxBudget ? `$${maxBudget.toFixed(2)}` : '— (none configured)'}</td></tr>
        <tr><th>Budget Used</th><td>${pct ? `${pct}%` : '—'}</td></tr>
        <tr><th>Budget Duration</th><td>${escapeHtml(windowLabel)}</td></tr>
        <tr><th>Budget Resets At</th><td>${escapeHtml(resetLabel)}</td></tr>
        <tr><th>User Alias</th><td>${escapeHtml(aliasLabel)}</td></tr>
        <tr><th>API Base</th><td><code>${escapeHtml(this._apiBase)}</code></td></tr>
        <tr><th>Data Source</th><td><code>${escapeHtml(info.source)}</code></td></tr>
      </tbody>
    </table>

    <p class="muted">This dashboard is a snapshot of the most recent refresh. It refreshes automatically every refresh interval and does not issue its own API calls.</p>
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
    margin-bottom: 8px;
    color: var(--vscode-foreground);
  }
  .subtitle {
    font-size: 0.85em;
    color: var(--vscode-descriptionForeground, #888);
    margin: 0 0 20px 0;
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
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
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
  .card-value.small {
    font-size: 1.1em;
  }
  .bar-row {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 1.1em;
  }
  .bar-row code {
    font-size: 1.2em;
    letter-spacing: 1px;
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
    width: 40%;
  }
  .muted {
    color: var(--vscode-descriptionForeground, #888);
    font-size: 0.85em;
  }
  code {
    background: var(--vscode-textCodeBlock-background, #2a2d2e);
    padding: 1px 4px;
    border-radius: 3px;
  }
</style>`;
  }
}

/** Build a simple ASCII budget bar, e.g. [████████░░]. Returns an empty string when maxBudget is null or <= 0. */
function buildBudgetBar(spend: number, maxBudget: number | null): string {
  if (!maxBudget || maxBudget <= 0) {
    return '';
  }
  const pct = Math.min(spend / maxBudget, 1);
  const total = 20;
  const filled = Math.round(pct * total);
  const empty = total - filled;
  return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
