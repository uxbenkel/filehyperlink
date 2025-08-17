## Features

Find and open files by selected text.
<br>FileHyperlink - Performance Overhaul & Smart Navigation

## Requirements

VS Code 1.64.0+

## Extension Settings

#### ⚙️ New & Updated Configuration Settings

You can now fine-tune the extension's behavior via the following settings:

* **`fileHyperlink.indexing.filesToInclude`**:
    * **Description**: The most important new setting for performance. Defines which files to include in the index using an array of glob patterns.
    * **Default**: `["**/*.sql", "**/*.hql"]`

* **`fileHyperlink.excludeFolders`**:
    * **Description**: An array of glob patterns for folders to exclude from indexing and all search operations.
    * **Default**: `["**/node_modules/**", "**/dist/**", ...]`

* **`fileHyperlink.excludeFilePatterns`**:
    * **Description**: An array of case-insensitive string patterns. Any file whose name contains one of these patterns will be filtered out from the final results.
    * **Default**: `["_CHK.hql"]`

## Release Notes

### 0.0.1

2025-07-20
Initial release of filehyperlink

### 0.0.2

2025-07-23
add file name partial match exclusion function

### 0.0.3

2025-08-17

This is a major update that completely rebuilds the core of the extension for a significantly faster and more powerful experience, especially in large workspaces. The on-demand file search has been replaced with a high-performance, asynchronous indexing engine.

#### ✨ New Features

* **High-Speed Indexing Engine:** Say goodbye to delays! The extension now builds an in-memory index of your workspace files upon startup. This makes file navigation via `Ctrl/Alt+Click` instantaneous, reducing response time from seconds to milliseconds.
* **Fuzzy Matching:** The file search logic now uses a "contains" match instead of an exact match. Searching for `component` will now find files like `my_component.ts`, `component_test.js`, etc.
* **Advanced Prioritization Logic:** A new, sophisticated set of rules has been implemented to automatically show you the most relevant files first. It prioritizes files ending with `_HOT_SPARK` and `_HOT`, and intelligently handles scenarios with only a few matches.
* **Manual Re-index Command:** A new command, `FileHyperlink: Rebuild Index`, has been added to the command palette (`Ctrl+Shift+P`). This allows you to manually refresh the file index at any time, which is perfect for after a large `git pull` or significant file changes.
* **Live Index Updates:** The index now automatically updates in the background when you create, delete, or rename files within the workspace.