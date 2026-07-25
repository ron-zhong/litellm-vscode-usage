import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getConnectionConfig } from './config';
import { fetchAvailableModels } from './litellmClient';

/** Scope for Claude Code settings file. */
type ClaudeScope = 'project' | 'global';

/** Minimal shape of Claude Code's settings.json. */
interface ClaudeSettings {
  model?: string;
  env?: Record<string, string>;
  [key: string]: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch models from LiteLLM, returning an empty array on failure so the
 * caller can fall back to manual input.
 */
async function loadModels(apiBase: string, apiKey: string): Promise<string[]> {
  try {
    const models = await fetchAvailableModels(apiBase, apiKey);
    return models.map((m) => m.id);
  } catch {
    return [];
  }
}

/**
 * Show a model quick-pick backed by the LiteLLM /v1/models list.
 * If the list cannot be fetched the user can type a custom model name.
 */
async function pickModel(apiBase: string, apiKey: string): Promise<string | undefined> {
  const models = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'LiteLLM: Fetching available models…',
      cancellable: false,
    },
    () => loadModels(apiBase, apiKey)
  );

  type ModelItem = vscode.QuickPickItem & { modelId: string | null };

  const items: ModelItem[] = [];

  if (models.length > 0) {
    items.push(
      ...models.map<ModelItem>((id) => ({
        label: id,
        description: 'Available on your LiteLLM proxy',
        modelId: id,
      }))
    );
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator, modelId: null });
  } else {
    items.push({
      label: '$(warning) Could not fetch models — proxy may be offline',
      description: 'Enter a model name manually',
      modelId: null,
    });
  }

  items.push({
    label: '$(edit) Enter custom model name…',
    description: 'Type any model ID supported by your proxy',
    modelId: null,
  });

  const picked = await vscode.window.showQuickPick(items, {
    title: 'LiteLLM: Select a Model',
    placeHolder:
      models.length > 0
        ? 'Select from available models or enter a custom name'
        : 'Enter a custom model name',
    matchOnDescription: true,
  });

  if (!picked) {
    return undefined;
  }

  if (picked.modelId) {
    return picked.modelId;
  }

  // Manual input
  return vscode.window.showInputBox({
    title: 'LiteLLM: Custom Model Name',
    prompt: 'Enter the model name exactly as it appears on your LiteLLM proxy',
    placeHolder: 'e.g. gpt-4o, claude-opus-4-5, mistral-large',
    validateInput: (v) => (v.trim() ? undefined : 'Model name cannot be empty'),
  });
}

/** Resolve the path to Claude Code's settings file. */
function resolveClaudeSettingsPath(scope: ClaudeScope): string {
  if (scope === 'global') {
    return path.join(os.homedir(), '.claude', 'settings.json');
  }
  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  return path.join(workspaceRoot, '.claude', 'settings.json');
}

/**
 * Write (or merge into) a Claude Code settings.json.
 * Preserves existing keys that are not managed by this extension.
 */
function writeClaudeSettings(
  settingsPath: string,
  model: string,
  apiBase: string,
  apiKey: string
): void {
  let existing: ClaudeSettings = {};
  try {
    existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as ClaudeSettings;
  } catch {
    // File doesn't exist or is corrupt; start from an empty object
  }

  const updated: ClaudeSettings = {
    ...existing,
    model,
    env: {
      ...(existing.env ?? {}),
      ANTHROPIC_BASE_URL: apiBase,
      // Preserve an existing API key if no key is configured in this extension
      ANTHROPIC_API_KEY: apiKey || existing.env?.['ANTHROPIC_API_KEY'] || '',
    },
  };

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
}

/**
 * Update VS Code Chat settings to use the selected LiteLLM model.
 * Writes to `github.copilot.advanced` (GitHub Copilot BYOK) and
 * `chat.openaiCompatibleChatModels` (VS Code built-in OpenAI-compatible chat).
 */
async function applyVSCodeChatModel(
  model: string,
  apiBase: string,
  apiKey: string,
  configTarget: vscode.ConfigurationTarget
): Promise<void> {
  const litellmConfig = vscode.workspace.getConfiguration('litellm');
  await litellmConfig.update('defaultModel', model, configTarget);

  const copilotConfig = vscode.workspace.getConfiguration('github.copilot');
  const existingAdvanced = copilotConfig.get<Record<string, unknown>>('advanced') ?? {};
  await copilotConfig.update(
    'advanced',
    {
      ...existingAdvanced,
      'debug.overrideChatEngine': model,
      'debug.chatOverrideProxyUrl': `${apiBase}/v1/chat/completions`,
      ...(apiKey ? { 'debug.chatOverrideApiKey': apiKey } : {}),
    },
    configTarget
  );

  const chatConfig = vscode.workspace.getConfiguration('chat');
  const existingModels = chatConfig.get<object[]>('openaiCompatibleChatModels') ?? [];
  const expectedUrl = new URL('v1/chat/completions', apiBase.endsWith('/') ? apiBase : `${apiBase}/`);
  // Replace any LiteLLM entry already pointing at this proxy
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filtered = existingModels.filter((m: any) => {
    if (typeof m.url !== 'string') {
      return true;
    }
    try {
      const u = new URL(m.url);
      return !(u.origin === expectedUrl.origin && u.pathname === expectedUrl.pathname);
    } catch {
      return true;
    }
  });
  await chatConfig.update(
    'openaiCompatibleChatModels',
    [
      ...filtered,
      {
        name: `LiteLLM – ${model}`,
        url: `${apiBase}/v1/chat/completions`,
        apiKey: apiKey || undefined,
      },
    ],
    configTarget
  );
}

