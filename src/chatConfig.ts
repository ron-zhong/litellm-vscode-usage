import * as vscode from 'vscode';
import { getConnectionConfig } from './config';

/**
 * Guide the user through configuring VS Code Chat's "Bring Your Own Key" (BYOK)
 * feature to point at their LiteLLM proxy endpoint.
 *
 * VS Code 1.90+ supports custom OpenAI-compatible endpoints via the
 * `github.copilot.chat.openai` or the `openai-compatible` language model family.
 * We write to the `github.copilot.advanced` settings and the generic
 * `openaiCompatibleChatModels` / `requestOptions` blocks that many BYOK
 * extensions respect.
 */
export async function configureChatByok(): Promise<void> {
  const conn = getConnectionConfig();

  if (!conn) {
    const choice = await vscode.window.showErrorMessage(
      'LiteLLM API base URL is not configured. Please set litellm.apiBase in your settings (or LITELLM_API_BASE in your environment) before configuring VS Code Chat.',
      'Open Settings'
    );
    if (choice === 'Open Settings') {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'litellm.apiBase'
      );
    }
    return;
  }

  const { apiBase, apiKey } = conn;

  // Ask which target to configure
  const targetChoices: Array<vscode.QuickPickItem & { configTarget: vscode.ConfigurationTarget }> =
    [
      {
        label: '$(globe) User Settings',
        description: 'Apply to all workspaces for this user',
        configTarget: vscode.ConfigurationTarget.Global,
      },
      {
        label: '$(folder) Workspace Settings',
        description: 'Apply only to the current workspace',
        configTarget: vscode.ConfigurationTarget.Workspace,
      },
    ];

  const target = await vscode.window.showQuickPick(targetChoices, {
    title: 'LiteLLM: Configure VS Code Chat BYOK',
    placeHolder: 'Where should the settings be saved?',
  });

  if (!target) {
    return;
  }

  const configTarget = target.configTarget;

  try {
    // 1. Write LiteLLM-specific settings
    const litellmConfig = vscode.workspace.getConfiguration('litellm');
    await litellmConfig.update('apiBase', apiBase, configTarget);
    if (apiKey) {
      await litellmConfig.update('apiKey', apiKey, configTarget);
    }

    // 2. Configure github.copilot.advanced to use the custom endpoint
    //    (works for GitHub Copilot Chat BYOK)
    const litellmConfigForModel = vscode.workspace.getConfiguration('litellm');
    const defaultModel =
      (litellmConfigForModel.get<string>('defaultModel') || '').trim() || 'gpt-4o';

    const copilotConfig = vscode.workspace.getConfiguration('github.copilot');
    const existingAdvanced = copilotConfig.get<Record<string, unknown>>('advanced') ?? {};
    await copilotConfig.update(
      'advanced',
      {
        ...existingAdvanced,
        'debug.overrideChatEngine': defaultModel,
        'debug.chatOverrideProxyUrl': `${apiBase}/v1/chat/completions`,
        ...(apiKey ? { 'debug.chatOverrideApiKey': apiKey } : {}),
      },
      configTarget
    );

    // 3. Configure the built-in "openaiCompatibleChatModels" if present (VS Code 1.90+)
    const chatConfig = vscode.workspace.getConfiguration('chat');
    const existingModels = chatConfig.get<object[]>('openaiCompatibleChatModels') ?? [];
    const expectedUrl = new URL('v1/chat/completions', apiBase.endsWith('/') ? apiBase : `${apiBase}/`);
    // Only add if not already present
    const alreadyConfigured = existingModels.some(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (m: any) => {
        if (m.apiBase === apiBase) {
          return true;
        }
        if (typeof m.url !== 'string') {
          return false;
        }
        try {
          const u = new URL(m.url);
          return u.origin === expectedUrl.origin && u.pathname === expectedUrl.pathname;
        } catch {
          return false;
        }
      }
    );
    if (!alreadyConfigured) {
      await chatConfig.update(
        'openaiCompatibleChatModels',
        [
          ...existingModels,
          {
            name: 'LiteLLM (custom)',
            url: `${apiBase}/v1/chat/completions`,
            apiKey: apiKey || undefined,
          },
        ],
        configTarget
      );
    }

    await vscode.window.showInformationMessage(
      `VS Code Chat has been configured to use LiteLLM at ${apiBase}. ` +
        'You may need to reload the window for changes to take effect.',
      'Reload Window'
    ).then((choice) => {
      if (choice === 'Reload Window') {
        vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    });
  } catch (err) {
    vscode.window.showErrorMessage(
      'Failed to configure VS Code Chat: ' +
        (err instanceof Error ? err.message : String(err))
    );
  }
}

/**
 * Remove BYOK configuration written by this extension.
 * Only the keys managed by this extension are removed; any other advanced
 * Copilot settings the user has configured are preserved.
 */
export async function removeChatByok(configTarget: vscode.ConfigurationTarget): Promise<void> {
  const copilotConfig = vscode.workspace.getConfiguration('github.copilot');
  const existing = copilotConfig.get<Record<string, unknown>>('advanced') ?? {};
  const keysToRemove = new Set([
    'debug.overrideChatEngine',
    'debug.chatOverrideProxyUrl',
    'debug.chatOverrideApiKey',
  ]);
  const remaining = Object.fromEntries(
    Object.entries(existing).filter(([key]) => !keysToRemove.has(key))
  );
  await copilotConfig.update(
    'advanced',
    Object.keys(remaining).length > 0 ? remaining : undefined,
    configTarget
  );
}
