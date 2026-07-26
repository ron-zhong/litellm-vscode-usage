# Implementation Log

## Scope Completed

Completed scope: Phase 1 through Milestone A and Milestone B only.

User-approved implementation decisions applied:

1. Refresh floor is hardcoded to 60 seconds.
2. Hard-budget source uses /v2/user/info first, then falls back to /key/info for compatibility.

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
