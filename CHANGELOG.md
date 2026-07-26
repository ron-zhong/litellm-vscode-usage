# Changelog

All notable changes to the **LiteLLM Usage** VS Code extension are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.1] — Status bar shows current calendar-month spend

### Changed
- Status bar spend badge now displays the **current calendar-month spend**, computed by summing `/spend/logs` entries from the first of the month through today, instead of the cumulative `spend` field from `/v2/user/info`. This makes the badge consistent with the Usage Dashboard and the spend-details "Monthly Spend" row.
- `updateStatusBar()` now issues two parallel requests per refresh: `fetchBudgetInfo` (for `max_budget` / `budget_reset_at`) and `fetchSpendLogs(startOfMonth(), today())` (for the displayed month spend). Both run via `Promise.all`, so refresh latency is unchanged.
- Budget percentage, hard-budget thresholds (yellow ≥80% / red ≥100%), and soft-budget thresholds now key off the calendar-month spend for internal consistency with the displayed number.
- Status bar tooltip now reads "monthly spend … (% used this month)" to make the spend window explicit.

### Fixed
- Resolved the spend discrepancy where the status bar and the spend-details "Current Spend" row showed the cumulative `/v2/user/info` `spend` (e.g. $0.30) while the dashboard showed the calendar-month spend (e.g. $0.20). The `/v2/user/info` `spend` is cumulative and is only reset by the server's `budget_duration` cycle, not at the calendar-month boundary, so it does not represent the current month.
- Removed the redundant "Current Spend" row (cumulative `/v2/user/info` spend) from the spend-details quick-pick popup, which previously sat beside the "Monthly Spend" row and caused confusion.

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

[1.0.1]: https://github.com/ron-zhong/litellm-vsix/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/ron-zhong/litellm-vsix/compare/v0.2.0...v1.0.0
[0.2.0]: https://github.com/ron-zhong/litellm-vsix/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ron-zhong/litellm-vsix/releases/tag/v0.1.0
