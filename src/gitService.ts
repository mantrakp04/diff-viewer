import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

export interface DiffResult {
  file: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

export interface FileDiff {
  oldContent: string;
  newContent: string;
  diff: string;
}

export class GitService {
  private workspaceRoot: string;

  constructor() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      throw new Error('No workspace folder open');
    }
    this.workspaceRoot = folders[0].uri.fsPath;
  }

  async getBranches(): Promise<string[]> {
    try {
      const { stdout } = await execAsync('git branch -a', {
        cwd: this.workspaceRoot,
      });
      return stdout
        .split('\n')
        .map((b) => b.trim().replace(/^\*?\s*/, '').replace(/^remotes\/origin\//, ''))
        .filter((b) => b && !b.includes('HEAD'));
    } catch {
      return [];
    }
  }

  async getDefaultBranch(): Promise<string> {
    const config = vscode.workspace.getConfiguration('diffViewer');
    const defaultBranch = config.get<string>('defaultBranch', 'main');

    // Check if default branch exists
    const branches = await this.getBranches();
    if (branches.includes(defaultBranch)) {
      return defaultBranch;
    }
    if (branches.includes('master')) {
      return 'master';
    }
    return defaultBranch;
  }

  async getDiffSummary(branch: string): Promise<DiffResult[]> {
    try {
      const { stdout } = await execAsync(`git diff --numstat ${branch}...HEAD`, {
        cwd: this.workspaceRoot,
      });

      const results: DiffResult[] = [];
      const lines = stdout.split('\n').filter((l) => l.trim());

      for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length >= 3) {
          const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10);
          const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10);
          const file = parts[2];

          results.push({
            file,
            status: 'modified',
            additions,
            deletions,
          });
        }
      }

      // Get status for more accurate info
      const { stdout: statusOutput } = await execAsync(`git diff --name-status ${branch}...HEAD`, {
        cwd: this.workspaceRoot,
      });

      const statusMap = new Map<string, 'added' | 'modified' | 'deleted' | 'renamed'>();
      for (const line of statusOutput.split('\n').filter((l) => l.trim())) {
        const [status, ...fileParts] = line.split('\t');
        const fileName = fileParts[fileParts.length - 1];
        switch (status[0]) {
          case 'A':
            statusMap.set(fileName, 'added');
            break;
          case 'D':
            statusMap.set(fileName, 'deleted');
            break;
          case 'R':
            statusMap.set(fileName, 'renamed');
            break;
          default:
            statusMap.set(fileName, 'modified');
        }
      }

      for (const result of results) {
        result.status = statusMap.get(result.file) || 'modified';
      }

      return results;
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to get diff: ${error}`);
      return [];
    }
  }

  async getFileDiff(branch: string, filePath: string): Promise<FileDiff> {
    // Handle both relative and absolute paths
    const relativePath = path.isAbsolute(filePath)
      ? path.relative(this.workspaceRoot, filePath)
      : filePath;

    try {
      // Get old content from branch
      let oldContent = '';
      try {
        const { stdout } = await execAsync(`git show "${branch}:${relativePath}"`, {
          cwd: this.workspaceRoot,
          maxBuffer: 10 * 1024 * 1024,
        });
        oldContent = stdout;
      } catch {
        oldContent = '';
      }

      // Get current content
      let newContent = '';
      try {
        const { stdout } = await execAsync(`git show "HEAD:${relativePath}"`, {
          cwd: this.workspaceRoot,
          maxBuffer: 10 * 1024 * 1024,
        });
        newContent = stdout;
      } catch {
        // File might be new, read from disk
        try {
          const fullPath = path.isAbsolute(filePath)
            ? filePath
            : path.join(this.workspaceRoot, filePath);
          const doc = await vscode.workspace.openTextDocument(fullPath);
          newContent = doc.getText();
        } catch {
          newContent = '';
        }
      }

      // Get unified diff - try both syntaxes
      let diff = '';
      try {
        const { stdout } = await execAsync(`git diff "${branch}" -- "${relativePath}"`, {
          cwd: this.workspaceRoot,
          maxBuffer: 10 * 1024 * 1024,
        });
        diff = stdout;
      } catch {
        // Try three-dot syntax as fallback
        try {
          const { stdout } = await execAsync(`git diff "${branch}...HEAD" -- "${relativePath}"`, {
            cwd: this.workspaceRoot,
            maxBuffer: 10 * 1024 * 1024,
          });
          diff = stdout;
        } catch {
          diff = '';
        }
      }

      return { oldContent, newContent, diff };
    } catch (error) {
      throw new Error(`Failed to get file diff: ${error}`);
    }
  }

  async getAllChangedFiles(branch: string): Promise<string[]> {
    try {
      const { stdout } = await execAsync(`git diff --name-only ${branch}...HEAD`, {
        cwd: this.workspaceRoot,
      });
      return stdout.split('\n').filter((f) => f.trim());
    } catch {
      return [];
    }
  }
}
