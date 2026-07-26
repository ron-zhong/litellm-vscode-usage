import * as vscode from 'vscode';
import {
  fetchBudgetInfo,
  fetchSpendLogs,
  aggregateUsage,
  today,
  startOfMonth,
  BudgetInfo,
  LiteLLMHttpError,
} from './litellmClient';
import {
  getConnectionConfig,
  getRefreshIntervalSeconds,
  getSoftBudgetThresholds,
} from './config';
import {
  STARTUP_NOTIFICATION_TEXT,
} from './constants';
import { UsagePanel } from './usagePanel';

// ─── Status bar item ──────────────────────────────────────────────────────────

let statusBarItem: vscode.StatusBarItem | undefined;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let lastBudgetInfo: BudgetInfo | undefined;
let productName = 'LiteLLM';

function formatSpend(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

interface StatusStyle {
  icon: string;
  backgroundColor?: vscode.ThemeColor;
}

function resolveSoftBudgetStyle(spend: number): StatusStyle {
  const thresholds = getSoftBudgetThresholds();
  if (spend > thresholds.pro) {
    return {
      icon: '$(error)',
      backgroundColor: new vscode.ThemeColor('statusBarItem.errorBackground'),
    };
  }
  if (spend > thresholds.standard) {
    return {
      icon: '$(warning)',
      backgroundColor: new vscode.ThemeColor('statusBarItem.warningBackground'),
    };
  }
  return { icon: '$(radio-tower)' };
}

function resolveHardBudgetStyle(spend: number, maxBudget: number | null): StatusStyle | null {
  if (!maxBudget || maxBudget <= 0) {
    return null;
  }
  const ratio = spend / maxBudget;
  if (ratio >= 1) {
    return {
      icon: '$(circle-slash)',
      backgroundColor: new vscode.ThemeColor('statusBarItem.errorBackground'),
    };
  }
  if (ratio >= 0.8) {
    return {
      icon: '$(warning)',
      backgroundColor: new vscode.ThemeColor('statusBarItem.warningBackground'),
    };
  }
  return null;
}

/** Update the status bar with the current monthly spend. */
async function updateStatusBar(): Promise<void> {
  if (!statusBarItem) {
    return;
  }

  const conn = getConnectionConfig();
  if (!conn) {
    statusBarItem.text = `$(cloud-offline) ${productName}`;
    statusBarItem.tooltip = `${productName}: API not configured. Click to set up.`;
    statusBarItem.command = 'litellm.showSpendDetails';
    statusBarItem.show();
    return;
  }

  statusBarItem.text = `$(sync~spin) ${productName}`;
  statusBarItem.show();

  try {
    const budgetInfo = await fetchBudgetInfo(conn.apiBase, conn.apiKey);
    lastBudgetInfo = budgetInfo;

    const spend = budgetInfo.spend;
    const maxBudget = budgetInfo.maxBudget;

    const spendLabel = formatSpend(spend);
    const hardStyle = resolveHardBudgetStyle(spend, maxBudget);
    const softStyle = resolveSoftBudgetStyle(spend);
    const finalStyle = hardStyle ?? softStyle;

    if (maxBudget !== null && maxBudget > 0) {
      const pct = Math.min((spend / maxBudget) * 100, 100).toFixed(1);
      statusBarItem.text = `${finalStyle.icon} ${productName} ${spendLabel} (${pct}%)`;
      statusBarItem.tooltip = `${productName} spend: ${spendLabel} / $${maxBudget.toFixed(2)} (${pct}% used). Click for details.`;
    } else {
      statusBarItem.text = `${finalStyle.icon} ${productName} ${spendLabel}`;
      statusBarItem.tooltip = `${productName} spend: ${spendLabel}. Click for details.`;
    }

    statusBarItem.command = 'litellm.showSpendDetails';
    statusBarItem.backgroundColor = finalStyle.backgroundColor;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (err instanceof LiteLLMHttpError && (err.isNetworkError || err.isTimeout)) {
      statusBarItem.text = `$(cloud-offline) ${productName}`;
      statusBarItem.tooltip = `${productName}: Connection failed. ${message}`;
    } else {
      statusBarItem.text = `$(warning) ${productName}`;
      statusBarItem.tooltip = `${productName}: Failed to fetch usage data. ${message}`;
    }

    statusBarItem.command = 'litellm.showSpendDetails';
    statusBarItem.backgroundColor = undefined;

    vscode.window.showErrorMessage(`${productName}: ${message}`);
  }
}

/** Show a quick-pick detail popup for the current spend. */
async function showSpendDetails(): Promise<void> {
  const conn = getConnectionConfig();
  if (!conn) {
    const choice = await vscode.window.showWarningMessage(
      `${productName} is not configured. Set litellm.apiBase (or LITELLM_API_BASE env var) to get started.`,
      'Open Settings'
    );
    if (choice === 'Open Settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'litellm.apiBase');
    }
    return;
  }

  // Fetch fresh budget info if we don't have it yet
  let budgetInfo = lastBudgetInfo;
  if (!budgetInfo) {
    try {
      budgetInfo = await fetchBudgetInfo(conn.apiBase, conn.apiKey);
      lastBudgetInfo = budgetInfo;
    } catch (err) {
      await vscode.window.showErrorMessage(
        `Failed to fetch ${productName} usage: ` +
          (err instanceof Error ? err.message : String(err))
      );
      return;
    }
  }

  let todaySpend = 0;
  let monthSpend = 0;
  try {
    const t = today();
    const monthStart = startOfMonth();
    const [dayLogs, monthLogs] = await Promise.all([
      fetchSpendLogs(conn.apiBase, conn.apiKey, t, t),
      fetchSpendLogs(conn.apiBase, conn.apiKey, monthStart, t),
    ]);
    todaySpend = aggregateUsage(dayLogs).totalDailySpend;
    monthSpend = aggregateUsage(monthLogs).totalMonthlySpend;
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to fetch ${productName} spend logs: ` +
        (err instanceof Error ? err.message : String(err))
    );
  }

  const spend = budgetInfo.spend;
  const maxBudget = budgetInfo.maxBudget;
  const resetAt = budgetInfo.budgetResetAt;

  const pct =
    maxBudget && maxBudget > 0
      ? `${Math.min((monthSpend / maxBudget) * 100, 100).toFixed(1)}% used`
      : null;

  const budgetBar = maxBudget && maxBudget > 0 ? buildBudgetBar(monthSpend, maxBudget) : '';

  const lines: string[] = [
    `Today's Spend : ${formatSpend(todaySpend)}`,
    `Monthly Spend : ${formatSpend(monthSpend)}${maxBudget ? ` / $${maxBudget.toFixed(2)}` : ''}`,
    pct ? `Budget Usage  : ${pct}` : '',
    budgetBar ? `Budget        : ${budgetBar}` : '',
    resetAt ? `Resets At     : ${new Date(resetAt).toLocaleString()}` : '',
    `Current Spend : ${formatSpend(spend)} (${budgetInfo.source})`,
    `API Base      : ${conn.apiBase}`,
  ].filter(Boolean);

  const items: vscode.QuickPickItem[] = [
    { label: `$(account) ${productName} Usage Summary`, kind: vscode.QuickPickItemKind.Separator },
    ...lines.map((l) => ({ label: l })),
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: '$(graph) Open Usage Dashboard', description: 'View daily and monthly charts' },
    { label: '$(refresh) Refresh', description: 'Refresh status bar now' },
    { label: '$(settings-gear) Open Settings', description: 'Edit LiteLLM settings' },
  ];

  const selected = await vscode.window.showQuickPick(items, {
    title: `${productName} Spend Details`,
    placeHolder: 'Select an action',
  });

  if (!selected) {
    return;
  }

  if (selected.label.includes('Open Usage Dashboard')) {
    vscode.commands.executeCommand('litellm.showUsage');
  } else if (selected.label.includes('Refresh')) {
    vscode.commands.executeCommand('litellm.refresh');
  } else if (selected.label.includes('Open Settings')) {
    vscode.commands.executeCommand('workbench.action.openSettings', 'litellm');
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

// ─── Extension activation / deactivation ─────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  productName = String(context.extension.packageJSON.displayName || productName);

  // Create status bar item (priority 100 = fairly prominent)
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'litellm.showSpendDetails';
  context.subscriptions.push(statusBarItem);

  vscode.window.showInformationMessage(STARTUP_NOTIFICATION_TEXT);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('litellm.showUsage', () => {
      const conn = getConnectionConfig();
      if (!conn) {
        vscode.window.showWarningMessage(
          `${productName} is not configured. Please set litellm.apiBase first.`
        );
        return;
      }
      UsagePanel.createOrShow(conn.apiBase, conn.apiKey, productName);
    }),

    vscode.commands.registerCommand('litellm.showSpendDetails', () => {
      showSpendDetails().catch((err: unknown) => {
        console.error('LiteLLM showSpendDetails error:', err);
        vscode.window.showErrorMessage(
          `${productName}: Unexpected error: ` + (err instanceof Error ? err.message : String(err))
        );
      });
    }),

    vscode.commands.registerCommand('litellm.refresh', async () => {
      lastBudgetInfo = undefined;
      await updateStatusBar();
      vscode.window.showInformationMessage(`${productName} usage refreshed.`);
    })
  );

  // Initial status bar update
  updateStatusBar();

  // Periodic refresh
  const intervalSeconds = getRefreshIntervalSeconds();
  refreshTimer = setInterval(() => {
    updateStatusBar();
  }, intervalSeconds * 1000);

  // Re-read config when workspace configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('litellm')) {
        lastBudgetInfo = undefined;

        // Reset the timer with new interval if it changed
        if (e.affectsConfiguration('litellm.refreshIntervalSeconds')) {
          if (refreshTimer !== undefined) {
            clearInterval(refreshTimer);
          }
          const newInterval = getRefreshIntervalSeconds();
          refreshTimer = setInterval(() => {
            updateStatusBar();
          }, newInterval * 1000);
        }

        updateStatusBar();
      }
    })
  );

  // Refresh usage when VS Code window regains focus.
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        updateStatusBar();
      }
    })
  );

}

export function deactivate(): void {
  if (refreshTimer !== undefined) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
  lastBudgetInfo = undefined;
}
