import * as vscode from 'vscode';
import { fetchBudgetInfo, BudgetInfo, LiteLLMHttpError } from './litellmClient';
import { makeRefreshController, RefreshController } from './refreshController';
import {
  getConnectionConfig,
  getRefreshIntervalSeconds,
  getSoftBudgetThresholds,
} from './config';
import { ACTIVATION_JITTER_MS, STARTUP_NOTIFICATION_TEXT } from './constants';
import { UsagePanel } from './usagePanel';

// ─── Module state ─────────────────────────────────────────────────────────────

let statusBarItem: vscode.StatusBarItem | undefined;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let productName = 'LiteLLM';
let controller: RefreshController | undefined;
/** Last fetch error, for rendering the status bar / pop-up. Cleared on success. */
let lastError: unknown | undefined;
/** Tracks success→error transitions so we don't toast the same failure repeatedly. */
let wasError = false;

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

/**
 * Re-render the status bar purely from the cached BudgetInfo / error state.
 *
 * This NEVER triggers an API call. All fetching goes through `refresh()`.
 */
function renderStatusBar(): void {
  if (!statusBarItem) {
    return;
  }

  const conn = getConnectionConfig();
  if (!conn) {
    statusBarItem.text = `$(cloud-offline) ${productName}`;
    statusBarItem.tooltip = `${productName}: API not configured. Click to set up.`;
    statusBarItem.command = 'litellm.showSpendDetails';
    statusBarItem.backgroundColor = undefined;
    statusBarItem.show();
    return;
  }

  const budgetInfo = controller?.getCache();

  if (!budgetInfo) {
    // No data yet. Show an error state if we have one, otherwise "loading".
    if (lastError) {
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      if (lastError instanceof LiteLLMHttpError && (lastError.isNetworkError || lastError.isTimeout)) {
        statusBarItem.text = `$(cloud-offline) ${productName}`;
        statusBarItem.tooltip = `${productName}: Connection failed. ${message}`;
      } else {
        statusBarItem.text = `$(warning) ${productName}`;
        statusBarItem.tooltip = `${productName}: Failed to fetch usage data. ${message}`;
      }
      statusBarItem.backgroundColor = undefined;
    } else {
      statusBarItem.text = `$(sync~spin) ${productName}`;
      statusBarItem.tooltip = `${productName}: Loading usage data…`;
      statusBarItem.backgroundColor = undefined;
    }
    statusBarItem.command = 'litellm.showSpendDetails';
    statusBarItem.show();
    return;
  }

  const spend = budgetInfo.spend;
  const maxBudget = budgetInfo.maxBudget;

  const spendLabel = formatSpend(spend);
  const hardStyle = resolveHardBudgetStyle(spend, maxBudget);
  const softStyle = resolveSoftBudgetStyle(spend);
  const finalStyle = hardStyle ?? softStyle;

  if (maxBudget !== null && maxBudget > 0) {
    const pct = Math.min((spend / maxBudget) * 100, 100).toFixed(1);
    statusBarItem.text = `${finalStyle.icon} ${productName} ${spendLabel} (${pct}%)`;
    const windowLabel = budgetInfo.budgetDuration ? ` · ${budgetInfo.budgetDuration} window` : '';
    statusBarItem.tooltip = `${productName} budget spend: ${spendLabel} / $${maxBudget.toFixed(2)} (${pct}% used${windowLabel}). Click for details.`;
  } else {
    statusBarItem.text = `${finalStyle.icon} ${productName} ${spendLabel}`;
    const windowLabel = budgetInfo.budgetDuration ? ` (${budgetInfo.budgetDuration} window)` : '';
    statusBarItem.tooltip = `${productName} budget spend: ${spendLabel}${windowLabel}. Click for details.`;
  }

  statusBarItem.command = 'litellm.showSpendDetails';
  statusBarItem.backgroundColor = finalStyle.backgroundColor;
  statusBarItem.show();
}

/**
 * Fetcher used by the refresh controller. Reads the live connection config so
 * config changes are picked up automatically. Throws when not configured; the
 * host guards `refresh()` calls so the fetcher normally runs only when a
 * connection exists.
 */
async function budgetFetcher(): Promise<BudgetInfo> {
  const conn = getConnectionConfig();
  if (!conn) {
    throw new LiteLLMHttpError('API base URL is not configured', { statusCode: null });
  }
  return fetchBudgetInfo(conn.apiBase, conn.apiKey);
}

