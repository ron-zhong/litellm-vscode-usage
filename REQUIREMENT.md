# Requirement — LiteLLM Usage VS Code Extension

> A VS Code extension that monitors LiteLLM proxy spend in the status bar, generates AI-assisted commit messages, provides a usage dashboard, and one-click configures VS Code Chat / Claude Code to use a LiteLLM proxy as the model provider.
>
> All LiteLLM API definitions referenced below are in `./litellm/openapi.json`.

---

## Glossary

| Term | Definition |
|---|---|
| **Soft budget** | A spend threshold defined inside the extension (not on the LiteLLM server). Used only for visual warnings in the status bar. Does not block requests. |
| **Hard budget** (`max_budget`) | A spend limit configured on the LiteLLM server and returned by the API. Enforced server-side. |
| **API base** | The LiteLLM proxy root URL, e.g. `http://localhost:4000`. |

---

## Prerequisites

1. **Startup notification.** On first install and load, show an information notification: *"LiteLLM spend monitor is running."* (Use `vscode.window.showInformationMessage`.)
2. **Connection settings** — load `LITELLM_API_BASE` and `LITELLM_API_KEY` from system environment variables at activation. These serve as defaults; values set in the extension Settings UI (`litellm.apiBase`, `litellm.apiKey`) override the environment variables. Precedence: **extension setting > environment variable**.
3. **Default model** — load `LITELLM_DEFAULT_MODEL` from the environment variable; overridable via the `litellm.defaultModel` extension setting (same precedence as above). Used in Phase 2.1 to generate commit messages. Add this setting to `package.json` → `contributes.configuration`.
4. **API reference.** All LiteLLM REST endpoints used by this extension are defined in `./litellm/openapi.json`.
5. **Minimum refresh period.** The status-bar refresh interval defaults to `300` seconds (user-configurable via `litellm.refreshIntervalSeconds`). The VSIX author can set a **hardcoded floor** — a minimum refresh period (e.g. `60` seconds) defined as a source-code constant — that cannot be overridden by users. If a user sets `litellm.refreshIntervalSeconds` below this floor, the extension silently clamps the effective interval up to the floor. The `package.json` `minimum` constraint on the setting should also be set to match the floor value so the Settings UI enforces it at input time.

### Acceptance criteria

- [ ] On fresh install, the startup notification appears exactly once per session.
- [ ] With only env vars set (no extension settings), the extension connects successfully.
- [ ] With extension settings set, they take precedence over env vars.
- [ ] `litellm.defaultModel` appears in the Settings UI and is consumed by the commit-message feature.
- [ ] The author-defined minimum refresh period is enforced: when a user sets `litellm.refreshIntervalSeconds` below the floor, the effective interval is clamped to the floor and the status bar does not refresh more frequently than the floor allows.

---

## Packaging & Branding

1. **Custom product name.** The VSIX author can replace the "LiteLLM" trademark in all user-facing UI text (status bar, notifications, dashboard titles, command palette entries) with a preconfigured name (e.g. "My AI Gateway"). Implement by templating the display name from a single `package.json` field (e.g. a custom `displayName` or a build-time token) and referencing it in all string literals.
2. **Custom icon / logo.** The author can supply the marketplace icon and any in-UI logo. Support via the standard `icon` field in `package.json` plus an extension asset path for the webview dashboard.

### Acceptance criteria

- [ ] Changing the configured product name updates all visible UI strings without code edits beyond `package.json`.
- [ ] A custom marketplace icon can be supplied and is displayed on the marketplace listing.

---

# Phase 1 — Status-bar Spend Monitor

## Phase 1.1 — Status-bar spend badge

1. **Display.** Show the current spend in USD in the status bar, bottom-right. Format: `$` followed by the amount to **2 decimal places** (e.g. `$12.34`).
2. **Soft budget thresholds.** Define three soft-budget levels as constants in source code, surfaced as defaults in `package.json` → `contributes.configuration` so users can override them:
   - Standard: `$200`
   - Pro: `$500`
   - Max: `$1000`

   These are visual thresholds only; they do not block requests.
3. **Soft-budget visual states.** Use `$(radio-tower)` as the default status-bar icon (the VS Code codicon set has no `control-tower`; `radio-tower` is the closest available). When spend exceeds:
   - the **standard** soft budget → icon becomes `$(warning)`, text turns **yellow** (`statusBarItem.warningBackground`).
   - the **pro** soft budget → icon becomes `$(error)`, text turns **red** (`statusBarItem.errorBackground`).
4. **Hard-budget visual states.** Load `max_budget` from the LiteLLM `/key/info` API (GET, param `key`). When `max_budget` is configured (> 0):
   - spend ≥ 80% of `max_budget` → status bar **yellow** with `$(warning)` icon.
   - spend ≥ 100% of `max_budget` → status bar **red** with `$(circle-slash)` (forbidden) icon.
