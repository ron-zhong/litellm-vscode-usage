import * as vscode from 'vscode';
import { getConnectionConfig } from './config';
import { generateCommitMessageFromDiff } from './litellmClient';

// Minimal types for the VS Code built-in git extension API (vscode.git)
interface GitExtension {
  getAPI(version: 1): GitAPI;
}

interface GitAPI {
  repositories: GitRepository[];
}

interface GitRepository {
  inputBox: { value: string };
  diff(staged: boolean): Promise<string>;
}

/**
 * Generate a git commit message from the staged diff using LiteLLM and
 * populate the Source Control input box with the result.
 */
export async function generateCommitMessage(): Promise<void> {
  const conn = getConnectionConfig();
  if (!conn) {
    const choice = await vscode.window.showWarningMessage(
      'LiteLLM is not configured. Set litellm.apiBase to use commit message generation.',
      'Open Settings'
    );
    if (choice === 'Open Settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'litellm.apiBase');
    }
    return;
  }

  // Access the VS Code built-in git extension
  const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!gitExtension) {
    vscode.window.showErrorMessage('The built-in Git extension is not available.');
    return;
  }

  if (!gitExtension.isActive) {
    await gitExtension.activate();
  }

  const git = gitExtension.exports.getAPI(1);
  if (!git || git.repositories.length === 0) {
    vscode.window.showErrorMessage('No Git repository found in this workspace.');
    return;
  }

  // Use the first (most likely active) repository
  const repo = git.repositories[0];

  // Get the staged diff
  let diff: string;
  try {
    diff = await repo.diff(true);
  } catch (err) {
    vscode.window.showErrorMessage(
      'Failed to read staged changes: ' + (err instanceof Error ? err.message : String(err))
    );
    return;
  }

  if (!diff.trim()) {
    vscode.window.showInformationMessage(
      'No staged changes found. Stage some files first, then try again.'
    );
    return;
  }

  const config = vscode.workspace.getConfiguration('litellm');
  const model = (config.get<string>('defaultModel') || 'gpt-4o').trim();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'LiteLLM: Generating commit message…',
      cancellable: false,
    },
    async () => {
      try {
        const message = await generateCommitMessageFromDiff(
          conn.apiBase,
          conn.apiKey,
          model,
          diff
        );
        repo.inputBox.value = message;
      } catch (err) {
        vscode.window.showErrorMessage(
          'Failed to generate commit message: ' +
            (err instanceof Error ? err.message : String(err))
        );
      }
    }
  );
}
