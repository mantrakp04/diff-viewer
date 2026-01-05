import * as vscode from 'vscode';
import { GitService, DiffResult } from './gitService';
import * as path from 'path';

export class DiffPanel {
  public static currentPanel: DiffPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly gitService: GitService;
  private disposables: vscode.Disposable[] = [];
  private currentBranch: string = '';
  private inlineEditingEnabled: boolean = false;

  private constructor(panel: vscode.WebviewPanel, gitService: GitService) {
    this.panel = panel;
    this.gitService = gitService;
    this.inlineEditingEnabled = this.getInlineEditingSetting();

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
          case 'toggleInlineEditing':
            this.inlineEditingEnabled = message.enabled;
            await this.saveInlineEditingSetting(message.enabled);
            break;
          case 'saveEdit':
            await this.saveLineEdit(message.file, message.line, message.content);
            break;
        }
      },
      null,
      this.disposables
    );
  }

  private getInlineEditingSetting(): boolean {
    const config = vscode.workspace.getConfiguration('diffViewer');
    return config.get<boolean>('inlineEditing', false);
  }

  private async saveInlineEditingSetting(enabled: boolean): Promise<void> {
    const config = vscode.workspace.getConfiguration('diffViewer');
    await config.update('inlineEditing', enabled, vscode.ConfigurationTarget.Global);
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
    this.panel.webview.html = this.getLoadingHtml();

    const diffResults = await this.gitService.getDiffSummary(this.currentBranch);
    const fileDiffs: { result: DiffResult; diff: string }[] = [];

    for (const result of diffResults) {
      try {
        const { diff } = await this.gitService.getFileDiff(this.currentBranch, result.file);
        fileDiffs.push({ result, diff });
      } catch {
        fileDiffs.push({ result, diff: '' });
      }
    }

    this.panel.webview.html = this.getHtml(diffResults, fileDiffs);
  }

  private async openFileDiff(filePath: string): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return;

    const fullPath = path.join(folders[0].uri.fsPath, filePath);
    const uri = vscode.Uri.file(fullPath);

    try {
      await vscode.window.showTextDocument(uri);
    } catch (error) {
      vscode.window.showErrorMessage(`Could not open file: ${filePath}`);
    }
  }

  private async saveLineEdit(filePath: string, lineNumber: number, newContent: string): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return;

    const fullPath = path.join(folders[0].uri.fsPath, filePath);
    const uri = vscode.Uri.file(fullPath);

    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const edit = new vscode.WorkspaceEdit();
      const line = document.lineAt(lineNumber - 1);
      edit.replace(uri, line.range, newContent);
      await vscode.workspace.applyEdit(edit);
      await document.save();
    } catch (error) {
      vscode.window.showErrorMessage(`Could not save edit to ${filePath}:${lineNumber}`);
    }
  }

  private getLoadingHtml(): string {
    return `<!DOCTYPE html>
<html><head><style>
body { display: flex; justify-content: center; align-items: center; height: 100vh;
  font-family: var(--vscode-font-family); color: var(--vscode-descriptionForeground);
  background: var(--vscode-editor-background); margin: 0; }
</style></head><body>Loading diffs...</body></html>`;
  }

  private getHtml(diffResults: DiffResult[], fileDiffs: { result: DiffResult; diff: string }[]): string {
    const totalAdditions = diffResults.reduce((sum, r) => sum + r.additions, 0);
    const totalDeletions = diffResults.reduce((sum, r) => sum + r.deletions, 0);

    const fileSections = fileDiffs
      .map(({ result, diff }, i) => {
        const { inlineHtml, leftHtml, rightHtml } = this.parseDiff(diff, result.file);
        return `
        <div class="file-section" id="file-${i}">
          <div class="file-header" data-file="${this.escapeHtml(result.file)}">
            <div class="file-info">
              <span class="collapse-icon">\u25BC</span>
              <span class="status ${result.status}">${this.getStatusIcon(result.status)}</span>
              <span class="filename">${this.escapeHtml(result.file)}</span>
            </div>
            <div class="file-stats">
              <span class="add">+${result.additions}</span>
              <span class="del">-${result.deletions}</span>
              <button class="open-btn">Open</button>
            </div>
          </div>
          <div class="diff-wrapper">
            <div class="diff-content inline-view">${inlineHtml || '<div class="no-diff">No diff content</div>'}</div>
            <div class="diff-content split-view" style="display:none">
              <div class="split-pane">
                <div class="pane-header">${this.escapeHtml(this.currentBranch)}</div>
                <div class="pane-scroll">${leftHtml}</div>
              </div>
              <div class="split-pane">
                <div class="pane-header">Current</div>
                <div class="pane-scroll">${rightHtml}</div>
              </div>
            </div>
          </div>
        </div>`;
      })
      .join('');

    const tocItems = diffResults
      .map((r, i) => `<a href="#file-${i}" class="toc-item">
        <span class="status ${r.status}">${this.getStatusIcon(r.status)}</span>
        <span class="toc-filename">${this.escapeHtml(r.file)}</span>
        <span class="toc-stats"><span class="add">+${r.additions}</span><span class="del">-${r.deletions}</span></span>
      </a>`)
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      margin: 0; padding: 0;
    }
    .container { display: flex; height: 100vh; }

    /* Sidebar */
    .sidebar {
      width: 280px; min-width: 44px;
      border-right: 1px solid var(--vscode-widget-border);
      display: flex; flex-direction: column;
      flex-shrink: 0;
      position: relative;
      transition: width 0.15s ease;
    }
    .sidebar.collapsed { width: 44px !important; }
    .sidebar.collapsed .sidebar-content { display: none; }
    .sidebar.collapsed .collapse-btn { transform: rotate(180deg); }

    .collapse-btn {
      position: absolute; top: 8px; right: 8px;
      width: 28px; height: 28px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none; border-radius: 4px;
      cursor: pointer; font-size: 14px;
      display: flex; align-items: center; justify-content: center;
      z-index: 10; transition: transform 0.15s ease;
    }
    .collapse-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }

    .resize-handle {
      position: absolute; top: 0; right: 0;
      width: 4px; height: 100%;
      cursor: col-resize;
      background: transparent;
      z-index: 15;
    }
    .resize-handle:hover, .resize-handle.dragging {
      background: var(--vscode-focusBorder);
    }
    .sidebar.collapsed .resize-handle { display: none; }

    .sidebar-content { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
    .sidebar-header {
      padding: 12px 16px;
      padding-right: 44px;
      border-bottom: 1px solid var(--vscode-widget-border);
      background: var(--vscode-editor-background);
    }
    .sidebar-header h2 { margin: 0 0 6px 0; font-size: 14px; }
    .summary { font-size: 12px; color: var(--vscode-descriptionForeground); }
    .summary .add { color: #3fb950; margin-left: 8px; }
    .summary .del { color: #f85149; margin-left: 4px; }
    .btn-row { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
    .refresh-btn, .view-toggle {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none; padding: 4px 10px; border-radius: 3px;
      cursor: pointer; font-size: 11px;
    }
    .view-toggle.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .edit-toggle {
      display: flex; align-items: center; gap: 6px;
      cursor: pointer; font-size: 11px;
      color: var(--vscode-foreground);
    }
    .edit-toggle input[type="checkbox"] {
      width: 14px; height: 14px;
      accent-color: var(--vscode-button-background);
      cursor: pointer;
    }
    .toggle-label { user-select: none; }
    .line-content.editable[contenteditable="true"] {
      outline: none;
      border-radius: 2px;
      cursor: text;
    }
    .line-content.editable[contenteditable="true"]:focus {
      background: var(--vscode-editor-selectionBackground);
    }
    .line-content.editable[contenteditable="true"]:hover {
      background: rgba(255,255,255,0.05);
    }
    .line-content.editable.modified {
      border-left: 2px solid var(--vscode-gitDecoration-modifiedResourceForeground, #d29922);
    }
    .toc { flex: 1; overflow-y: auto; padding: 8px 0; }
    .toc-item {
      display: flex; align-items: center; gap: 8px;
      padding: 5px 12px; text-decoration: none;
      color: var(--vscode-foreground); font-size: 12px;
    }
    .toc-item:hover { background: var(--vscode-list-hoverBackground); }
    .toc-filename {
      flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .toc-stats { font-size: 11px; white-space: nowrap; }
    .toc-stats .add { color: #3fb950; }
    .toc-stats .del { color: #f85149; margin-left: 4px; }

    /* Main content */
    .main { flex: 1; overflow-y: auto; padding: 16px; min-width: 0; }

    /* File sections */
    .file-section {
      margin-bottom: 24px;
      border: 1px solid var(--vscode-widget-border);
      border-radius: 6px;
      overflow: hidden;
    }
    .file-section.minimized .diff-wrapper { display: none; }
    .file-section.minimized .collapse-icon { transform: rotate(-90deg); }

    .file-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 14px;
      background: var(--vscode-editor-lineHighlightBackground, rgba(255,255,255,0.04));
      border-bottom: 1px solid var(--vscode-widget-border);
      cursor: pointer;
      user-select: none;
    }
    .file-header:hover { background: var(--vscode-list-hoverBackground); }
    .file-info { display: flex; align-items: center; gap: 8px; }
    .collapse-icon {
      font-size: 10px; transition: transform 0.15s ease;
      color: var(--vscode-descriptionForeground);
    }
    .file-info .filename {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 13px; font-weight: 500;
    }
    .file-stats { display: flex; align-items: center; gap: 10px; font-size: 12px; }
    .file-stats .add { color: #3fb950; }
    .file-stats .del { color: #f85149; }
    .open-btn {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none; padding: 4px 10px; border-radius: 3px;
      cursor: pointer; font-size: 11px;
    }
    .open-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }

    /* Status icons */
    .status { font-weight: bold; font-size: 11px; width: 16px; text-align: center; }
    .status.added { color: #3fb950; }
    .status.modified { color: #d29922; }
    .status.deleted { color: #f85149; }
    .status.renamed { color: #a371f7; }

    /* Diff wrapper */
    .diff-wrapper { width: 100%; }
    .diff-content {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px; line-height: 1.4;
      width: 100%;
    }

    /* Inline view */
    .inline-view { overflow-x: auto; }
    .inline-view .diff-table { width: 100%; border-collapse: collapse; min-width: max-content; }
    .inline-view .diff-line { display: table-row; }
    .inline-view .diff-line.add { background: rgba(63, 185, 80, 0.15); }
    .inline-view .diff-line.del { background: rgba(248, 81, 73, 0.15); }
    .inline-view .diff-line.hunk { background: rgba(56, 139, 253, 0.1); }
    .inline-view .line-num {
      display: table-cell;
      width: 50px; min-width: 50px; padding: 0 8px;
      text-align: right; color: var(--vscode-editorLineNumber-foreground);
      user-select: none; border-right: 1px solid var(--vscode-widget-border);
      font-size: 11px; vertical-align: top;
    }
    .inline-view .line-content {
      display: table-cell;
      padding: 0 12px; white-space: pre;
    }

    /* Side-by-side view */
    .split-view { display: flex; width: 100%; }
    .split-pane {
      flex: 1; width: 50%;
      display: flex; flex-direction: column;
      border-right: 1px solid var(--vscode-widget-border);
      min-width: 0;
    }
    .split-pane:last-child { border-right: none; }
    .split-pane .pane-header {
      padding: 4px 12px; font-size: 11px;
      background: var(--vscode-editor-lineHighlightBackground);
      color: var(--vscode-descriptionForeground);
      border-bottom: 1px solid var(--vscode-widget-border);
      flex-shrink: 0;
    }
    .split-pane .pane-scroll {
      overflow-x: auto;
    }
    .split-view .diff-line { display: flex; min-height: 20px; }
    .split-view .diff-line.add { background: rgba(63, 185, 80, 0.15); }
    .split-view .diff-line.del { background: rgba(248, 81, 73, 0.15); }
    .split-view .diff-line.hunk { background: rgba(56, 139, 253, 0.1); }
    .split-view .diff-line.empty { background: rgba(128,128,128,0.05); }
    .split-view .line-num {
      width: 45px; min-width: 45px; padding: 0 8px;
      text-align: right; color: var(--vscode-editorLineNumber-foreground);
      user-select: none; font-size: 11px; flex-shrink: 0;
    }
    .split-view .line-content {
      flex: 1; padding: 0 12px; white-space: pre;
    }

    .no-diff { padding: 16px; text-align: center; color: var(--vscode-descriptionForeground); }
    .empty-state { text-align: center; padding: 48px; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <div class="container">
    <div class="sidebar" id="sidebar">
      <button class="collapse-btn" id="collapseBtn" title="Toggle sidebar">\u25C0</button>
      <div class="resize-handle" id="resizeHandle"></div>
      <div class="sidebar-content">
        <div class="sidebar-header">
          <h2>Changes from ${this.escapeHtml(this.currentBranch)}</h2>
          <div class="summary">
            ${diffResults.length} files
            <span class="add">+${totalAdditions}</span>
            <span class="del">-${totalDeletions}</span>
          </div>
          <div class="btn-row">
            <button class="view-toggle active" data-view="inline">Inline</button>
            <button class="view-toggle" data-view="split">Side by Side</button>
            <button class="refresh-btn" onclick="refresh()">Refresh</button>
          </div>
          <div class="btn-row" style="margin-top: 6px;">
            <label class="edit-toggle">
              <input type="checkbox" id="inlineEditingToggle" ${this.inlineEditingEnabled ? 'checked' : ''}>
              <span class="toggle-label">Inline Editing</span>
            </label>
          </div>
        </div>
        <div class="toc">${tocItems}</div>
      </div>
    </div>
    <div class="main">
      ${diffResults.length === 0 ? '<div class="empty-state">No changes found</div>' : fileSections}
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const sidebar = document.getElementById('sidebar');
    const collapseBtn = document.getElementById('collapseBtn');
    const resizeHandle = document.getElementById('resizeHandle');

    collapseBtn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
    });

    let isResizing = false;
    let startX, startWidth;

    resizeHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = sidebar.offsetWidth;
      resizeHandle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const diff = e.clientX - startX;
      const newWidth = Math.max(150, Math.min(600, startWidth + diff));
      sidebar.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        resizeHandle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });

    document.querySelectorAll('.file-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.classList.contains('open-btn')) return;

        const section = header.closest('.file-section');

        if (e.altKey) {
          const allSections = document.querySelectorAll('.file-section');
          const anyExpanded = [...allSections].some(s => !s.classList.contains('minimized'));
          allSections.forEach(s => {
            if (anyExpanded) {
              s.classList.add('minimized');
            } else {
              s.classList.remove('minimized');
            }
          });
        } else {
          section.classList.toggle('minimized');
        }
      });
    });

    document.querySelectorAll('.open-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const file = btn.closest('.file-header').dataset.file;
        vscode.postMessage({ command: 'openFile', file });
      });
    });

    document.querySelectorAll('.view-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        document.querySelectorAll('.view-toggle').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        document.querySelectorAll('.inline-view').forEach(el => {
          el.style.display = view === 'inline' ? 'block' : 'none';
        });
        document.querySelectorAll('.split-view').forEach(el => {
          el.style.display = view === 'split' ? 'flex' : 'none';
        });
      });
    });

    function refresh() { vscode.postMessage({ command: 'refresh' }); }

    // Inline editing toggle
    const inlineEditingToggle = document.getElementById('inlineEditingToggle');
    let inlineEditingEnabled = ${this.inlineEditingEnabled};

    function updateEditableState() {
      // Only make .editable elements contenteditable (right side / current version)
      const editableElements = document.querySelectorAll('.line-content.editable');
      editableElements.forEach(el => {
        if (inlineEditingEnabled) {
          el.setAttribute('contenteditable', 'true');
          el.dataset.original = el.textContent || '';
        } else {
          el.removeAttribute('contenteditable');
        }
      });
    }

    function saveEdit(el) {
      const file = el.dataset.file;
      const line = parseInt(el.dataset.line, 10);
      const content = el.textContent || '';
      const original = el.dataset.original || '';

      if (content !== original && file && line) {
        vscode.postMessage({ command: 'saveEdit', file, line, content });
        el.dataset.original = content;
      }
    }

    // Initialize editable state
    updateEditableState();

    // Handle blur to save edits
    document.addEventListener('blur', (e) => {
      if (e.target.classList && e.target.classList.contains('editable') && inlineEditingEnabled) {
        saveEdit(e.target);
      }
    }, true);

    // Handle Ctrl+S to save current edit
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const focused = document.activeElement;
        if (focused && focused.classList.contains('editable') && inlineEditingEnabled) {
          saveEdit(focused);
        }
      }
    });

    inlineEditingToggle.addEventListener('change', (e) => {
      inlineEditingEnabled = e.target.checked;
      updateEditableState();
      vscode.postMessage({ command: 'toggleInlineEditing', enabled: inlineEditingEnabled });
    });
  </script>