5. **Precedence.** When both soft and hard budgets are configured, **hard-budget states take precedence** over soft-budget states (hard budget is authoritative because it is enforced server-side).
6. **Data fields.** From `/key/info` load: `key_alias`, `spend`, `max_budget`, `budget_reset_at`.

### Acceptance criteria

- [ ] Spend badge shows 2-decimal USD amount and refreshes on the configured interval.
- [ ] Soft-budget yellow appears at > $200; red at > $500 (defaults, overridable).
- [ ] Hard-budget yellow appears at ≥ 80%; red + forbidden at ≥ 100%.
- [ ] When both apply, hard-budget state wins.

## Phase 1.2 — Spend details pop-up

1. **Trigger.** Clicking the status bar opens a quick-pick popup.
2. **Content.** Display:
   - Today's spend (summed from `/spend/logs` for today's date).
   - Monthly spend (current calendar month). Note: `/key/info` `spend` is **total** spend, not monthly; compute monthly spend by summing `/spend/logs` entries for the current month, OR use `/global/spend/report` with `start_date` = first of month.
   - Reset date (`budget_reset_at` from `/key/info`, formatted as locale string).
3. **Budget %.** Show budget consumption percentage only when `max_budget` is configured and returned by `/key/info`. Otherwise hide the row.

### Acceptance criteria

- [ ] Pop-up shows today's spend, monthly spend, and reset date.
- [ ] Budget % row appears only when a hard budget exists.

---

# Phase 2 — Commit Message & Usage Dashboard

## Phase 2.1 — Generate commit message

1. **SCM input button.** Add a button to the Source Control input box via the `scm/inputBox` menu contribution point in `package.json`. Clicking it generates a commit message from the current uncommitted diff (`git diff` staged + unstaged) and inserts it into the SCM input box.
2. **Default model.** Use the model from `litellm.defaultModel` (env `LITELLM_DEFAULT_MODEL`). When no default model is configured, show an error notification: *"No default model configured. Set `litellm.defaultModel` or the `LITELLM_DEFAULT_MODEL` environment variable."* and abort.
3. **API call.** POST to `{apiBase}/chat/completions` with the diff as context and the configured model. Parse the response and insert the generated message into the SCM input box.
4. **Error handling.** On API failure, show an error notification with the message and do not modify the input box.

### Acceptance criteria

- [ ] Button appears in the SCM input box.
- [ ] With a default model set, clicking generates and inserts a commit message.
- [ ] With no model set, an actionable error notification appears.

## Phase 2.2 — Usage dashboard

### API call efficiency principles

The dashboard must minimise the number of LiteLLM API calls. In particular:

- **No auto-polling.** The dashboard does not auto-refresh. Data is loaded on open and on explicit user reload. (The status bar continues to auto-refresh on its own interval — that is separate.)
- **Single-call aggregation.** Prefer endpoints that accept a wide date range and return aggregated data over per-day or per-month loops. Specifically:
  - `/spend/logs?start_date=…&end_date=…&summarize=true` returns aggregated results for an arbitrary date range in **one call**.
  - `/global/spend/report?start_date=…&end_date=…&group_by=…` returns spend grouped by model/key/team in **one call**.
- **Lazy drill-down.** Session and request-level detail is fetched on demand only (when the user clicks), not preloaded.
- **6-month history cap.** Historical spend is limited to the **last 6 months** from today. "All Time" in the UI means "last 6 months". No data older than 6 months is fetched or displayed.

### Spend tab (webview)

1. **Three time scopes**: Today, This Month, and All Time (last 6 months). Each shows:
   - Successful vs failed request counts.
   - Token consumption (prompt, completion, total).
   - Spend per model (table + chart).
2. **Today's spend** — fetched from a single `/spend/logs?start_date=<today>&end_date=<today>&summarize=true` call. A **"Reload Today"** button lets the user manually refresh today's data without reloading the rest.
3. **This Month** — single `/spend/logs?start_date=<first-of-month>&end_date=<today>&summarize=true` call (or `/global/spend/report` with the same range).
4. **All Time (last 6 months)** — single `/spend/logs?start_date=<6-months-ago>&end_date=<today>&summarize=true` call covering the full 6-month window in **one request** (not 6 monthly calls). For per-model breakdown use `/global/spend/report?start_date=<6-months-ago>&end_date=<today>` with appropriate `group_by`.
5. **Initial load** makes at most **3 API calls** (today, this month, 6-month history). The "Reload Today" button makes **1 call**.

### Sessions tab (webview)