function onResult(info: BudgetInfo): void {
  lastError = undefined;
  wasError = false;
  renderStatusBar();
  // Keep any open dashboard in sync without extra API calls.
  UsagePanel.currentPanel?.update(info);
}

function onError(err: unknown): void {
  lastError = err;
  renderStatusBar();
  // Toast only on the success→error transition to avoid spamming.
  if (!wasError) {
    wasError = true;
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`${productName}: ${message}`);
  }
}

/**
 * Cooldown-gated, single-flight refresh. Returns the cached BudgetInfo when
 * fresh. This is the ONLY path that talks to the proxy.
 */
function refresh(opts?: { force?: boolean }): Promise<BudgetInfo | undefined> {
  if (!controller) {
    return Promise.resolve(undefined);
  }
  const conn = getConnectionConfig();
  if (!conn) {
    renderStatusBar();
    return Promise.resolve(undefined);
  }
  return controller.refresh(opts).catch((err: unknown) => {
    // Swallow here; onError already rendered + toasted. Re-throw is handled by
    // callers that need the value (pop-up, dashboard) via their own await.
    throw err;
  });
}

/** Show a quick-pick detail popup for the current budget spend. */
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

  // Render from cache when fresh (no API call). Only fetch if the cache is
  // empty / stale beyond the cooldown — and even then via the shared,
  // single-flight, cooldown-gated controller.
  let budgetInfo: BudgetInfo | undefined;
  try {
    budgetInfo = await refresh();
  } catch (err) {
    await vscode.window.showErrorMessage(
      `Failed to fetch ${productName} usage: ` +
        (err instanceof Error ? err.message : String(err))
    );
    return;
  }
  if (!budgetInfo) {
    budgetInfo = controller?.getCache();
  }
  if (!budgetInfo) {
    // No cached data. Surface a prior failure if we have one; otherwise the
    // initial jittered fetch is still pending.
    if (lastError) {
      await vscode.window.showErrorMessage(
        `Failed to fetch ${productName} usage: ` +
          (lastError instanceof Error ? lastError.message : String(lastError))
      );
    } else {
      vscode.window.showInformationMessage(
        `${productName}: usage data is still loading. Try again shortly.`
      );
    }
    return;
  }

  const spend = budgetInfo.spend;
  const maxBudget = budgetInfo.maxBudget;
  const resetAt = budgetInfo.budgetResetAt;
  const window = budgetInfo.budgetDuration;
  const alias = budgetInfo.userAlias;

  const pct =
    maxBudget && maxBudget > 0
      ? `${Math.min((spend / maxBudget) * 100, 100).toFixed(1)}% used`
      : null;

  const budgetBar = maxBudget && maxBudget > 0 ? buildBudgetBar(spend, maxBudget) : '';

  const lines: string[] = [
    `Current Spend : ${formatSpend(spend)}`,
    maxBudget ? `Budget Limit        : $${maxBudget.toFixed(2)}` : '',
    pct ? `Budget Used         : ${pct}` : '',
    budgetBar ? `Budget              : ${budgetBar}` : '',
    window ? `Budget Window        : ${window}` : '',
    resetAt ? `Resets At           : ${new Date(resetAt).toLocaleString()}` : '',
    alias ? `User Alias      : ${alias}` : '',
    `Data Source         : ${budgetInfo.source}`,
    `API Base            : ${conn.apiBase}`,
  ].filter(Boolean);

  const items: vscode.QuickPickItem[] = [
    { label: `$(info) ${productName}`, kind: vscode.QuickPickItemKind.Separator },
    ...lines.map((l) => ({ label: l })),
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: '$(graph) Open Usage Dashboard', description: 'View budget summary' },
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

  // Single, process-wide refresh controller. Owns the BudgetInfo cache and
  // enforces cooldown + single-flight for every API call.
  controller = makeRefreshController({
    getIntervalMs: () => getRefreshIntervalSeconds() * 1000,
    fetcher: budgetFetcher,
    onResult,
    onError,
  });

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('litellm.showUsage', async () => {
      const conn = getConnectionConfig();
      if (!conn) {
        vscode.window.showWarningMessage(
          `${productName} is not configured. Please set litellm.apiBase first.`
        );
        return;
      }
      // Ensure cache is populated (gated; no call when fresh). Open the panel
      // with the snapshot — the panel itself issues no API calls.
      let info: BudgetInfo | undefined;
      try {
        info = await refresh();
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to fetch ${productName} usage: ` + (err instanceof Error ? err.message : String(err))
        );
        return;
      }
      if (!info) {
        info = controller?.getCache();
      }
      if (!info) {
        if (lastError) {
          vscode.window.showErrorMessage(
            `Failed to fetch ${productName} usage: ` +
              (lastError instanceof Error ? lastError.message : String(lastError))
          );
        } else {
          vscode.window.showInformationMessage(
            `${productName}: usage data is still loading. Try again shortly.`
          );
        }
        return;
      }
      UsagePanel.createOrShow(info, conn.apiBase, productName);
    }),

    vscode.commands.registerCommand('litellm.showSpendDetails', () => {
      showSpendDetails().catch((err: unknown) => {
        console.error('LiteLLM showSpendDetails error:', err);
        vscode.window.showErrorMessage(
          `${productName}: Unexpected error: ` + (err instanceof Error ? err.message : String(err))
        );
      });
    }),

    // Manual refresh is also cooldown-gated per the v1.0.2 requirement. If a
    // fetch has settled recently and we already have data, we do NOT fire and
    // instead tell the user when the next refresh is allowed. When there is no
    // data yet (first use) the controller always fires regardless of cooldown.
    vscode.commands.registerCommand('litellm.refresh', async () => {
      const conn = getConnectionConfig();
      if (!conn) {
        vscode.window.showWarningMessage(
          `${productName} is not configured. Please set litellm.apiBase first.`
        );
        return;
      }
      if (!controller) {
        return;
      }
      const waitMs = controller.msUntilNextRefresh();
      if (waitMs > 0 && controller.getCache() !== undefined) {
        vscode.window.showInformationMessage(
          `${productName}: Refreshed recently. Next refresh available in ~${Math.max(
            1,
            Math.round(waitMs / 1000)
          )}s.`
        );
        return;
      }
      try {
        await controller.refresh();
        vscode.window.showInformationMessage(`${productName} usage refreshed.`);
      } catch (err) {
        // Error already rendered/toasted via onError; no extra toast here.
        vscode.window.showInformationMessage(
          `${productName}: refresh failed — ` + (err instanceof Error ? err.message : String(err))
        );
      }
    })
  );

  // Initial status render (no data yet), then a jittered first fetch so 200
  // workspaces don't all hit the proxy in the same instant.
  renderStatusBar();
  const jitter = Math.floor(Math.random() * ACTIVATION_JITTER_MS);
  setTimeout(() => {
    refresh({ force: true }).catch(() => {
      /* error already handled in onError */
    });
  }, jitter);

  // Periodic refresh via the gated controller (no call within cooldown).
  const intervalSeconds = getRefreshIntervalSeconds();
  refreshTimer = setInterval(() => {
    refresh().catch(() => {
      /* handled */
    });
  }, intervalSeconds * 1000);

  // Re-read config when workspace configuration changes.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('litellm')) {
        return;
      }

      // Reschedule the timer if the interval changed.
      if (e.affectsConfiguration('litellm.refreshIntervalSeconds')) {
        if (refreshTimer !== undefined) {
          clearInterval(refreshTimer);
        }
        const newInterval = getRefreshIntervalSeconds();
        refreshTimer = setInterval(() => {
          refresh().catch(() => {
            /* handled */
          });
        }, newInterval * 1000);
      }

      // A genuine connection change is the one allowed cooldown bypass: drop
      // the cache for the old endpoint and fetch the new one promptly.
      if (
        e.affectsConfiguration('litellm.apiBase') ||
        e.affectsConfiguration('litellm.apiKey')
      ) {
        controller?.clearCache();
        controller?.resetCooldown();
        refresh({ force: true }).catch(() => {
          /* handled */
        });
        return;
      }

      // Other litellm settings (e.g. soft-budget thresholds): re-render from
      // cache only — no API call.
      renderStatusBar();
    })
  );

  // NOTE: the v1.0.0 onDidChangeWindowState (refresh on window focus) handler
  // was removed in v1.0.2. It was the largest call multiplier and is unnecessary
  // now that the periodic timer + cooldown manage freshness.
}

export function deactivate(): void {
  if (refreshTimer !== undefined) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
  controller = undefined;
  lastError = undefined;
  wasError = false;
}
