import * as vscode from 'vscode';
import { GitService, DiffResult } from './gitService';
import * as path from 'path';

export class DiffPanel {
  public static currentPanel: DiffPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly gitService: GitService;
  private disposables: vscode.Disposable[] = [];
  private currentBranch: string = '';

  private constructor(panel: vscode.WebviewPanel, gitService: GitService) {
    this.panel = panel;
    this.gitService = gitService;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'openFile':
            await this.openFileDiff(message.file);
            break;
          case 'refresh':
            await this.refresh();
            break;
        }
      },
      null,
      this.disposables
    );
  }

  public static async createOrShow(gitService: GitService, branch: string): Promise<DiffPanel> {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (DiffPanel.currentPanel) {
      DiffPanel.currentPanel.panel.reveal(column);
      DiffPanel.currentPanel.currentBranch = branch;
      await DiffPanel.currentPanel.refresh();
      return DiffPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'diffViewer',
      `Diff: ${branch}`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    DiffPanel.currentPanel = new DiffPanel(panel, gitService);
    DiffPanel.currentPanel.currentBranch = branch;
    await DiffPanel.currentPanel.refresh();
    return DiffPanel.currentPanel;
  }

  private async refresh(): Promise<void> {
    this.panel.title = `Diff: ${this.currentBranch}`;
    const diffResults = await this.gitService.getDiffSummary(this.currentBranch);
    this.panel.webview.html = this.getHtml(diffResults);
  }

  private async openFileDiff(filePath: string): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return;

    const fullPath = path.join(folders[0].uri.fsPath, filePath);
    const uri = vscode.Uri.file(fullPath);

    try {
      // Use VS Code's built-in diff editor
      const branchUri = vscode.Uri.parse(`git-diff:${this.currentBranch}:${filePath}`);

      // Create a git URI for the old version
      const gitUri = uri.with({
        scheme: 'git',
        query: JSON.stringify({ path: fullPath, ref: this.currentBranch }),
      });

      await vscode.commands.executeCommand(
        'vscode.diff',
        gitUri,
        uri,
        `${filePath} (${this.currentBranch} vs Current)`
      );
    } catch {
      // Fallback: just open the file
      await vscode.window.showTextDocument(uri);
    }
  }

  private getHtml(diffResults: DiffResult[]): string {
    const totalAdditions = diffResults.reduce((sum, r) => sum + r.additions, 0);
    const totalDeletions = diffResults.reduce((sum, r) => sum + r.deletions, 0);

    const fileRows = diffResults
      .map((r) => {
        const statusIcon = this.getStatusIcon(r.status);
        const statusClass = r.status;
        return `
        <tr class="file-row" data-file="${this.escapeHtml(r.file)}">
          <td class="status ${statusClass}">${statusIcon}</td>
          <td class="filename">${this.escapeHtml(r.file)}</td>
          <td class="additions">+${r.additions}</td>
          <td class="deletions">-${r.deletions}</td>
          <td class="bar">${this.getChangeBar(r.additions, r.deletions)}</td>
        </tr>
      `;
      })
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Branch Diff</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 16px;
      margin: 0;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .header h2 {
      margin: 0;
      font-size: 18px;
    }
    .summary {
      display: flex;
      gap: 16px;
      font-size: 13px;
    }
    .summary .additions { color: #3fb950; }
    .summary .deletions { color: #f85149; }
    .summary .files { color: var(--vscode-descriptionForeground); }
    .refresh-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 12px;
      cursor: pointer;
      border-radius: 4px;
    }
    .refresh-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th {
      text-align: left;
      padding: 8px;
      border-bottom: 1px solid var(--vscode-widget-border);
      color: var(--vscode-descriptionForeground);
      font-weight: 500;
    }
    .file-row {
      cursor: pointer;
    }
    .file-row:hover {
      background: var(--vscode-list-hoverBackground);
    }
    td {
      padding: 6px 8px;
      border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
    }
    .status {
      width: 24px;
      text-align: center;
    }
    .status.added { color: #3fb950; }
    .status.modified { color: #d29922; }
    .status.deleted { color: #f85149; }
    .status.renamed { color: #a371f7; }
    .filename {
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .additions {
      color: #3fb950;
      text-align: right;
      width: 60px;
    }
    .deletions {
      color: #f85149;
      text-align: right;
      width: 60px;
    }
    .bar {
      width: 120px;
    }
    .change-bar {
      display: flex;
      height: 8px;
      border-radius: 2px;
      overflow: hidden;
    }
    .change-bar .add {
      background: #3fb950;
    }
    .change-bar .del {
      background: #f85149;
    }
    .empty-state {
      text-align: center;
      padding: 48px;
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h2>Changes from ${this.escapeHtml(this.currentBranch)}</h2>
      <div class="summary">
        <span class="files">${diffResults.length} files changed</span>
        <span class="additions">+${totalAdditions}</span>
        <span class="deletions">-${totalDeletions}</span>
      </div>
    </div>
    <button class="refresh-btn" onclick="refresh()">Refresh</button>
  </div>

  ${
    diffResults.length === 0
      ? '<div class="empty-state">No changes found</div>'
      : `
  <table>
    <thead>
      <tr>
        <th></th>
        <th>File</th>
        <th style="text-align:right">+</th>
        <th style="text-align:right">-</th>
        <th>Changes</th>
      </tr>
    </thead>
    <tbody>
      ${fileRows}
    </tbody>
  </table>
  `
  }

  <script>
    const vscode = acquireVsCodeApi();

    document.querySelectorAll('.file-row').forEach(row => {
      row.addEventListener('click', () => {
        const file = row.dataset.file;
        vscode.postMessage({ command: 'openFile', file });
      });
    });

    function refresh() {
      vscode.postMessage({ command: 'refresh' });
    }
  </script>
</body>
</html>`;
  }

  private getStatusIcon(status: string): string {
    switch (status) {
      case 'added':
        return 'A';
      case 'modified':
        return 'M';
      case 'deleted':
        return 'D';
      case 'renamed':
        return 'R';
      default:
        return '?';
    }
  }

  private getChangeBar(additions: number, deletions: number): string {
    const total = additions + deletions;
    if (total === 0) return '';

    const maxWidth = 100;
    const scale = Math.min(1, maxWidth / total);
    const addWidth = Math.round(additions * scale);
    const delWidth = Math.round(deletions * scale);

    return `<div class="change-bar">
      <div class="add" style="width: ${addWidth}px"></div>
      <div class="del" style="width: ${delWidth}px"></div>
    </div>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  public dispose(): void {
    DiffPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }
}
