# Branch Diff Viewer

A VS Code extension to view diffs against main or any branch with a GitHub-style unified diff view.

## Features

- **Full Diff View**: See all changed files in one scrollable view (GitHub-style)
- **View Modes**: Toggle between inline and side-by-side diff views
- **Collapsible Sidebar**: Resizable file list sidebar with drag handle
- **Minimize Diffs**: Click to minimize individual files, Alt+Click to minimize/expand all
- **Single File Diff**: Compare individual files using VS Code's built-in diff editor
- **Branch Selection**: Compare against main or any branch
- **No Publishing Required**: Works with local branches without pushing to remote

## Commands

| Command | Description |
|---------|-------------|
| `Diff with Main Branch` | Show all changes compared to main branch |
| `Diff with Branch...` | Show all changes compared to selected branch |
| `Diff Current File with Main` | Open diff for current file against main |
| `Diff Current File with Branch...` | Open diff for current file against selected branch |

Access commands via:
- Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
- Right-click context menu in editor or explorer

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `diffViewer.defaultBranch` | `main` | Default branch to compare against |

## Usage

1. Open a git repository in VS Code
2. Run `Diff with Main Branch` from the command palette
3. View all changed files with inline diffs
4. Toggle between inline/side-by-side view using the button
5. Click file headers to minimize/expand diffs
6. Use Alt+Click to minimize/expand all diffs at once

## Requirements

- Git must be installed and available in PATH
- Must be in a git repository

## Repository

https://github.com/mantrakp04/diff-viewer

## License

MIT
