# Implementation Log

## Scope Completed

Completed scope: Phase 1 through Milestone A and Milestone B only, plus the 1.0.1 status-bar monthly-spend correction.

User-approved implementation decisions applied:

1. Refresh floor is hardcoded to 60 seconds.
2. Hard-budget source uses /v2/user/info first, then falls back to /key/info for compatibility.
3. Status bar and spend-details popup display the current **calendar-month** spend (summed from `/spend/logs`), not the cumulative `/v2/user/info` `spend`, which is only reset by the server's `budget_duration` cycle.

---

## Milestone A (Foundation and Contracts) - Implemented

### 1) Shared constants module

Implemented in src/constants.ts:

- DEFAULT_REFRESH_INTERVAL_SECONDS = 300
- REFRESH_INTERVAL_FLOOR_SECONDS = 60
- SOFT_BUDGET_DEFAULT_STANDARD = 200
- SOFT_BUDGET_DEFAULT_PRO = 500
- SOFT_BUDGET_DEFAULT_MAX = 1000
- STARTUP_NOTIFICATION_TEXT = "LiteLLM spend monitor is running."

### 2) Configuration contract helpers

Implemented in src/config.ts:

- getRefreshIntervalSeconds()
	- Reads litellm.refreshIntervalSeconds.
	- Clamps effective interval to the hardcoded 60-second floor.
- getSoftBudgetThresholds()
	- Reads soft-budget settings.
	- Enforces ascending threshold sanity (standard <= pro <= max).

### 3) HTTP reliability layer

Implemented in src/litellmClient.ts:

- LiteLLMHttpError class with transient-failure flags.
- Request wrapper with timeout handling.
- Retry policy for transient failures only:
	- Retries on timeout/network/5xx.
	- Max 2 retries.
	- Exponential backoff: 1s, then 2s.
	- 4xx is not retried.

### 4) Budget endpoint compatibility model

Implemented in src/litellmClient.ts:

- fetchBudgetInfo(apiBase, apiKey)
	- Primary: GET /v2/user/info
	- Fallback: GET /key/info
	- Normalized output fields for spend, max_budget, budget_reset_at and source label.

---

## Milestone B (Phase 1 Compliance) - Implemented

### 1) Startup notification

Implemented in src/extension.ts:

- Shows info notification at activation:
	- "LiteLLM spend monitor is running."

### 2) Status-bar behavior alignment

Implemented in src/extension.ts:

- Spend display uses fixed 2-decimal USD format.
- Default icon uses $(radio-tower).
- Soft-budget visual states:
	- spend > standard -> $(warning) + statusBarItem.warningBackground
	- spend > pro -> $(error) + statusBarItem.errorBackground
- Hard-budget visual states:
	- spend/max_budget >= 80% -> $(warning) + warning background
	- spend/max_budget >= 100% -> $(circle-slash) + error background
- Precedence rule enforced:
	- hard-budget state overrides soft-budget state when both apply.

### 3) Offline and error handling

Implemented in src/extension.ts:

- Unreachable proxy (timeout/network):
	- status bar shows $(cloud-offline)
	- tooltip includes connection failure reason
- Other failures:
	- status bar shows $(warning)
	- tooltip includes failure reason
- User receives non-blocking error notification message.

### 4) Spend details popup correctness

Implemented in src/extension.ts:

- Trigger remains status-bar click via litellm.showSpendDetails.
- Today spend:
	- computed from /spend/logs date range for today.
- Monthly spend:
	- computed by summing /spend/logs from start-of-month through today.
- Reset date:
	- from budget info (primary /v2/user/info, fallback /key/info).
- Budget percentage row:
	- shown only when max_budget > 0.

### 5) Refresh policy

Implemented in src/extension.ts:

- Periodic refresh uses clamped interval from getRefreshIntervalSeconds().
- Configuration changes to refresh interval recreate timer with clamped value.
- Refresh also runs when VS Code window regains focus.

### 6) Product-name templating for Phase 1 UI strings

Implemented in src/extension.ts and src/usagePanel.ts:

- Uses extension displayName from package metadata for user-visible labels and titles.

---

## 1.0.1 — Status bar shows current calendar-month spend

### Background

The status bar badge and the spend-details "Current Spend" row previously displayed the `spend` field from `/v2/user/info` (or the `/key/info` fallback). Per the LiteLLM docs, that field is cumulative and is only reset by the server's `budget_duration` cycle (e.g. `30d`, `7d`, `1d`) — it is **not** reset at the calendar-month boundary, and when no `budget_duration` is configured it is a lifetime total. This caused a visible discrepancy: the badge showed the cumulative figure (e.g. $0.30) while the Usage Dashboard and the "Monthly Spend" row showed the calendar-month figure summed from `/spend/logs` (e.g. $0.20).