</body>
</html>`;
  }

  private parseDiff(diff: string, filePath: string): { inlineHtml: string; leftHtml: string; rightHtml: string } {
    if (!diff) return { inlineHtml: '', leftHtml: '', rightHtml: '' };

    const lines = diff.split('\n');
    let inlineHtml = '<div class="diff-table">';
    let leftHtml = '';
    let rightHtml = '';

    let oldLine = 0;
    let newLine = 0;
    const escapedFile = this.escapeHtml(filePath);

    for (const line of lines) {
      if (line.startsWith('diff --git') || line.startsWith('index ') ||
          line.startsWith('---') || line.startsWith('+++')) {
        continue;
      }

      const hunkMatch = line.match(/^@@ -(\d+),?\d* \+(\d+),?\d* @@(.*)/);
      if (hunkMatch) {
        oldLine = parseInt(hunkMatch[1], 10);
        newLine = parseInt(hunkMatch[2], 10);

        inlineHtml += `<div class="diff-line hunk">
          <span class="line-num"></span><span class="line-num"></span>
          <span class="line-content">${this.escapeHtml(line)}</span>
        </div>`;

        leftHtml += `<div class="diff-line hunk"><span class="line-num"></span><span class="line-content">${this.escapeHtml(line)}</span></div>`;
        rightHtml += `<div class="diff-line hunk"><span class="line-num"></span><span class="line-content">${this.escapeHtml(line)}</span></div>`;
        continue;
      }

      // Strip the +/- prefix for display, keep original for non-editable
      const contentWithoutPrefix = line.length > 0 ? line.substring(1) : '';

      if (line.startsWith('+')) {
        // Added lines are editable (they exist in current version)
        inlineHtml += `<div class="diff-line add">
          <span class="line-num"></span><span class="line-num">${newLine}</span>
          <span class="line-content editable" data-file="${escapedFile}" data-line="${newLine}">${this.escapeHtml(contentWithoutPrefix)}</span>
        </div>`;

        leftHtml += `<div class="diff-line empty"><span class="line-num"></span><span class="line-content"></span></div>`;
        rightHtml += `<div class="diff-line add"><span class="line-num">${newLine}</span><span class="line-content editable" data-file="${escapedFile}" data-line="${newLine}">${this.escapeHtml(contentWithoutPrefix)}</span></div>`;
        newLine++;
      } else if (line.startsWith('-')) {
        // Deleted lines are NOT editable (they only exist in branch version)
        inlineHtml += `<div class="diff-line del">
          <span class="line-num">${oldLine}</span><span class="line-num"></span>
          <span class="line-content">${this.escapeHtml(line)}</span>
        </div>`;

        leftHtml += `<div class="diff-line del"><span class="line-num">${oldLine}</span><span class="line-content">${this.escapeHtml(contentWithoutPrefix)}</span></div>`;
        rightHtml += `<div class="diff-line empty"><span class="line-num"></span><span class="line-content"></span></div>`;
        oldLine++;
      } else if (line.length > 0) {
        // Context lines - strip leading space, editable in current version
        const contextContent = line.startsWith(' ') ? line.substring(1) : line;
        inlineHtml += `<div class="diff-line">
          <span class="line-num">${oldLine}</span><span class="line-num">${newLine}</span>
          <span class="line-content editable" data-file="${escapedFile}" data-line="${newLine}">${this.escapeHtml(contextContent)}</span>
        </div>`;

        leftHtml += `<div class="diff-line"><span class="line-num">${oldLine}</span><span class="line-content">${this.escapeHtml(contextContent)}</span></div>`;
        rightHtml += `<div class="diff-line"><span class="line-num">${newLine}</span><span class="line-content editable" data-file="${escapedFile}" data-line="${newLine}">${this.escapeHtml(contextContent)}</span></div>`;
        oldLine++;
        newLine++;
      }
    }

    inlineHtml += '</div>';

    return { inlineHtml, leftHtml, rightHtml };
  }

  private getStatusIcon(status: string): string {
    switch (status) {
      case 'added': return 'A';
      case 'modified': return 'M';
      case 'deleted': return 'D';
      case 'renamed': return 'R';
      default: return '?';
    }
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
