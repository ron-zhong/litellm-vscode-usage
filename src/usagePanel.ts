import * as vscode from 'vscode';
import { BudgetInfo, DailyPoint } from './litellmClient';

/**
 * Static webview that renders a snapshot of the current BudgetInfo (fetched via
 * GET /v2/user/info) plus, when available, a month-to-date spend bar chart (built from
 * a daily-cached GET /spend/logs?summarize=true). The panel issues NO API calls
 * of its own; it only displays the snapshots handed to it.
 */
export class UsagePanel {
  public static currentPanel: UsagePanel | undefined;
  private static readonly viewType = 'litellmUsage';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _productName: string;
  private readonly _apiBase: string;
  private _dailySeries: DailyPoint[] | undefined;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(
    info: BudgetInfo,
    dailySeries: DailyPoint[] | undefined,
    apiBase: string,
    productName: string
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (UsagePanel.currentPanel) {
      UsagePanel.currentPanel._panel.reveal(column);
      UsagePanel.currentPanel.update(info, dailySeries);
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

    UsagePanel.currentPanel = new UsagePanel(panel, info, dailySeries, apiBase, productName);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    info: BudgetInfo,
    dailySeries: DailyPoint[] | undefined,
    apiBase: string,
    productName: string
  ) {
    this._panel = panel;
    this._apiBase = apiBase;
    this._productName = productName;
    this._dailySeries = dailySeries;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = this._getHtml(info, dailySeries);
  }

  /**
   * Re-render the panel with an updated BudgetInfo snapshot, keeping the
   * existing month-to-date series (Refresh updates the budget only, not the chart).
   * If a fresh daily series is supplied (dashboard re-open), it replaces it.
   */
  public update(info: BudgetInfo, dailySeries?: DailyPoint[] | undefined): void {
    if (dailySeries !== undefined) {
      this._dailySeries = dailySeries;
    }
    if (this._panel.visible) {
      this._panel.webview.html = this._getHtml(info, this._dailySeries);
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

  private _getHtml(info: BudgetInfo, dailySeries: DailyPoint[] | undefined): string {
    const spend = info.spend;
    const maxBudget = info.maxBudget;
    const hasBudget = !!(maxBudget && maxBudget > 0);
    const pct = hasBudget ? Math.min((spend / (maxBudget as number)) * 100, 100).toFixed(1) : null;
    const bar = hasBudget ? buildBudgetBar(spend, maxBudget) : '';
    const resetLabel = info.budgetResetAt ? new Date(info.budgetResetAt).toLocaleString() : '—';
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

    <div class="summary-cards">
      <div class="card">
        <div class="card-label">Current Budget Spend</div>
        <div class="card-value">$${spend.toFixed(4)}</div>
      </div>
      ${
        hasBudget
          ? `<div class="card">
        <div class="card-label">Budget Limit</div>
        <div class="card-value">$${(maxBudget as number).toFixed(2)}</div>
      </div>
      <div class="card">
        <div class="card-label">Budget Used</div>
        <div class="card-value">${pct}%</div>
      </div>`
          : ''
      }
      <div class="card">
        <div class="card-label">Resets At</div>
        <div class="card-value small">${escapeHtml(resetLabel)}</div>
      </div>
    </div>

    ${
      hasBudget
        ? `<h2>Budget</h2>
    <div class="bar-row"><code>${escapeHtml(bar)}</code> <span class="muted">${pct}% used</span></div>`
        : ''
    }

    <h2>Details</h2>
    <table>
      <tbody>
        <tr><th>Current Budget Spend</th><td>$${spend.toFixed(4)}</td></tr>
        ${
          hasBudget
            ? `<tr><th>Budget Limit</th><td>$${(maxBudget as number).toFixed(2)}</td></tr>
        <tr><th>Budget Used</th><td>${pct}%</td></tr>`
            : ''
        }
        <tr><th>Budget Resets At</th><td>${escapeHtml(resetLabel)}</td></tr>
        <tr><th>User Alias</th><td>${escapeHtml(aliasLabel)}</td></tr>
      </tbody>
    </table>

    ${this._chartSection(dailySeries)}

    <p class="muted">Current spend refreshes automatically every refresh interval via <code>/v2/user/info</code>. The month-to-date chart refreshes at most once per day when the dashboard is opened.</p>
  </div>
</body>
</html>`;
  }

  /** Render the "Month-to-Date Spend" vertical bar chart, or an unavailable note. */
  private _chartSection(dailySeries: DailyPoint[] | undefined): string {
    if (!dailySeries || dailySeries.length === 0) {
      return `<h2>Month-to-Date Spend</h2><p class="muted">Month-to-date breakdown unavailable (feature disabled, or the spend-logs request failed).</p>`;
    }
    const maxSpend = dailySeries.reduce((m, d) => (d.spend > m ? d.spend : m), 0);
    const total = dailySeries.reduce((s, d) => s + d.spend, 0);
    const chartHeight = 200; // px
    const numBars = dailySeries.length;

    // Y-axis ticks: 0, 25%, 50%, 75%, 100% of max
    const yTicks = [1, 0.75, 0.5, 0.25, 0];
    const yTickLabels = yTicks
      .map((t) => {
        const val = maxSpend * t;
        return `<div class="y-tick" style="bottom:${t * 100}%"><span class="y-tick-label">$${val.toFixed(2)}</span><span class="y-tick-line"></span></div>`;
      })
      .join('');

    // X-axis: show a label every ~5 days, plus the first and last
    const labelInterval = Math.max(1, Math.ceil(numBars / 8));
    const bars = dailySeries
      .map((d, i) => {
        const pctOfMax = maxSpend > 0 ? (d.spend / maxSpend) * 100 : 0;
        const h = Math.max(pctOfMax, d.spend > 0 ? 1 : 0); // min 1% sliver for nonzero days
        const dom = d.date.slice(8, 10); // day-of-month
        const showLabel = i === 0 || i === numBars - 1 || i % labelInterval === 0;
        const tooltip = buildDayTooltip(d);
        return `<div class="bar-col" title="${escapeHtml(tooltip)}">
          <div class="bar" style="height:${(h / 100) * chartHeight}px"></div>
          <div class="bar-label">${showLabel ? escapeHtml(dom) : ''}</div>
        </div>`;
      })
      .join('');

    // Daily breakdown table: newest date first
    const breakdownRows = [...dailySeries]
      .reverse()
      .map((d) => {
        const modelsStr = formatModelsForTable(d.models);
        return `<tr><td>${escapeHtml(d.date)}</td><td>$${d.spend.toFixed(4)}</td><td>${escapeHtml(modelsStr)}</td></tr>`;
      })
      .join('');

    const monthLabel = dailySeries[0]?.date.slice(0, 7) ?? '';
    return `<h2>Month-to-Date Spend${monthLabel ? ` (${escapeHtml(monthLabel)})` : ''}</h2>
    <p class="muted">Total (MTD): <strong>$${total.toFixed(4)}</strong> · Peak day: <strong>$${maxSpend.toFixed(4)}</strong> · oldest → newest (left → right)</p>
    <div class="chart-wrapper">
      <div class="chart">
        <div class="chart-y-axis">${yTickLabels}</div>
        <div class="bars">${bars}</div>
      </div>
      <div class="x-axis-label">Day of Month</div>
    </div>

    <h3>Daily Breakdown</h3>
    <table class="breakdown-table">
      <thead>
        <tr><th class="col-date">Date</th><th class="col-spend">Spend</th><th class="col-models">Models</th></tr>
      </thead>
      <tbody>
        ${breakdownRows}
      </tbody>
    </table>`;
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
  .container { max-width: 900px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 1.6em; margin-bottom: 8px; color: var(--vscode-foreground); }
  h2 { font-size: 1.2em; margin-top: 32px; margin-bottom: 12px; border-bottom: 1px solid var(--vscode-panel-border, #444); padding-bottom: 6px; }
  .summary-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: var(--vscode-editor-inactiveSelectionBackground, #2a2d2e); border: 1px solid var(--vscode-panel-border, #444); border-radius: 6px; padding: 16px; }
  .card-label { font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--vscode-descriptionForeground, #888); margin-bottom: 6px; }
  .card-value { font-size: 1.8em; font-weight: bold; color: var(--vscode-textLink-foreground, #4fc1ff); }
  .card-value.small { font-size: 1.1em; }
  .bar-row { display: flex; align-items: center; gap: 12px; font-size: 1.1em; }
  .bar-row code { font-size: 1.2em; letter-spacing: 1px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border, #333); }
  th { background: var(--vscode-editor-inactiveSelectionBackground, #2a2d2e); font-weight: 600; width: 40%; }
  .muted { color: var(--vscode-descriptionForeground, #888); font-size: 0.85em; }
  code { background: var(--vscode-textCodeBlock-background, #2a2d2e); padding: 1px 4px; border-radius: 3px; }

  .chart-wrapper { margin-top: 8px; }
  .chart { display: flex; align-items: stretch; gap: 4px; position: relative; }
  .chart-y-axis { position: relative; width: 56px; height: 200px; flex-shrink: 0; }
  .y-tick { position: absolute; left: 0; right: 0; display: flex; align-items: center; height: 0; }
  .y-tick-label { font-size: 0.65em; color: var(--vscode-descriptionForeground, #888); white-space: nowrap; padding-right: 4px; width: 52px; text-align: right; }
  .y-tick-line { flex: 1; border-top: 1px solid var(--vscode-panel-border, #444); opacity: 0.5; }
  .bars { display: flex; align-items: flex-end; gap: 2px; height: 200px; flex: 1; border-bottom: 1px solid var(--vscode-panel-border, #444); border-left: 1px solid var(--vscode-panel-border, #444); padding: 0 0 0 0; position: relative; }
  .bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; min-width: 0; cursor: default; }
  .bar { width: 100%; background: var(--vscode-charts-blue, var(--vscode-textLink-foreground, #4fc1ff)); border-radius: 2px 2px 0 0; transition: opacity 0.15s; }
  .bar-col:hover .bar { opacity: 0.7; }
  .bar-label { font-size: 0.6em; color: var(--vscode-descriptionForeground, #888); margin-top: 4px; height: 1em; }
  .x-axis-label { text-align: center; font-size: 0.7em; color: var(--vscode-descriptionForeground, #888); margin-top: 4px; }

  .breakdown-table th.col-date { width: 120px; }
  .breakdown-table th.col-spend { width: 100px; }
  .breakdown-table th.col-models { width: auto; }
  .breakdown-table td { font-size: 0.85em; word-break: break-all; }
  h3 { font-size: 1.05em; margin-top: 24px; margin-bottom: 8px; color: var(--vscode-foreground); }
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

/**
 * Build a multi-line tooltip for a chart bar showing the date, total spend,
 * and per-model breakdown.
 */
function buildDayTooltip(d: DailyPoint): string {
  const lines = [`${d.date}`, `Spend: $${d.spend.toFixed(4)}`];
  const modelEntries = Object.entries(d.models).sort((a, b) => b[1] - a[1]);
  if (modelEntries.length > 0) {
    lines.push('Models:');
    for (const [model, amt] of modelEntries) {
      lines.push(`  ${model}: $${amt.toFixed(4)}`);
    }
  } else {
    lines.push('Models: (none)');
  }
  return lines.join('\n');
}

/** Format the models map as a compact string for the breakdown table. */
function formatModelsForTable(models: Record<string, number>): string {
  const entries = Object.entries(models).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return '—';
  }
  return entries.map(([m, amt]) => `${m} ($${amt.toFixed(4)})`).join(', ');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