6. Display sessions derived from `/spend/logs/v2` grouped by `session_id` (there is no dedicated sessions-list endpoint in the LiteLLM API; sessions are inferred from log entries sharing the same `session_id`). Each row shows session id, model(s) used, token totals, spend, start time, and request count. Session list is limited to the **last 6 months** and loaded on demand when the Sessions tab is first opened.
7. **Session detail.** Clicking a session row opens the individual request logs for that session (`/spend/logs/v2?session_id=…`, paginated `page`/`page_size`). Fetched lazily — not preloaded.
8. **Request detail.** Clicking an individual request shows the prompt logs including input prompt, output, tokens, and model used (from the log entry's `messages` / `response` fields, if available). Fetched lazily.

### UI/UX reference

9. The dashboard layout and tab structure may follow the example of [ClaudeCodeUsage/ClaudeCodeUsage](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage). **Note:** that extension reads *local `.jsonl` log files*; this extension reads the *LiteLLM REST API* — the reference is for UI/UX patterns only, not data sourcing.

### Acceptance criteria

- [ ] Spend tab renders today / this month / 6-month history with per-model breakdown.
- [ ] Initial dashboard load makes at most 3 spend API calls (not per-day or per-month loops).
- [ ] "All Time" scope shows at most the last 6 months and uses a single date-range call.
- [ ] A "Reload Today" button refreshes only today's data with a single API call.
- [ ] Dashboard does not auto-poll; data loads on open or explicit reload only.
- [ ] Sessions tab lists sessions grouped by `session_id`, limited to the last 6 months.
- [ ] Clicking a session lazily fetches its request logs (not preloaded).
- [ ] Clicking a request lazily shows prompt input/output, tokens, and model.

---

# Phase 3 — LiteLLM Model Provider & Coding Agent Integration

## Phase 3.1 — One-click VS Code Chat configuration

1. **One-click setup.** Provide a command that configures VS Code Chat (Copilot) to use the LiteLLM proxy as a custom model provider. Reference implementations:
   - [gethnet/litellm-connector-copilot](https://github.com/gethnet/litellm-connector-copilot)
   - [Vivswan/litellm-vscode-chat](https://github.com/Vivswan/litellm-vscode-chat)
2. **Predefined default models.** The VSIX author can predefine which models VS Code Chat and Claude Code use by default (via `package.json` configuration or a build-time constant).
3. **User override.** Users can choose their own models for VS Code Chat and Claude Code, overriding the preconfigured defaults (via extension settings).
4. **Add Models flow.** When a user clicks "Add Models" in VS Code Chat's custom-endpoint flow, display an option next to "Custom Endpoint" showing "LiteLLM" (or the custom package name from `package.json`). Clicking it discovers and lists all supported models via the `/v1/models` (GET) or `/model/info` (GET) endpoint, and registers them as available models.

### Claude Code integration mechanism

Claude Code is a CLI tool. Configuration is done by writing to Claude Code's settings file (`~/.claude/settings.json`) — specifically the model/endpoint configuration — and/or via the LiteLLM `/claude-code/plugins` endpoint (GET/POST, see `openapi.json`). The extension should:
- Detect whether Claude Code is installed.
- Write the model and LiteLLM endpoint into the Claude Code settings file.
- Provide a UI to pick which model Claude Code uses (from the model discovery list).

### Acceptance criteria

- [ ] One command configures VS Code Chat to use the LiteLLM proxy.
- [ ] Predefined models are applied by default; user can override.
- [ ] Model discovery lists models from `/v1/models` or `/model/info`.
- [ ] Claude Code model/endpoint can be set from the extension.

---

# Non-functional Requirements

| Area | Requirement |
|---|---|
| **Refresh** | Status bar refreshes on a configurable interval (`litellm.refreshIntervalSeconds`, min 30s, default 300s). Also refreshes when the VS Code window regains focus. |
| **Error handling** | API failures show a non-blocking error notification with the message; the status bar shows an error icon (`$(warning)`) with the error in the tooltip. No uncaught promise rejections. |
| **Retry** | Transient HTTP failures (5xx, timeouts) retry up to 2 times with exponential backoff (1s, 2s). 4xx errors are not retried. |
| **Offline** | When the LiteLLM proxy is unreachable, the status bar shows `$(cloud-offline)` and a tooltip explaining the connection failure. No crash. |
| **Multi-workspace** | Connection settings are read per-workspace (VS Code config scoping). Each workspace window maintains its own status-bar state. |
| **Performance** | Dashboard webview loads within 2s for ≤ 1000 log entries. Large result sets use pagination (`/spend/logs/v2` `page`/`page_size` params). |
| **Settings sync** | All `contributes.configuration` settings participate in VS Code Settings Sync. |

---

# Telemetry & Privacy

- The extension transmits the API key and usage queries to the LiteLLM proxy endpoint configured by the user. No telemetry is sent to any third party (including the extension publisher).
- No usage data, prompts, or tokens are stored outside the user's machine and the LiteLLM proxy.
- The `litellm.apiKey` setting should use `scope: "machine"` to avoid syncing secrets via Settings Sync (or document that users should prefer the environment variable for sensitive keys).