// ─── Main command ─────────────────────────────────────────────────────────────

/**
 * Interactive wizard that fetches the available LiteLLM models and guides
 * the user through configuring one for VS Code Chat and/or Claude Code.
 *
 * VS Code Chat: writes `litellm.defaultModel`, `github.copilot.advanced`, and
 * `chat.openaiCompatibleChatModels`.
 *
 * Claude Code: writes `.claude/settings.json` (project) or
 * `~/.claude/settings.json` (global) with the `model` field and the
 * `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` environment variables so Claude
 * Code routes traffic through the LiteLLM proxy.
 */
export async function configureModels(): Promise<void> {
  const conn = getConnectionConfig();
  if (!conn) {
    const choice = await vscode.window.showWarningMessage(
      'LiteLLM is not configured. Set litellm.apiBase before configuring AI models.',
      'Open Settings'
    );
    if (choice === 'Open Settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'litellm.apiBase');
    }
    return;
  }

  // Step 1: pick a model
  const model = await pickModel(conn.apiBase, conn.apiKey);
  if (!model?.trim()) {
    return;
  }
  const trimmedModel = model.trim();

  // Step 2: which AI client(s)?
  type ClientItem = vscode.QuickPickItem & { value: 'vscode' | 'claude' | 'both' };
  const clientItems: ClientItem[] = [
    {
      label: '$(comment) VS Code Chat',
      description: 'Copilot BYOK + built-in OpenAI-compatible chat',
      value: 'vscode',
    },
    {
      label: '$(terminal) Claude Code',
      description: '.claude/settings.json with model + proxy URL',
      value: 'claude',
    },
    {
      label: '$(check-all) Both',
      description: 'Configure VS Code Chat and Claude Code',
      value: 'both',
    },
  ];

  const clientChoice = await vscode.window.showQuickPick(clientItems, {
    title: `LiteLLM: Apply "${trimmedModel}" to…`,
    placeHolder: 'Select which AI client(s) to configure',
  });
  if (!clientChoice) {
    return;
  }

  // Step 3: VS Code config target scope
  type TargetItem = vscode.QuickPickItem & { configTarget: vscode.ConfigurationTarget };
  const targetItems: TargetItem[] = [
    {
      label: '$(globe) User Settings',
      description: 'Applies to all workspaces for this user',
      configTarget: vscode.ConfigurationTarget.Global,
    },
    {
      label: '$(folder) Workspace Settings',
      description: 'Applies only to the current workspace',
      configTarget: vscode.ConfigurationTarget.Workspace,
    },
  ];

  const targetChoice = await vscode.window.showQuickPick(targetItems, {
    title: 'LiteLLM: Where to save VS Code settings?',
    placeHolder: 'Choose the settings scope',
  });
  if (!targetChoice) {
    return;
  }

  const configureVSCode = clientChoice.value === 'vscode' || clientChoice.value === 'both';
  const configureClaude = clientChoice.value === 'claude' || clientChoice.value === 'both';

  try {
    if (configureVSCode) {
      await applyVSCodeChatModel(
        trimmedModel,
        conn.apiBase,
        conn.apiKey,
        targetChoice.configTarget
      );
    }

    if (configureClaude) {
      // Claude Code settings have their own project/global scope
      type ScopeItem = vscode.QuickPickItem & { scope: ClaudeScope };
      const scopeItems: ScopeItem[] = [
        {
          label: '$(folder) Project',
          description: '.claude/settings.json in workspace root',
          scope: 'project',
        },
        {
          label: '$(home) Global',
          description: '~/.claude/settings.json',
          scope: 'global',
        },
      ];

      const scopeChoice = await vscode.window.showQuickPick(scopeItems, {
        title: 'Claude Code: Project or Global Settings?',
        placeHolder: 'Choose where to save Claude Code configuration',
      });
      if (!scopeChoice) {
        return;
      }

      const settingsPath = resolveClaudeSettingsPath(scopeChoice.scope);
      writeClaudeSettings(settingsPath, trimmedModel, conn.apiBase, conn.apiKey);

      // Warn when writing a project-scoped file that contains credentials
      if (scopeChoice.scope === 'project' && conn.apiKey) {
        vscode.window
          .showWarningMessage(
            '.claude/settings.json contains your API key — consider adding it to .gitignore.',
            'Open .gitignore'
          )
          .then((choice) => {
            if (choice === 'Open .gitignore') {
              const gitignorePath = path.join(
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
                '.gitignore'
              );
              vscode.window.showTextDocument(vscode.Uri.file(gitignorePath));
            }
          });
      }
    }

    const targets: string[] = [];
    if (configureVSCode) {
      targets.push('VS Code Chat');
    }
    if (configureClaude) {
      targets.push('Claude Code');
    }

    const reloadChoice = await vscode.window.showInformationMessage(
      `Model "${trimmedModel}" configured for ${targets.join(' and ')}. Reload VS Code to apply all changes.`,
      'Reload Window'
    );
    if (reloadChoice === 'Reload Window') {
      vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  } catch (err) {
    vscode.window.showErrorMessage(
      'Failed to configure AI models: ' +
        (err instanceof Error ? err.message : String(err))
    );
  }
}
