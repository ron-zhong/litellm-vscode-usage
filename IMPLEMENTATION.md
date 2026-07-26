# LiteLLM Usage Extension - Refactoring Plan

This document reviews the current implementation against REQUIREMENT.md and defines a concrete refactoring roadmap.

## 1) Executive Summary

Current implementation is a working Phase 1 baseline, but is not aligned with most of the agreed requirement scope yet.

- Implemented partially:
  - Status-bar spend refresh loop and manual refresh command.
  - Config precedence for API base/key (setting overrides env).
  - Spend details quick-pick scaffold.
  - Basic usage dashboard webview.
- Major gaps:
  - Prerequisite startup notification, default model setting, and branding templating.
  - Budget logic and API source mismatches for status bar and details popup.
  - Commit message generation feature (Phase 2.1) missing.
  - Dashboard architecture for 3 scopes + sessions lazy drill-down missing.
  - VS Code Chat/Claude Code model-provider integration (Phase 3) missing.
  - Reliability requirements missing: retry/backoff, focus refresh, robust offline handling.

Recommendation: execute refactor in 4 milestones (Foundation -> Phase 1 compliance -> Phase 2 -> Phase 3), with acceptance-test checkpoints per milestone.

---

## 2) Requirement Alignment Review

Legend:
- Done: implemented and aligned with requirement intent.
- Partial: implemented but behavior/API/UX differs from requirement.
- Missing: not implemented.

### 2.1 Prerequisites

1. Startup notification once per session -> Missing
2. Connection settings precedence (setting > env) -> Done
3. Default model setting + env fallback -> Missing
4. OpenAPI-backed API usage alignment -> Partial
5. Author-defined refresh floor constant + package.json minimum sync -> Partial

### 2.2 Packaging & Branding

1. Product-name templating from package metadata -> Missing
2. Marketplace icon and webview logo path support -> Missing

### 2.3 Phase 1.1 Status-bar Spend Badge

1. Spend displayed as USD 2 decimals -> Partial (shows 4 decimals when amount < 1)
2. Soft budget thresholds (200/500/1000) exposed in settings -> Missing
3. Soft budget visual states with codicons/background colors -> Missing
4. Hard budget state using /key/info with 80% and 100% thresholds -> Missing
5. Hard-over-soft precedence -> Missing
6. Required fields from /key/info -> Missing (currently uses /user/info)

### 2.4 Phase 1.2 Spend Details Popup

1. Trigger from status bar click -> Done
2. Content includes today + monthly + reset date -> Partial (monthly derived from total spend, not month aggregation)
3. Budget % only when max_budget exists -> Partial (label always shown as "No budget limit set")

### 2.5 Phase 2.1 Commit Message Generation

1. SCM input button contribution -> Missing
2. Default model behavior and error text -> Missing
3. POST /chat/completions with git diff context -> Missing
4. API error handling preserving SCM input -> Missing

### 2.6 Phase 2.2 Usage Dashboard

1. Three scopes (today / month / 6 months) with metrics + model breakdown -> Partial
2. Single-call summarize strategy per scope -> Missing
3. Initial load <= 3 spend calls -> Partial
4. Reload Today button (single-call refresh) -> Missing
5. No auto-polling -> Done
6. Sessions tab grouped by session_id via /spend/logs/v2 -> Missing
7. Session detail lazy fetch -> Missing
8. Request detail lazy fetch -> Missing

### 2.7 Phase 3.1 Model Provider & Coding Agent Integration

1. One-click VS Code Chat configuration command -> Missing
2. Predefined default models + user overrides -> Missing
3. Model discovery from /v1/models or /model/info -> Missing
4. Claude Code endpoint/model configuration flow -> Missing

### 2.8 Non-functional Requirements

1. Refresh on interval + window focus regain -> Partial
2. Error handling: non-blocking notification + status icon tooltip -> Partial
3. Retry policy (5xx/timeouts retry x2 with 1s/2s backoff) -> Missing
4. Offline state cloud-offline on unreachable proxy -> Partial
5. Multi-workspace config scoping -> Done (via workspace configuration API)
6. Dashboard performance and pagination strategy -> Missing
7. Settings sync handling for apiKey scope machine guidance -> Missing

---

## 3) Refactoring Strategy

### Milestone A - Foundation and Contracts (P0)

Goal: establish clean architecture and settings contract before feature expansion.

Tasks:

1. Introduce centralized constants/config module
	- Product name resolver from package metadata.
	- Refresh floor constant (single source of truth).
	- Soft budget default constants (standard/pro/max).

2. Expand package.json configuration contract
	- Add litellm.defaultModel.
	- Add soft budget setting keys.
	- Align litellm.refreshIntervalSeconds minimum with code constant.
	- Set litellm.apiKey scope to machine (or document if tooling constraint).

3. Build resilient HTTP client abstraction
	- Support GET and POST.
	- Classify network errors/timeouts/HTTP 4xx/5xx.
	- Add retry policy: retry 5xx + timeout only, max 2 retries, backoff 1s then 2s.
	- Normalize API error messages for notifications.

4. Endpoint contract cleanup
	- Add typed clients for /key/info, /spend/logs summarize, /spend/logs/v2, /global/spend/report, /chat/completions, /v1/models and /model/info.
	- Preserve backward compatibility with existing /user/info only where explicitly needed.

Acceptance gate:
- Unit tests for retry logic and endpoint parsers added and passing.

### Milestone B - Phase 1 Compliance (P0)

Goal: fully align monitor UX and data semantics.

Tasks:

1. Activation UX
	- Show "LiteLLM spend monitor is running." exactly once per session.

