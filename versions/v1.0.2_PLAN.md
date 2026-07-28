# Plan v1.0.2 — Single-endpoint, throttle-protected spend monitor

Status: **Draft for review — not yet implemented.**
Target version: `1.0.2` (patch: behavior + API-load changes; removes commands/fields, so flagged as a breaking-ish change in the changelog).

---

## 1. Background

`REVIEW.md` raised five points after the v1.0.0 manual E2E test. This plan turns that feedback into a concrete, constructive implementation. The driving constraint is the production load: **150–200 VS Code workspaces hitting one LiteLLM proxy simultaneously.** The v1.0.0 client can issue several API calls per user interaction and refreshes on every window-focus event, which is unsafe at that scale.

## 2. Feedback, rephrased as actionable requirements

| # | Original feedback (paraphrased) | Constructive requirement for v1.0.2 |
|---|---|---|
| 1 | Remove today's/monthly spend display and all `/spend/logs` calls. | The pop-up and dashboard must no longer call `/spend/logs`. "Today's spend" and "monthly spend (from logs)" rows are removed. `/spend/logs` is dropped as a data source entirely. |
| 2 | Keep only `/v2/user/info`; use `max_budget` to compute % used since users get `budget_duration=30d`. | The single source of truth is `GET /v2/user/info`. Its `spend` field (current budget-window spend) is shown as "Current Budget Spend"; `max_budget` drives the usage percentage; `budget_duration` and `budget_reset_at` are surfaced for clarity. The `/key/info` fallback is removed (see assumptions). |
| 3 | Don't let the user re-trigger the API before `refreshIntervalSeconds` elapses. | All API-triggering paths (periodic timer, manual `Refresh`, status-bar click, dashboard open, config change) go through one gated `refresh()`. A cooldown of `refreshIntervalSeconds` prevents re-firing while data is fresh. |
| 4 | Repeated status-bar clicks must not multiply calls; reuse the latest result until the interval auto-refreshes. | The status-bar click handler renders from the cached `BudgetInfo` and never starts its own fetch except via the shared, cooldown-gated, single-flight `refresh()` (which dedupes concurrent calls and is a no-op within the cooldown). |
| 5 | Review performance bottlenecks for 150–200 concurrent users; unmanaged calls will crash the proxy. | Add single-flight dedupe, cooldown gating, activation jitter, and remove the window-focus refresh. Steady-state load drops to **1 call per user per `refreshIntervalSeconds`** (default 300s). |

## 3. Assumptions & decisions to confirm

- **A1 — Proxy supports `/v2/user/info`.** Feedback #2 says "only `/v2/user/info`," so the `/key/info` fallback is removed. This requires the deployed LiteLLM proxy to expose `/v2/user/info` (the v2 "lightweight" endpoint). If any target deployment is on an older proxy without it, this breaks. **Confirm all target proxies support `/v2/user/info`.** (Fallback kept only as an option, off by default — see "Open question" below.)
- **A2 — Users are provisioned with `budget_duration=30d`.** Then `/v2/user/info.spend` == rolling 30-day spend. Without a `budget_duration`, `spend` is lifetime cumulative and the "%" label is meaningless. UI will handle `max_budget == null` gracefully (show spend without %) and label the value as "Current Budget Spend" + show `budget_duration`/`budget_reset_at` so it is never misread as a calendar month.
- **A3 — Cooldown == configured `refreshIntervalSeconds` (floor 60s).** The manual `Refresh` command is also gated: if called within the cooldown it does **not** fire and shows an info message ("Refreshed recently; next refresh in Ns"). If you'd prefer manual Refresh to bypass the cooldown (still single-flighted), say so — it's a one-line toggle.
- **A4 — One allowed cooldown bypass: connection change.** When `apiBase`/`apiKey` actually changes, we reset the cooldown and fire once so the new endpoint is queried promptly. This is a state transition, not a "recall," so it does not violate feedback #3.
- **A5 — Remove `aggregateUsage`, `fetchSpendLogs`, `fetchUserInfo`, and their types/helpers** (`SpendLogEntry`, `DailySpend`, `ModelSpend`, `UsageSummary`, `today`, `startOfMonth`) from `litellmClient.ts` since nothing uses them after `/spend/logs` is gone. Keeps the client lean and removes dead tests. Confirm you're OK losing the (now-unused) `/user/info` key-list capability.

