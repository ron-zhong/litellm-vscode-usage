import * as vscode from 'vscode';
import {
  fetchUserInfo,
  fetchSpendLogs,
  aggregateUsage,
  today,
  UserInfo,
} from './litellmClient';
import { getConnectionConfig } from './config';
import { UsagePanel } from './usagePanel';
import { configureChatByok } from './chatConfig';
import { generateCommitMessage } from './commitMessage';
import { configureModels } from './modelConfig';

// ─── Status bar item ──────────────────────────────────────────────────────────

let statusBarItem: vscode.StatusBarItem | undefined;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let lastUserInfo: UserInfo | undefined;

function formatSpend(amount: number): string {
  if (amount >= 1) {
    return `$${amount.toFixed(2)}`;
  }
  return `$${amount.toFixed(4)}`;
}

/** Update the status bar with the current monthly spend. */
async function updateStatusBar(): Promise<void> {
  if (!statusBarItem) {
    return;
  }

  const conn = getConnectionConfig();
  if (!conn) {
    statusBarItem.text = '$(cloud-offline) LiteLLM';
    statusBarItem.tooltip = 'LiteLLM: API not configured. Click to set up.';
    statusBarItem.command = 'litellm.showSpendDetails';
    statusBarItem.show();
    return;
  }

  statusBarItem.text = '$(sync~spin) LiteLLM';
  statusBarItem.show();

  try {
    const userInfo = await fetchUserInfo(conn.apiBase, conn.apiKey);
    lastUserInfo = userInfo;

    const spend =
      userInfo.userInfo?.spend ??
      userInfo.keys.reduce((s, k) => s + k.spend, 0);

    const maxBudget =
      userInfo.userInfo?.maxBudget ??
      (userInfo.keys.length > 0
        ? userInfo.keys.reduce((s, k) => s + (k.maxBudget ?? 0), 0)
        : null);

    const spendLabel = formatSpend(spend);

    if (maxBudget !== null && maxBudget > 0) {
      const pct = Math.min((spend / maxBudget) * 100, 100).toFixed(1);
      statusBarItem.text = `$(graph) LiteLLM ${spendLabel} (${pct}%)`;
      statusBarItem.tooltip = `LiteLLM monthly spend: ${spendLabel} / $${maxBudget.toFixed(2)} (${pct}% used). Click for details.`;
    } else {
      statusBarItem.text = `$(graph) LiteLLM ${spendLabel}`;
      statusBarItem.tooltip = `LiteLLM monthly spend: ${spendLabel}. Click for details.`;
    }

    statusBarItem.command = 'litellm.showSpendDetails';
    statusBarItem.backgroundColor = undefined;

    // Warn visually when spend exceeds 90% of budget
    if (maxBudget !== null && maxBudget > 0 && spend / maxBudget >= 0.9) {
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground'
      );
    }
  } catch (err) {
    statusBarItem.text = '$(warning) LiteLLM';
    statusBarItem.tooltip =
      'LiteLLM: Failed to fetch usage data. Click for details. Error: ' +
      (err instanceof Error ? err.message : String(err));
    statusBarItem.command = 'litellm.showSpendDetails';
  }
}

