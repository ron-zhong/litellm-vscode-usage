# Changelog

All notable changes to the **LiteLLM Usage** VS Code extension are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.3] — UI polish, force-refresh, and 30-day dashboard bar chart

### Changed
- **Status-bar icon reverted** to `$(graph)` (the v0.1.0/v0.2.0 icon), replacing the `$(radio-tower)` introduced in v1.0.0.
- **Manual `Refresh` now force-reloads** the current spend (`GET /v2/user/info`), bypassing the cooldown. It refreshes the **budget only** — it does not refresh the dashboard 30-day chart. Single-flight still dedupes concurrent clicks.
- **Pop-up trimmed:** removed Budget Window, API Base, and Data Source rows.
- **Dashboard trimmed:** removed Budget Duration, API Base, and Data Source; Budget Limit and Budget Used are now hidden entirely (not shown as "—") when no budget is set.
- **Dashboard "Past 30 Days Spend"** vertical bar chart added, built from a single `GET /spend/logs?summarize=true` call (one row per day), rendered as a CSS bar chart (no scripts). Oldest → newest (left → right), latest day on the right.

### Added
- **Build-time admin switch** `DASHBOARD_BREAKDOWN_ENABLED` (in `src/constants.ts`, default `true`): lets the system admin disable the 30-day breakdown (and its `/spend/logs` call) when packaging the extension for performance-sensitive deployments.
- **Daily cache for dashboard logs:** the 30-day series is fetched at most **once per calendar day per user** (on dashboard open). Once loaded, it is not re-fetched until the next day. Failures are not cached, so the next open can retry. It is never triggered by the periodic timer or the Refresh command.
- `fetchSpendLogsSummarized`, `buildDailySeries`, and date helpers in `litellmClient.ts`; unit tests for the 30-day series and the summarized-log parser.

### Fixed
- Steady-state proxy load unchanged from v1.0.2 for the budget path; the logs path adds at most one small call per user per day (and is disable-able via the admin switch).

### Security
- `npm audit` reports 0 vulnerabilities.

---

## [1.0.2] — Single-endpoint, throttle-protected spend monitor

### Changed
- **Single data source:** the extension now uses `GET /v2/user/info` only for spend and budget data. The `/key/info` fallback and all `/spend/logs` calls have been removed. `BudgetInfo` now also carries `budgetDuration` and `userAlias`.
- **Throttle + single-flight:** all API access goes through one cooldown-gated, single-flight `refresh()` (`src/refreshController.ts`). Concurrent UI actions share a single in-flight request, and re-fetching is blocked for `refreshIntervalSeconds` while data is fresh.
- **Status bar / pop-up / dashboard render from cache** and issue no API calls of their own when data is fresh. The pop-up and dashboard now show the current budget-window spend, budget limit, % used (with bar), budget window, and reset date.
- **Manual `Refresh` is cooldown-gated:** if called recently it informs the user when the next refresh is allowed instead of firing.
- **Activation jitter:** the first fetch is delayed by up to 10s (`ACTIVATION_JITTER_MS`) so 150–200 workspaces starting together don't hit the proxy in the same second.

### Removed
- `fetchSpendLogs`, `aggregateUsage`, `fetchUserInfo`, and their types/helpers (`SpendLogEntry`, `DailySpend`, `ModelSpend`, `UsageSummary`, `today`, `startOfMonth`) are deleted as unused.
- The `vscode.window.onDidChangeWindowState` refresh handler (was the largest call multiplier).
- The dashboard's daily and per-model spend tables (they came from `/spend/logs`).

### Fixed
- Steady-state proxy load reduced to ~1 call per user per refresh interval (default 300s). Failed fetches advance the cooldown to prevent retry storms; error toasts fire only on a success→error transition.

### Security
- `npm audit` reports 0 vulnerabilities.

---

## [1.0.0] — Phase 1 milestone release

