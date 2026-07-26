export const DEFAULT_REFRESH_INTERVAL_SECONDS = 300;
export const REFRESH_INTERVAL_FLOOR_SECONDS = 60;

export const SOFT_BUDGET_DEFAULT_STANDARD = 200;
export const SOFT_BUDGET_DEFAULT_PRO = 500;
export const SOFT_BUDGET_DEFAULT_MAX = 1000;

export const STARTUP_NOTIFICATION_TEXT = 'LiteLLM spend monitor is running.';

/**
 * Maximum random delay (ms) before the first fetch on activation.
 *
 * With 150–200 workspaces starting near-simultaneously, jitter spreads the
 * initial GET /v2/user/info burst across this window instead of all firing in
 * the same second. Kept small so the first status-bar value still appears
 * promptly (within ~ACTIVATION_JITTER_MS).
 */
export const ACTIVATION_JITTER_MS = 10_000;
