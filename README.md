# LiteLLM Usage — VS Code Extension

Monitor your [LiteLLM](https://github.com/BerriAI/litellm) proxy spend directly in VS Code and unlock AI-powered developer productivity features powered by your own LiteLLM endpoint.

---

## Features

| Feature | Description |
|---|---|
| **Status-bar spend** | Live budget-window spend badge with soft/hard budget visual alerts, refreshed on a configurable interval. |
| **Spend details** | Quick-pick popup with current budget spend, budget limit, budget %, reset date, and user alias. |
| **Usage Dashboard** | Webview with a month-to-date spend bar chart (proper axes, per-day hover tooltips with model breakdown), a daily breakdown table (date, spend, models), and budget summary cards. |

---

## Screenshots

### Status-bar spend badge

The status bar shows your current budget-window spend at a glance, with color-coded alerts when soft or hard budget thresholds are exceeded.

<img width="290" height="61" alt="LiteLLM spend badge in the VS Code status bar" src="https://github.com/user-attachments/assets/19e3e9fd-647f-4c6f-965e-92b660cebda9" />

### Spend details popup

Click the status bar item to open a quick-pick popup with the full budget summary — current spend, budget limit, budget used %, reset date, and user alias — plus quick actions to open the dashboard, refresh, or edit settings.

<img width="875" height="296" alt="LiteLLM spend details quick-pick popup showing budget summary and action items" src="https://github.com/user-attachments/assets/fc25c7e4-4259-4f1c-bc92-8835574762f5" />

### Usage Dashboard

The full webview dashboard displays budget summary cards, a month-to-date vertical bar chart with y-axis spend ticks and x-axis day labels, per-bar hover tooltips showing the model-level breakdown, and a daily breakdown table sorted newest-first.

<img width="1460" height="1354" alt="LiteLLM Usage Dashboard webview showing budget cards, month-to-date spend bar chart with axes, and daily breakdown table" src="https://github.com/user-attachments/assets/5052f918-32a5-4ebc-a0a0-a055dcafc0cc" />

---

## Requirements

- VS Code **1.85.0** or newer
- A running [LiteLLM proxy](https://docs.litellm.ai/docs/proxy/quick_start) (`http://localhost:4000` by default)

---

## Installation

### From the Marketplace

Search **LiteLLM Usage** in the VS Code Extensions view, or open it directly:

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=litellm.litellm-usage)
- [Open VSX Registry](https://open-vsx.org/extension/litellm/litellm-usage)

### From a local `.vsix` file

```bash
code --install-extension litellm-usage-*.vsix
```

---

## Configuration

Open **Settings → Extensions → LiteLLM Usage** or add the following to your `settings.json`:

```jsonc
{
  // Required: base URL of your LiteLLM proxy (no trailing slash).
  // Falls back to the LITELLM_API_BASE environment variable.
  "litellm.apiBase": "http://localhost:4000",

  // Optional: your LiteLLM API key.
  // Falls back to the LITELLM_API_KEY environment variable.
  "litellm.apiKey": "sk-...",

  // How often (in seconds) to refresh the status-bar badge. Minimum: 60.
  "litellm.refreshIntervalSeconds": 300,

  // Soft-budget thresholds (USD) for status-bar visual alerts.
  // Above the standard threshold → warning style; above the pro threshold → error style.
  "litellm.softBudgetStandardUsd": 200,
  "litellm.softBudgetProUsd": 500,
  "litellm.softBudgetMaxUsd": 1000
}
```

Environment variables (`LITELLM_API_BASE`, `LITELLM_API_KEY`) are read at startup and serve as fallbacks for users who prefer not to store credentials in VS Code settings.

### Build-time admin switch

The dashboard's month-to-date spend chart issues a single `GET /spend/logs?summarize=true` call per user per calendar day (daily-cached, single-flight). For performance-sensitive deployments the feature can be disabled entirely at build time so the extension makes **no** `/spend/logs` call — set `DASHBOARD_BREAKDOWN_ENABLED` to `false` in [`src/constants.ts`](src/constants.ts) before packaging:

```bash
# Ship a no-breakdown build (no chart, no /spend/logs call)
sed -i '' 's/DASHBOARD_BREAKDOWN_ENABLED = true/DASHBOARD_BREAKDOWN_ENABLED = false/' src/constants.ts
npm run package
```

---

## Commands

| Command | Description |
|---|---|
| `LiteLLM: Show Usage Dashboard` | Open the webview spend dashboard (budget summary + month-to-date chart) |
| `LiteLLM: Show Current Spend Details` | Quick-pick spend popup |
| `LiteLLM: Refresh Status Bar` | Force-refresh the current budget spend (`/v2/user/info`) immediately |

---

## Development

### Prerequisites

- Node.js ≥ 20.19
- npm ≥ 9

### Setup

```bash
git clone https://github.com/ron-zhong/litellm-vsix.git
cd litellm-vsix
npm install
```

### Build

```bash
npm run compile      # one-off TypeScript compile
npm run watch        # incremental watch mode
```

### Lint

```bash
npm run lint
```

### Tests

```bash
# Unit tests only — no network, no VS Code required (32 tests)
npm run test:unit

# Unit + integration tests
# Integration tests skip automatically when LITELLM_API_BASE is not set.
npm test

# Integration tests against a live LiteLLM proxy
LITELLM_API_BASE=http://localhost:4000 LITELLM_API_KEY=sk-... npm run test:integration

# End-to-end tests — downloads VS Code, requires a display or xvfb on Linux
npm run test:e2e
# On headless Linux: xvfb-run -a npm run test:e2e
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for a full development guide.

### Package

```bash
npm run package      # produces litellm-usage-*.vsix
```

---

## Publishing

The extension is published to two registries:

| Registry | URL |
|---|---|
| VS Code Marketplace | <https://marketplace.visualstudio.com/items?itemName=litellm.litellm-usage> |
| Open VSX Registry | <https://open-vsx.org/extension/litellm/litellm-usage> |

### Prerequisites

1. **VS Code Marketplace** — create a publisher account at <https://marketplace.visualstudio.com/manage> and generate a Personal Access Token (PAT) with the *Marketplace → Manage* scope.
2. **Open VSX** — create an account at <https://open-vsx.org> and generate a token under *User Settings → Access Tokens*.
3. Install the publishing tools:

```bash
npm install -g @vscode/vsce ovsx
```

### Manual publishing (hotfix / first release)

```bash
# 1. Bump version
npm version patch   # or minor / major

# 2. Publish to VS Code Marketplace (packages automatically)
vsce publish --pat <VSCE_PAT>

# 3. Publish to Open VSX
ovsx publish litellm-usage-*.vsix --pat <OVSX_PAT>
```

### Automated publishing via GitHub Actions

Push a version tag to trigger the [publish workflow](.github/workflows/publish.yml):

```bash
git tag v1.2.3
git push origin v1.2.3
```

#### Required repository secrets

Add these in **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `VSCE_PAT` | VS Code Marketplace Personal Access Token |
| `OVSX_PAT` | Open VSX Personal Access Token |

The workflow installs dependencies, runs unit tests, and publishes to both registries in a single job.

#### First-time Open VSX namespace

Open VSX requires you to claim the namespace once before the first publish:

```bash
ovsx create-namespace litellm --pat <OVSX_PAT>
```

---

## Security & Compliance

| Control | Details |
|---|---|
| **SAST** | [CodeQL](https://codeql.github.com/) runs on every push, pull request, and weekly schedule — see [`.github/workflows/codeql.yml`](.github/workflows/codeql.yml). |
| **Dependency scanning** | `npm audit --audit-level=high` runs in CI; [Dependabot](.github/dependabot.yml) opens automated PRs for npm packages and GitHub Actions updates weekly. |
| **Secret scanning** | GitHub's built-in secret scanning is enabled for the repository. |
| **Credential hygiene** | The extension never logs API keys. When writing project-scoped Claude Code settings it warns users to gitignore the file. |

---

## License

[MIT](LICENSE)

