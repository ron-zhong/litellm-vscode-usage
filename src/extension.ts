import * as vscode from 'vscode';
import {
  fetchBudgetInfo,
  fetchSpendLogsSummarized,
  buildDailySeries,
  todayUtcStr,
  monthStartStr,
  addDayStr,
  BudgetInfo,
  DailyPoint,
  LiteLLMHttpError,
} from './litellmClient';
import { makeRefreshController, RefreshController } from './refreshController';
import {
  getConnectionConfig,
  getRefreshIntervalSeconds,
  getSoftBudgetThresholds,
} from './config';
import {
  ACTIVATION_JITTER_MS,
  DASHBOARD_BREAKDOWN_ENABLED,
  STARTUP_NOTIFICATION_TEXT,
} from './constants';
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

// ─── Dashboard month-to-date logs: daily cache + single-flight ───────────────
// Logs are fetched ONLY on dashboard open, at most once per calendar day per
// user, and only when DASHBOARD_BREAKDOWN_ENABLED is true. They are never
// touched by the periodic timer or the Refresh command (which refreshes the
// budget /v2/user/info only).
let logsCache: DailyPoint[] | undefined;
/** YYYY-MM-DD of the last successful logs fetch; reused for the rest of that day. */
let logsFetchDate: string | undefined;
let logsInFlight: Promise<DailyPoint[] | undefined> | undefined;

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
  return { icon: '$(graph)' };
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

/**
 * Ensure the dashboard's month-to-date daily spend series is available, fetching
 * it at most ONCE per calendar day (success caches for the day; a failure does
 * not cache, so the next dashboard open can retry). Single-flight dedupes
 * concurrent opens. Returns undefined when the feature is disabled or the fetch
 * fails — callers render the budget summary and an "unavailable" note instead of
 * blocking.
 *
 * This is NOT triggered by the periodic timer or the Refresh command.
 */
function ensureDailySpend(): Promise<DailyPoint[] | undefined> {
  if (!DASHBOARD_BREAKDOWN_ENABLED) {
    return Promise.resolve(undefined);
  }
  const today = todayUtcStr();
  if (logsCache && logsFetchDate === today) {
    return Promise.resolve(logsCache);
  }
  if (logsInFlight) {
    return logsInFlight;
  }
  const conn = getConnectionConfig();
  if (!conn) {
    return Promise.resolve(undefined);
  }

  const start = monthStartStr(); // 1st of current month
  const end = addDayStr(today, 1); // capture all of today (API end is <= midnight UTC)

  const p = (async (): Promise<DailyPoint[] | undefined> => {
    try {
      const days = await fetchSpendLogsSummarized(conn.apiBase, conn.apiKey, start, end);
      const series = buildDailySeries(days, start, today);
      logsCache = series;
      logsFetchDate = today; // do not re-fetch until the next calendar day
      return series;
    } catch (err) {
      // Don't cache / don't set logsFetchDate → next dashboard open may retry.
      console.error('LiteLLM dashboard logs fetch failed:', err);
      return undefined;
    } finally {
      logsInFlight = undefined;
    }
  })();

  logsInFlight = p;
  return p;
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
  const hadError = wasError;
  let budgetInfo: BudgetInfo | undefined;
  try {
    budgetInfo = await refresh();
  } catch (err) {
    if (hadError) {
      await vscode.window.showErrorMessage(
        `Failed to fetch ${productName} usage: ` +
          (err instanceof Error ? err.message : String(err))
      );
    }
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
  const alias = budgetInfo.userAlias;

  const pct =
    maxBudget && maxBudget > 0
      ? `${Math.min((spend / maxBudget) * 100, 100).toFixed(1)}% used`
      : null;
  const spendSummary =
    maxBudget && maxBudget > 0
      ? `${formatSpend(spend)} / $${maxBudget.toFixed(2)} (${Math.min((spend / maxBudget) * 100, 100).toFixed(1)}%)`
      : formatSpend(spend);

  const budgetBar = maxBudget && maxBudget > 0 ? buildBudgetBar(spend, maxBudget) : '';

  type SpendPickItem = vscode.QuickPickItem & {
    action?: 'showUsage' | 'refresh' | 'openSettings';
  };

  const detailItems: SpendPickItem[] = [
    { label: 'Spend', description: spendSummary },
    ...(budgetBar ? [{ label: 'Budget Bar', description: budgetBar }] : []),
    ...(resetAt ? [{ label: 'Reset', description: new Date(resetAt).toLocaleString() }] : []),
    ...(alias ? [{ label: 'Alias', description: alias }] : []),
  ];

  const items: SpendPickItem[] = [
    { label: `${productName}`, kind: vscode.QuickPickItemKind.Separator },
    ...detailItems,
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    {
      label: '$(graph) Open Usage Dashboard',
      description: 'View budget summary',
      action: 'showUsage',
    },
    { label: '$(refresh) Refresh', description: 'Refresh status bar now', action: 'refresh' },
    {
      label: '$(settings-gear) Open Settings',
      description: 'Edit LiteLLM settings',
      action: 'openSettings',
    },
  ];

  const selected = await vscode.window.showQuickPick(items, {
    title: `${productName} Spend Details`,
    placeHolder: 'Select an action',
  });

  if (!selected) {
    return;
  }

  if (selected.action === 'showUsage') {
    vscode.commands.executeCommand('litellm.showUsage');
  } else if (selected.action === 'refresh') {
    vscode.commands.executeCommand('litellm.refresh');
  } else if (selected.action === 'openSettings') {
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
      // Ensure the budget cache is populated (gated; no call when fresh), then
      // ensure the month-to-date daily series (at most once per calendar day). The panel
      // itself issues no API calls; it only renders the snapshots.
      const hadError = wasError;
      let info: BudgetInfo | undefined;
      try {
        info = await refresh();
      } catch (err) {
        if (hadError) {
          vscode.window.showErrorMessage(
            `Failed to fetch ${productName} usage: ` + (err instanceof Error ? err.message : String(err))
          );
        }
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
      // Fetch the month-to-date series (daily-cached; no call if already loaded today
      // or if the breakdown is disabled). A logs failure does NOT block the
      // dashboard — the panel renders the budget summary either way.
      const dailySeries = await ensureDailySpend();
      UsagePanel.createOrShow(info, dailySeries, conn.apiBase, productName);
    }),

    vscode.commands.registerCommand('litellm.showSpendDetails', () => {
      showSpendDetails().catch((err: unknown) => {
        console.error('LiteLLM showSpendDetails error:', err);
        vscode.window.showErrorMessage(
          `${productName}: Unexpected error: ` + (err instanceof Error ? err.message : String(err))
        );
      });
    }),

    // Manual Refresh force-reloads the CURRENT SPEND only (GET /v2/user/info),
    // bypassing the cooldown. It does NOT refresh the dashboard month-to-date logs
    // (those refresh at most once per calendar day, on dashboard open). The
    // budget controller's single-flight still dedupes concurrent Refresh clicks.
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
      try {
        await controller.refresh({ force: true });
        vscode.window.showInformationMessage(`${productName} usage refreshed.`);
      } catch (err) {
        // Error already rendered/toasted via onError; this is a light confirmation.
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
  logsCache = undefined;
  logsFetchDate = undefined;
  logsInFlight = undefined;
}