2. Status-bar logic rewrite
	- Always show spend as 2 decimals.
	- Default icon: $(radio-tower).
	- Compute soft/hard states separately and apply precedence hard > soft.
	- Hard budget from /key/info max_budget with thresholds:
	  - >=80% -> warning yellow + $(warning)
	  - >=100% -> error red + $(circle-slash)
	- Soft thresholds from settings defaults:
	  - >standard -> warning yellow + $(warning)
	  - >pro -> error red + $(error)
	- Keep max tier value available for future UI messaging.

3. Spend details popup correctness
	- Today spend: /spend/logs for today range.
	- Monthly spend: sum month range from /spend/logs (or /global/spend/report).
	- Reset date: /key/info budget_reset_at.
	- Show budget percentage row only if max_budget > 0.

4. Refresh behavior
	- Enforce hardcoded floor in runtime clamp.
	- Refresh on focus regain (window state listener).

Acceptance gate:
- Requirement Phase 1 acceptance checklist fully green.

### Milestone C - Phase 2 Features (P1)

Goal: complete commit generation and dashboard functional scope.

Tasks:

1. Commit message generator
	- Add command + scm/inputBox menu contribution.
	- Collect staged + unstaged diff.
	- Resolve model via setting/env precedence.
	- POST /chat/completions with prompt template and diff context.
	- Insert generated message into SCM input box.
	- On missing model show exact actionable error text from requirement.

2. Dashboard architecture redesign
	- Add tabbed spend scopes: Today / This Month / All Time (last 6 months).
	- Initial load: max 3 calls total (today, month, six-month scope).
	- Use summarize=true or /global/spend/report grouped call(s) for aggregated model stats.
	- Add explicit "Reload Today" action (1 call only).
	- Include successful/failed counts and token breakdown (prompt/completion/total).

3. Sessions and request drill-down
	- Sessions tab lazy-loads /spend/logs/v2 grouped by session_id for six-month window.
	- Clicking a session triggers lazy paginated fetch by session_id.
	- Clicking request opens detail with prompt/response/tokens/model when available.

Acceptance gate:
- Phase 2 acceptance checklist fully green.

### Milestone D - Phase 3 Integration (P1/P2)

Goal: implement provider setup and Claude Code integration.

Tasks:

1. VS Code Chat setup command
	- One command configures custom endpoint flow for LiteLLM provider.

2. Model discovery + defaults
	- Discover models via /v1/models or /model/info.
	- Predefined defaults in package settings/build constant.
	- User override settings for VS Code Chat and Claude Code models.

3. Claude Code integration
	- Detect Claude Code installation.
	- Manage ~/.claude/settings.json endpoint/model fields safely.
	- Optional plugin endpoint integration via /claude-code/plugins.
	- Provide model picker UI backed by discovered models.

Acceptance gate:
- Phase 3 acceptance checklist fully green.

---

## 4) File-Level Refactoring Plan

### src/config.ts

- Extend to include defaultModel resolution.
- Add product name helper and refresh floor helper.
- Expose budget threshold getters with validated/clamped values.

### src/litellmClient.ts

- Split into:
  - core/httpClient.ts (request, retry, timeout, error normalization)
  - clients/keyInfoClient.ts
  - clients/spendClient.ts
  - clients/chatClient.ts
  - clients/modelsClient.ts
- Keep an index facade for compatibility where needed.

### src/extension.ts

- Extract status bar state machine into dedicated module.
- Add startup session notification.
- Add focus-regain refresh listener.
- Register commit generation command.
- Replace hardcoded "LiteLLM" strings with product name helper.

### src/usagePanel.ts

- Move from static HTML snapshot to message-driven webview with scripts enabled.
- Implement tab model + explicit reload actions + lazy session/request fetch.
- Add 6-month scope constraints in query builder.

### package.json

- Add new settings and scopes.
- Add scm/inputBox menu action.
- Add commands for commit generation and provider setup.
- Add icon field and branding notes.

### src/test/*

- Add unit tests for:
  - status-bar state precedence,
  - refresh floor clamp,
  - retry/backoff behavior,
  - monthly/today spend calculations,
  - commit-message command behavior.
- Add integration tests for endpoints and error classes.
- Expand E2E tests for new commands and visible UI command registration.

---

## 5) Priority Matrix

P0 (must do first):
- Milestone A and B.
- Retry/offline/error and status-bar correctness.

P1:
- Milestone C complete.

P2:
- Milestone D provider/Claude integration hardening and UX polish.

---

## 6) Delivery Sequence and Risk Controls

1. Land Foundation (A) behind internal module boundaries.
2. Land Phase 1 compliance (B) with golden tests.
3. Land commit generator (C1) independently from dashboard redesign.
4. Land dashboard redesign (C2/C3) with strict API-call budget tests.
5. Land provider integrations (D) in feature flags if needed.

Risk controls:
- Add snapshot tests for status-bar text/icon combinations.
- Add API-call counting tests in dashboard data loader.
- Keep backward-compatible command IDs to avoid breaking users.

---

## 7) Definition of Done

All items are done when:

1. Every acceptance criterion in REQUIREMENT.md is demonstrably satisfied.
2. Unit, integration, and E2E suites pass.
3. No uncaught promise rejections during command execution and polling.
4. README and changelog are updated with new settings and commands.
5. Manual smoke tests verify:
	- no-config onboarding,
	- env-only config,
	- settings-over-env precedence,
	- offline behavior,
	- commit generation insertion,
	- dashboard API-call budget,
	- VS Code Chat + Claude Code setup flows.

