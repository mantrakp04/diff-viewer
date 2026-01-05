import * as vscode from 'vscode';
import { GitService } from './gitService';
import { DiffPanel } from './diffPanel';

export function activate(context: vscode.ExtensionContext): void {
  // Diff all changes with main
  const diffWithMain = vscode.commands.registerCommand('diffViewer.diffWithMain', async () => {
    try {
      const gitService = new GitService();
      const defaultBranch = await gitService.getDefaultBranch();
      await DiffPanel.createOrShow(gitService, defaultBranch);
    } catch (error) {
      vscode.window.showErrorMessage(`Error: ${error}`);
    }
  });

  // Diff all changes with selected branch
  const diffWithBranch = vscode.commands.registerCommand('diffViewer.diffWithBranch', async () => {
    try {
      const gitService = new GitService();
      const branches = await gitService.getBranches();
      const uniqueBranches = [...new Set(branches)];

      const selected = await vscode.window.showQuickPick(uniqueBranches, {
        placeHolder: 'Select branch to compare against',
      });

      if (selected) {
        await DiffPanel.createOrShow(gitService, selected);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error: ${error}`);
    }
  });

  // Diff current file with main
  const diffFileWithMain = vscode.commands.registerCommand(
    'diffViewer.diffFileWithMain',
    async (uri?: vscode.Uri) => {
      try {
        const fileUri = uri || vscode.window.activeTextEditor?.document.uri;
        if (!fileUri) {
          vscode.window.showWarningMessage('No file selected');
          return;
        }

        const gitService = new GitService();
        const defaultBranch = await gitService.getDefaultBranch();
        await openFileDiff(fileUri, defaultBranch);
      } catch (error) {
        vscode.window.showErrorMessage(`Error: ${error}`);
      }
    }
  );

  // Diff current file with selected branch
  const diffFileWithBranch = vscode.commands.registerCommand(
    'diffViewer.diffFileWithBranch',
    async (uri?: vscode.Uri) => {
      try {
        const fileUri = uri || vscode.window.activeTextEditor?.document.uri;
        if (!fileUri) {
          vscode.window.showWarningMessage('No file selected');
          return;
        }

        const gitService = new GitService();
        const branches = await gitService.getBranches();
        const uniqueBranches = [...new Set(branches)];

        const selected = await vscode.window.showQuickPick(uniqueBranches, {
          placeHolder: 'Select branch to compare against',
        });

        if (selected) {
          await openFileDiff(fileUri, selected);
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Error: ${error}`);
      }
    }
  );

  context.subscriptions.push(diffWithMain, diffWithBranch, diffFileWithMain, diffFileWithBranch);
}

async function openFileDiff(uri: vscode.Uri, branch: string): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) return;

  const relativePath = vscode.workspace.asRelativePath(uri);

  // Create a git URI for the old version
  const gitUri = uri.with({
    scheme: 'git',
    query: JSON.stringify({ path: uri.fsPath, ref: branch }),
  });

  await vscode.commands.executeCommand(
    'vscode.diff',
    gitUri,
    uri,
    `${relativePath} (${branch} vs Current)`
  );
}

export function deactivate(): void {
  // Cleanup
}