### Decision (user-approved)

Focus on the current calendar-month spend in the status bar and spend-details popup, rather than the cumulative spend. The budget-cycle reset behavior of `/v2/user/info` `spend` is being validated separately by the user (a 1-hour `budget_duration` test was configured); if the cycle-vs-month divergence later proves material for the hard-budget warning colors, the threshold logic can be revisited.

### Implemented in src/extension.ts

1. `updateStatusBar()` — monthly spend in the badge
	- Now fetches `fetchBudgetInfo` (for `max_budget` / `budget_reset_at`) and `fetchSpendLogs(startOfMonth(), today())` in parallel via `Promise.all`.
	- Displays `aggregateUsage(monthLogs).totalMonthlySpend` (calendar-month spend) in the badge instead of `budgetInfo.spend`.
	- Budget percentage, `resolveHardBudgetStyle`, and `resolveSoftBudgetStyle` now receive the calendar-month spend so the displayed number, percentage, and warning/error colors are internally consistent.
	- Tooltip updated to "monthly spend … (% used this month)".
	- Added an inline comment documenting why `/v2/user/info` `spend` is not used for display (cumulative; reset only by the server's `budget_duration` cycle).

2. `showSpendDetails()` — removed the cumulative-spend row
	- Removed the `Current Spend : $… (/v2/user/info)` line that showed cumulative spend, which sat beside "Monthly Spend" and caused confusion.
	- Removed the now-unused `spend` local variable.
	- Relabeled the budget-usage line to "…% used this month".
	- Kept the `Resets At` row (sourced from `budgetInfo.budgetResetAt`) since the budget-cycle reset timestamp remains useful.

### Tradeoffs

- One additional API call per status-bar refresh (`/spend/logs` for the month range alongside `/v2/user/info`). Both calls run in parallel, so refresh latency is unaffected.
- Hard-budget warning semantics: the server enforces `max_budget` against the cycle spend (`/v2/user/info`), not the calendar month. The badge now thresholds against monthly spend, so when `budget_duration` does not align with the calendar month the warning colors may not exactly track server-side enforcement. This is accepted pending the user's budget-cycle testing.

### Validation

1. TypeScript compile (`npm run compile`): PASS.
2. Unit tests (`out/test/litellmClient.test.js`, `out/test/httpClient.unit.test.js`): 19 passing.
3. No existing tests asserted on the cumulative-spend display behavior, so nothing regressed.

---

## Package Configuration Updates Applied

Implemented in package.json:

1. litellm.apiKey
	 - Added "scope": "machine".
2. litellm.defaultModel
	 - Added setting entry (for later Phase 2 feature use).
3. litellm.refreshIntervalSeconds
	 - Updated minimum from 30 to 60.
4. Added soft-budget settings:
	 - litellm.softBudgetStandardUsd (default 200)
	 - litellm.softBudgetProUsd (default 500)
	 - litellm.softBudgetMaxUsd (default 1000)

---

## Test and Build Validation

Validation completed after implementation:

1. TypeScript compile: PASS
2. Unit tests: PASS
	 - 19 passing
3. Unit test maintenance update:
	 - Increased fetchSpendLogs suite timeout to account for retry backoff behavior.

Files updated for test support:

- src/test/httpClient.unit.test.ts

---

## Files Changed in Milestone A+B

- src/constants.ts
- src/config.ts
- src/litellmClient.ts
- src/extension.ts
- src/usagePanel.ts
- package.json
- src/test/httpClient.unit.test.ts

---

## Explicitly Not Started Yet

Not implemented in this delivery:

- Phase 2 (commit message generation and dashboard redesign)
- Phase 3 (VS Code Chat / Claude Code integration)

These remain tracked in PLAN.md and can be executed next.

---

## Phase 1 Acceptance Checklist (With Evidence)

Status legend:

- Pass: implemented in code and validated by build/tests where applicable.
- Partial: implemented with a known caveat or requirement deviation.

### Prerequisites

1. Startup notification appears exactly once per session
- Status: Pass
- Evidence:
	- Activation notification call: [src/extension.ts](src/extension.ts#L250)
	- Activation entrypoint: [src/extension.ts](src/extension.ts#L242)

2. Env-only config works when settings are unset
- Status: Pass
- Evidence:
	- Setting-over-env resolution for API base and key: [src/config.ts](src/config.ts#L28)

3. Settings override env vars
- Status: Pass
- Evidence:
	- Precedence implementation: [src/config.ts](src/config.ts#L28)

4. litellm.defaultModel appears in Settings UI
- Status: Pass
- Evidence:
	- Added config property: [package.json](package.json#L44)

5. Refresh floor clamp enforced
- Status: Pass
- Evidence:
	- Runtime clamp function: [src/config.ts](src/config.ts#L46)
	- Refresh interval minimum in settings schema: [package.json](package.json#L49)
	- Timer uses clamped value: [src/extension.ts](src/extension.ts#L285)

### Packaging and Branding (Phase 1 Relevant)

1. Product name string templating via displayName
- Status: Pass
- Evidence:
	- Load displayName at activation: [src/extension.ts](src/extension.ts#L243)
	- Dashboard title uses injected product name: [src/usagePanel.ts](src/usagePanel.ts#L30)

2. Marketplace icon support
- Status: Partial
- Notes:
	- Not added yet in this Phase 1 delivery.

### Phase 1.1 Status-bar Spend Badge

1. Spend badge shows USD with 2 decimals
- Status: Pass
- Evidence:
	- Formatting function: [src/extension.ts](src/extension.ts#L28)

2. Soft budget thresholds are constants + configurable defaults
- Status: Pass
- Evidence:
	- Constants: [src/constants.ts](src/constants.ts#L4)
	- Settings defaults: [package.json](package.json#L55)
	- Runtime reader and normalization: [src/config.ts](src/config.ts#L55)

3. Soft-budget warning/error visuals
- Status: Pass
- Evidence:
	- Warning/error style mapping: [src/extension.ts](src/extension.ts#L37)

4. Hard-budget warning/error visuals
- Status: Pass (with approved endpoint variant)
- Evidence:
	- 80% warning and 100% forbidden state: [src/extension.ts](src/extension.ts#L54)
	- Budget source fetch helper: [src/litellmClient.ts](src/litellmClient.ts#L273)
- Notes:
	- Implementation uses /v2/user/info primary, /key/info fallback per user-approved direction.

5. Hard budget takes precedence over soft budget
- Status: Pass
- Evidence:
	- Precedence application (hardStyle ?? softStyle): [src/extension.ts](src/extension.ts#L100)

6. Data fields include spend, max_budget, budget_reset_at
- Status: Pass
- Evidence:
	- Normalized budget fields: [src/litellmClient.ts](src/litellmClient.ts#L277)
- Notes:
	- As of 1.0.1, `spend` from the budget endpoint is fetched but no longer displayed in the badge or popup; the displayed spend is the calendar-month total summed from `/spend/logs`. `max_budget` and `budget_reset_at` are still used for the budget percentage and reset-date rows.

### Phase 1.2 Spend Details Pop-up

1. Clicking status bar opens spend details popup
- Status: Pass
- Evidence:
	- Status bar command binding: [src/extension.ts](src/extension.ts#L247)
	- Command handler entry: [src/extension.ts](src/extension.ts#L265)

2. Pop-up shows today spend, monthly spend, reset date
- Status: Pass
- Evidence:
	- Today and monthly computation from logs: [src/extension.ts](src/extension.ts#L167)
	- Reset date row: [src/extension.ts](src/extension.ts#L196)
- Notes:
	- As of 1.0.1, the separate "Current Spend" row (cumulative `/v2/user/info` spend) was removed; the popup now shows only the calendar-month "Monthly Spend" row plus reset date, to avoid the cumulative-vs-month discrepancy.

3. Budget % shown only when hard budget exists
- Status: Pass
- Evidence:
	- Conditional budget percent row: [src/extension.ts](src/extension.ts#L184)

### Non-functional Items in Phase 1 Scope

1. Refresh on interval and window focus regain
- Status: Pass
- Evidence:
	- Timer setup: [src/extension.ts](src/extension.ts#L286)
	- Focus listener refresh: [src/extension.ts](src/extension.ts#L313)

2. Retry policy (5xx/timeouts retried, 4xx not retried)
- Status: Pass
- Evidence:
	- Retry eligibility: [src/litellmClient.ts](src/litellmClient.ts#L101)
	- Backoff sequence and retry loop: [src/litellmClient.ts](src/litellmClient.ts#L180)

3. Offline behavior with cloud-offline icon
- Status: Pass
- Evidence:
	- Connection failure offline state: [src/extension.ts](src/extension.ts#L118)

4. apiKey settings sync hardening (machine scope)
- Status: Pass
- Evidence:
	- Machine scope: [package.json](package.json#L41)