### Open question
Keep `/key/info` as a hidden fallback behind a setting (e.g. `litellm.fallbackToKeyInfo`, default `false`)? Recommended: **no** — matches feedback #2 and reduces code/branching. Only add it if A1 cannot be guaranteed.

## 4. Proposed changes (by file)

### `src/litellmClient.ts`
- Keep: `LiteLLMHttpError`, `requestJson`/`requestJsonWithRetry`/`httpGet` (retry layer unchanged), `fetchBudgetInfo`.
- `fetchBudgetInfo`: call **only** `GET /v2/user/info`. Remove the `try/catch` `/key/info` fallback. Map response to `BudgetInfo`:
  - `spend` ← `spend` (default 0)
  - `maxBudget` ← `max_budget` (null ok)
  - `budgetResetAt` ← `budget_reset_at` (null ok)
  - `budgetDuration` ← `budget_duration` (null ok) — **new field**
  - `userAlias` ← `user_alias` (null ok)
  - `source` ← `'/v2/user/info'` (kept for tooltip transparency)
- Extend `BudgetInfo` interface with `budgetDuration: string | null` and `userAlias: string | null`.
- Remove: `fetchSpendLogs`, `aggregateUsage`, `fetchUserInfo`, `UserInfo`/`UserBudgetInfo`/`KeyInfo`/`SpendLogEntry`/`DailySpend`/`ModelSpend`/`UsageSummary`, `today`, `startOfMonth`.

### `src/extension.ts` — central `refresh()` with throttle + single-flight
Add module state:
```
let lastBudgetInfo: BudgetInfo | undefined;
let lastFetchAt = 0;            // ms epoch of last successful/failed fetch
let inFlight: Promise<BudgetInfo> | undefined;   // single-flight guard
```
New `refresh(opts?: { force?: boolean }): Promise<BudgetInfo | undefined>`:
1. If `inFlight` → `return inFlight` (dedupe concurrent callers).
2. If `!force && lastFetchAt > 0 && (now - lastFetchAt) < intervalMs` → return cached `lastBudgetInfo` (no call).
3. Else start the fetch, set `inFlight`, on settle set `lastFetchAt = now` and `lastBudgetInfo = result`, clear `inFlight`. Errors update `lastFetchAt` too (so a failed call still counts toward cooldown to avoid retry storms) and surface in the status bar (no error toast spam — at most one toast per settle).

`updateStatusBar()` becomes: read `lastBudgetInfo`; if absent/needs render, call `refresh()` (gated). Rendering (icon/percentage/tooltip) is split into a pure `renderStatusBar(budgetInfo | undefined)` so cache-only renders never trigger fetches.

`showSpendDetails()` (status-bar click / command):
- No direct fetch. Call `refresh()` (gated). If cache fresh → 0 calls. If empty → shares the pending first fetch.
- Remove the two `fetchSpendLogs` calls and the "Today's Spend"/"Monthly Spend (logs)" rows.
- New popup content (from cached `BudgetInfo` only):
  - Current Budget Spend: `$X.XX`
  - Budget Limit: `$max_budget` (omit row if null)
  - Budget Used: `NN.N%` (omit if no max_budget)
  - Budget Window: `budget_duration` (e.g. `30d`) — omit if null
  - Resets At: `budget_reset_at` localized — omit if null
  - API Base: `conn.apiBase`
  - Actions: Open Usage Dashboard / Refresh / Open Settings (unchanged)

`litellm.refresh` command: call `refresh()` (gated). If within cooldown → `vscode.window.showInformationMessage('LiteLLM: Refreshed recently; next refresh in Ns.')` and do **not** fire. (Per A3.)