### Added
- Startup activation notification: "LiteLLM spend monitor is running."
- Soft budget settings with defaults exposed in extension configuration:
	- `litellm.softBudgetStandardUsd` (200)
	- `litellm.softBudgetProUsd` (500)
	- `litellm.softBudgetMaxUsd` (1000)
- `litellm.defaultModel` setting added for upcoming commit-message workflow.
- Focus-regain refresh behavior for status bar updates when the VS Code window becomes active.
- Product name templating in Phase 1 UI by reading extension `displayName`.

### Changed
- Extension version updated from 0.2.0 to 1.0.0.
- Status bar spend formatting now consistently uses 2 decimal places.
- Status bar visual state logic now supports both soft-budget and hard-budget thresholds with hard-budget precedence.
- Hard-budget source changed to use `/v2/user/info` first, with `/key/info` fallback for compatibility.
- Spend details popup now computes:
	- today's spend from today's `/spend/logs` range,
	- monthly spend from start-of-month through today,
	- budget usage row only when `max_budget` is configured.
- Refresh interval minimum raised from 30 seconds to 60 seconds and enforced both in settings schema and runtime clamp logic.

### Fixed
- Offline/connection failure status handling now shows `$(cloud-offline)` with clearer tooltip diagnostics.
- HTTP client reliability improved with transient retry policy:
	- retries on 5xx, timeout, and network errors,
	- no retries on 4xx,
	- exponential backoff at 1s then 2s.
- Updated unit-test timeout to account for retry backoff behavior in transient error scenarios.

### Security
- `litellm.apiKey` configuration scope set to `machine` to reduce secret-sync risk in Settings Sync.

---

## [0.2.0] — Fix package vulnerabilities

### Added
- Unit tests using a real local HTTP mock server for `fetchUserInfo` and `fetchSpendLogs`.
- Integration test suite (`npm run test:integration`) that runs against a live LiteLLM proxy and skips gracefully when `LITELLM_API_BASE` is not set.
- End-to-end test suite (`npm run test:e2e`) using `@vscode/test-electron` that verifies extension activation and command registration inside a real VS Code instance.
- GitHub Actions workflows: CI (`ci.yml`), CodeQL SAST (`codeql.yml`), and automated marketplace publish (`publish.yml`).
- Dependabot configuration for weekly npm and GitHub Actions dependency updates.
- `CONTRIBUTING.md` developer guide, including a post-lint security-audit step that runs `npm audit` and requires zero CRITICAL/HIGH vulnerabilities before a PR can merge.
- `CHANGELOG.md` (this file).

### Security
- Added an npm `overrides` block forcing `brace-expansion` (`^5.0.8`) and `serialize-javascript` (`^7.0.5`) to eliminate high-severity transitive vulnerabilities pulled in via mocha; `npm audit` now reports 0 vulnerabilities. Preferred over `npm audit fix --force`, which would have downgraded mocha to 8.1.3.

---

## [0.1.0] — Initial release

### Added
- Status-bar spend badge showing the current monthly LiteLLM spend, refreshed on a configurable interval.
- `LiteLLM: Show Current Spend Details` quick-pick popup with budget bar, today's spend, reset date, and user ID.
- `LiteLLM: Show Usage Dashboard` webview with daily and model-level spend tables.
- `LiteLLM: Refresh Status Bar` command to force-refresh spend data.
- Settings: `litellm.apiBase`, `litellm.apiKey`, `litellm.refreshIntervalSeconds`.
- Fallback to `LITELLM_API_BASE` / `LITELLM_API_KEY` environment variables.
- Unit tests for `aggregateUsage`, `today`, and `startOfMonth`.

[1.0.3]: https://github.com/ron-zhong/litellm-vsix/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/ron-zhong/litellm-vsix/compare/v1.0.0...v1.0.2
[1.0.0]: https://github.com/ron-zhong/litellm-vsix/compare/v0.2.0...v1.0.0
[0.2.0]: https://github.com/ron-zhong/litellm-vsix/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ron-zhong/litellm-vsix/releases/tag/v0.1.0