/** Show a quick-pick detail popup for the current spend. */
async function showSpendDetails(): Promise<void> {
  const conn = getConnectionConfig();
  if (!conn) {
    const choice = await vscode.window.showWarningMessage(
      'LiteLLM is not configured. Set litellm.apiBase (or LITELLM_API_BASE env var) to get started.',
      'Open Settings'
    );
    if (choice === 'Open Settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'litellm.apiBase');
    }
    return;
  }

  // Fetch fresh user info if we don't have it yet
  let userInfo = lastUserInfo;
  if (!userInfo) {
    try {
      userInfo = await fetchUserInfo(conn.apiBase, conn.apiKey);
      lastUserInfo = userInfo;
    } catch (err) {
      await vscode.window.showErrorMessage(
        'Failed to fetch LiteLLM usage: ' +
          (err instanceof Error ? err.message : String(err))
      );
      return;
    }
  }

  // Also fetch today's spend from logs for a more complete picture
  let todaySpend = 0;
  try {
    const t = today();
    const logs = await fetchSpendLogs(conn.apiBase, conn.apiKey, t, t);
    const summary = aggregateUsage(logs);
    todaySpend = summary.totalDailySpend;
  } catch {
    // Non-fatal; daily spend is optional
  }

  const spend =
    userInfo.userInfo?.spend ??
    userInfo.keys.reduce((s, k) => s + k.spend, 0);

  const maxBudget =
    userInfo.userInfo?.maxBudget ??
    (userInfo.keys.length > 0
      ? userInfo.keys.reduce((s, k) => s + (k.maxBudget ?? 0), 0)
      : null);

  const resetAt = userInfo.userInfo?.budgetResetAt ?? userInfo.keys[0]?.budgetResetAt ?? null;
  const budgetDuration =
    userInfo.userInfo?.budgetDuration ?? userInfo.keys[0]?.budgetDuration ?? null;

  const pct =
    maxBudget && maxBudget > 0
      ? `${Math.min((spend / maxBudget) * 100, 100).toFixed(1)}% used`
      : 'No budget limit set';

  const budgetBar = buildBudgetBar(spend, maxBudget);

  const lines: string[] = [
    `Monthly Spend : ${formatSpend(spend)}${maxBudget ? ` / $${maxBudget.toFixed(2)}` : ''}`,
    `Usage         : ${pct}`,
    budgetBar ? `Budget        : ${budgetBar}` : '',
    `Today's Spend : ${formatSpend(todaySpend)}`,
    budgetDuration ? `Period        : ${budgetDuration}` : '',
    resetAt ? `Resets At     : ${new Date(resetAt).toLocaleString()}` : '',
    `User ID       : ${userInfo.userId || '(unknown)'}`,
    `API Base      : ${conn.apiBase}`,
  ].filter(Boolean);

  const items: vscode.QuickPickItem[] = [
    { label: '$(account) LiteLLM Usage Summary', kind: vscode.QuickPickItemKind.Separator },
    ...lines.map((l) => ({ label: l })),
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: '$(graph) Open Usage Dashboard', description: 'View daily and monthly charts' },
    { label: '$(refresh) Refresh', description: 'Refresh status bar now' },
    { label: '$(settings-gear) Open Settings', description: 'Edit LiteLLM settings' },
  ];

  const selected = await vscode.window.showQuickPick(items, {
    title: 'LiteLLM Spend Details',
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
  // Create status bar item (priority 100 = fairly prominent)
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'litellm.showSpendDetails';
  context.subscriptions.push(statusBarItem);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('litellm.showUsage', () => {
      const conn = getConnectionConfig();
      if (!conn) {
        vscode.window.showWarningMessage(
          'LiteLLM is not configured. Please set litellm.apiBase first.'
        );
        return;
      }
      UsagePanel.createOrShow(context.extensionUri, conn.apiBase, conn.apiKey);
    }),

    vscode.commands.registerCommand('litellm.showSpendDetails', () => {
      showSpendDetails().catch((err: unknown) => {
        console.error('LiteLLM showSpendDetails error:', err);
        vscode.window.showErrorMessage(
          'LiteLLM: Unexpected error: ' + (err instanceof Error ? err.message : String(err))
        );
      });
    }),

    vscode.commands.registerCommand('litellm.configureChatByok', () =>
      configureChatByok()
    ),

    vscode.commands.registerCommand('litellm.refresh', async () => {
      lastUserInfo = undefined;
      await updateStatusBar();
      vscode.window.showInformationMessage('LiteLLM usage refreshed.');
    }),

    vscode.commands.registerCommand('litellm.generateCommitMessage', () =>
      generateCommitMessage()
    ),

    vscode.commands.registerCommand('litellm.configureModels', () =>
      configureModels()
    )
  );

  // Initial status bar update
  updateStatusBar();

  // Periodic refresh
  const config = vscode.workspace.getConfiguration('litellm');
  const intervalSeconds = Math.max(30, config.get<number>('refreshIntervalSeconds') ?? 300);
  refreshTimer = setInterval(() => {
    updateStatusBar();
  }, intervalSeconds * 1000);

  // Re-read config when workspace configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('litellm')) {
        lastUserInfo = undefined;

        // Reset the timer with new interval if it changed
        if (e.affectsConfiguration('litellm.refreshIntervalSeconds')) {
          if (refreshTimer !== undefined) {
            clearInterval(refreshTimer);
          }
          const newConfig = vscode.workspace.getConfiguration('litellm');
          const newInterval = Math.max(
            30,
            newConfig.get<number>('refreshIntervalSeconds') ?? 300
          );
          refreshTimer = setInterval(() => {
            updateStatusBar();
          }, newInterval * 1000);
        }

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
  lastUserInfo = undefined;
}