`activate()`:
- Schedule the first `refresh()` with **jitter**: `setTimeout(() => refresh({ force: true }), random(0, JITTER_MS))` where `JITTER_MS = 10_000` (spread 200 users' first hit across 10s; first display still appears within ~10s). Document `JITTER_MS` in `constants.ts`.
- Periodic timer: `setInterval(() => refresh(), intervalMs * 1000)`. (No longer calls `updateStatusBar` directly; `refresh` updates cache + triggers render.)
- **Remove** `vscode.window.onDidChangeWindowState` refresh entirely (this was the biggest multiplier).
- `onDidChangeConfiguration('litellm')`:
  - If `apiBase`/`apiKey` changed → `lastBudgetInfo = undefined; lastFetchAt = 0;` then `refresh({ force: true })` (one call for the new endpoint — A4).
  - If only `refreshIntervalSeconds` changed → reschedule timer; do not fetch.
  - If only soft-thresholds changed → `renderStatusBar(lastBudgetInfo)` from cache; do not fetch.

`deactivate()`: clear timer, clear `inFlight` (let it resolve/ignore), reset state.

### `src/usagePanel.ts` — repurpose the dashboard (no `/spend/logs`)
- `refresh(apiBase, apiKey)` now calls `fetchBudgetInfo` (via the shared `refresh` in extension? No — panel is independent). To keep one source of truth, the panel will accept a `BudgetInfo` snapshot from the extension and render it (no own API call). `createOrShow` signature changes to `createOrShow(budgetInfo: BudgetInfo, apiBase: string, productName: string)`.
- Dashboard content (single screen, from `BudgetInfo`):
  - Card: Current Budget Spend `$X.XXXX`
  - Card: Budget Limit `$max_budget` or "—"
  - Card: Budget Used `NN.N%` with ASCII bar (reuse `buildBudgetBar`)
  - Card: Resets At (localized) + Budget Window (`budget_duration`)
  - Footnote: API Base, data source `/v2/user/info`, "Refreshed every Ns".
- Remove all `/spend/logs`, `aggregateUsage`, daily/model tables, `UsageSummary` usage.

### `src/constants.ts`
- Add `ACTIVATION_JITTER_MS = 10_000`.
- (Keep `DEFAULT_REFRESH_INTERVAL_SECONDS=300`, `REFRESH_INTERVAL_FLOOR_SECONDS=60`.)

### `src/config.ts`
- No structural change. Keep `getRefreshIntervalSeconds`, `getSoftBudgetThresholds`, `getConnectionConfig`. (Soft thresholds remain as a secondary visual cue; hard-budget % takes precedence — already the case.)

### `package.json`
- Update `description` from "daily and monthly LLM usage" → "current LiteLLM budget spend and usage".
- Commands unchanged (`showUsage`, `showSpendDetails`, `refresh`) — keep command IDs stable for users.
- (Optional) add `litellm.fallbackToKeyInfo` bool default false **only** if A1 needs the safety net.

### Docs
- `README.md` / `CHANGELOG.md` / `IMPLEMENTATION.md`: document the single-endpoint model, throttle behavior, load profile, and the removal of daily/model tables and `/spend/logs`.
- `REVIEW.md`: leave as-is (historical) or append a "Resolved in v1.0.2" note.

## 5. API-call budget & performance analysis

**Before (v1.0.0), per user, per session:**
- 1 on activate (`/v2/user/info`)
- 1 on **every** window-focus event (`onDidChangeWindowState`) — can be many/min
- 2 `/spend/logs` on every status-bar click
- 2 `/spend/logs` on every dashboard open
- 1 `/key/info` fallback possibility
- 1 on every manual Refresh (cache cleared first)
At 200 users actively switching windows: focus events alone → potentially **thousands of calls/min**. This is the crash vector.

**After (v1.0.2), per user:**
- 1 on activate (jittered across ≤10s)
- 1 per `refreshIntervalSeconds` (default 300s) from the timer
- 0 for status-bar clicks, pop-up, dashboard open (cache hits)
- 0 for window-focus (handler removed)
- 1 on a genuine connection-config change
- Manual Refresh: 0 if within cooldown, else 1 (and deduped)

**Steady-state aggregate:** 200 users × 1 call / 300s ≈ **0.67 calls/sec** to `/v2/user/info` — trivial for the proxy. Worst-case burst is the jittered activation: ≤200 calls spread over 10s ≈ 20 calls/sec for one second — sustainable, and only at startup.

**Other safeguards retained:** 15s request timeout, retry only on 5xx/timeout/network (max 2, 1s/2s backoff), no retry on 4xx — unchanged, so transient storms still self-limit.

## 6. Test plan

### `src/test/litellmClient.test.ts` (unit)
- Remove `aggregateUsage` / `today` / `startOfMonth` tests (functions deleted).
- Add `fetchBudgetInfo` parsing tests using a stubbed `httpGet` (inject a fake `/v2/user/info` JSON) covering:
  - happy path (`spend`, `max_budget`, `budget_reset_at`, `budget_duration`, `user_alias`)
  - null `max_budget` / null `budget_reset_at` / null `budget_duration`
  - missing fields default safely
  - HTTP error propagates as `LiteLLMHttpError` (no `/key/info` fallback attempted)

### `src/test/integration/litellm.integration.test.ts`
- Remove `fetchSpendLogs` and `fetchUserInfo` describe blocks.
- Replace with a `fetchBudgetInfo` test against a live `/v2/user/info` (skipped when `LITELLM_API_BASE` unset), asserting numeric `spend`, optional `maxBudget`, `source === '/v2/user/info'`.

### `src/test/httpClient.unit.test.ts`
- Keep retry/timeout behavior tests (unchanged).

### New: `src/test/refreshThrottle.unit.test.ts` (unit, no VS Code)
- Extract the throttle/single-flight logic into a pure, injectable helper (e.g. `makeRefreshController(intervalMs, now, fetcher)`) so it's testable without VS Code. Tests:
  - First call fires.
  - Second call within cooldown returns cache, no new fetch.
  - Concurrent calls share one in-flight promise (single-flight).
  - `force: true` bypasses cooldown.
  - After cooldown elapses, next call fires.
  - Failed fetch still sets `lastFetchAt` (no immediate retry storm).

### E2E (`src/test/e2e/suite/extension.test.ts`)
- Keep activation + command-registration checks. Add: status bar text reflects cached spend without issuing a call on click (assert via a spy/injected fetcher if feasible within test-electron; otherwise document as manual).

## 7. Out of scope for v1.0.2
- Reintroducing per-day/per-model breakdown (would require `/spend/logs` or a new aggregated endpoint — deferred).
- Changing the retry/timeout policy.
- Adding a `litellm.fallbackToKeyInfo` setting (only if A1 cannot be guaranteed).
- Marketplace publish workflow changes.

## 8. Risks
- Removing `/key/info` fallback breaks deployments without `/v2/user/info` (mitigated by A1 confirmation).
- Cooldown-gating manual Refresh may surprise users who expect instant refresh (mitigated by info message + A3 toggle).
- "Current Budget Spend" ≠ calendar-month spend if `budget_duration` isn't 30d (mitigated by labeling + showing `budget_duration`/`budget_reset_at`).
- Repurposing the dashboard removes daily/model tables some users may rely on (acceptable per feedback #1; command IDs kept stable).

## 9. Implementation order (after approval)
1. Refactor `litellmClient.ts` (single endpoint, drop logs/types).
2. Extract `makeRefreshController` + unit tests.
3. Rewire `extension.ts` (gated `refresh`, jitter, remove focus handler, new pop-up, config-change policy).
4. Repurpose `usagePanel.ts` to render `BudgetInfo`.
5. Update `constants.ts`, `package.json`, docs.
6. Update/add tests; run `npm run compile && npm test`.
7. Update `CHANGELOG.md` under `[1.0.2]`; bump `package.json` version to `1.0.2`.
