import * as vscode from 'vscode';
import * as path from 'path';

/**
 * 后台索引服务，是插件高性能的核心。现在 query 方法已更新为支持模糊搜索。
 * 它负责在启动时扫描工作区建立索引，并在文件变化时动态更新索引。
 * 实现了 vscode.Disposable 接口，以便在插件停用时能被正确清理。
 */
export class IndexerService implements vscode.Disposable {
    // 使用 Map 存储索引。Key 是大写的文件名（不含后缀），Value 是包含该文件名的所有文件 Uri 数组。
    private index: Map<string, vscode.Uri[]> = new Map();
    private isIndexing = false;
    private watcher: vscode.FileSystemWatcher | undefined;

    constructor() {
        // 在服务实例化时，就初始化文件监视器
        this.initializeWatcher();
    }

    /**
     * 构建或重建整个工作区的索引。
     * 这是一个耗时操作，因此设计为异步，并提供UI反馈。
     */
    public async buildIndex(): Promise<void> {
        // 防止多个重建命令同时执行
        if (this.isIndexing) {
            vscode.window.showInformationMessage('FileHyperlink is already indexing.');
            return;
        }

        this.isIndexing = true;
        // 使用 VS Code 的进度条 API，在窗口左下角提供清晰的视觉反馈
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Window,
            title: 'FileHyperlink: Indexing...',
            cancellable: false
        }, async () => {
            try {
                // 清空旧索引，为重建做准备
                this.index.clear();

                // 从用户配置中读取需要包含的文件 glob 模式和需要排除的文件夹
                const includePatterns = vscode.workspace.getConfiguration('fileHyperlink').get<string[]>('indexing.filesToInclude', []);
                const excludePatterns = vscode.workspace.getConfiguration('fileHyperlink').get<string[]>('excludeFolders', []);

                // 将规则合并成 findFiles API 需要的格式
                const includeGlob = `{${includePatterns.join(',')}}`;
                const excludeGlob = `{${excludePatterns.join(',')}}`;

                // 执行文件查找
                const files = await vscode.workspace.findFiles(includeGlob, excludeGlob);

                // 遍历文件列表，填充索引 Map
                for (const file of files) {
                    // 将文件名处理成统一的 key 格式：大写且不带扩展名
                    const fileNameWithoutExt = path.parse(file.fsPath).name.toUpperCase();

                    if (!this.index.has(fileNameWithoutExt)) {
                        this.index.set(fileNameWithoutExt, []);
                    }
                    // 将文件的 Uri 添加到对应 key 的数组中
                    this.index.get(fileNameWithoutExt)?.push(file);
                }

                console.log(`FileHyperlink: Indexing complete. Found ${this.index.size} unique filenames.`);
                vscode.window.setStatusBarMessage('FileHyperlink: Indexing complete.', 5000);

            } catch (error) {
                vscode.window.showErrorMessage(`FileHyperlink: Error during indexing. ${error}`);
            } finally {
                this.isIndexing = false;
            }
        });
    }

    /**
     * 从索引中进行模糊查询。
     * @param searchText 用户选择的文本
     * @returns 包含所有匹配项的 Uri 数组，如果找不到则返回 undefined。
     */
    public query(searchText: string): vscode.Uri[] | undefined {
        const searchTextUpper = searchText.toUpperCase();
        const results: vscode.Uri[] = [];

        // 核心改动：遍历 Map 的所有键（已索引的文件名）
        for (const [indexedFileName, uris] of this.index.entries()) {
            // 对每个键进行“包含”检查，实现模糊匹配
            if (indexedFileName.includes(searchTextUpper)) {
                // 如果匹配成功，将这个键对应的所有文件 Uri 添加到结果中
                results.push(...uris);
            }
        }

        return results.length > 0 ? results : undefined;
    }

    /**
     * 初始化文件系统监视器，用于动态、增量地更新索引。
     */
    private initializeWatcher(): void {
        const includePatterns = vscode.workspace.getConfiguration('fileHyperlink').get<string[]>('indexing.filesToInclude', []);
        if (includePatterns.length === 0) return; // 如果没有配置，则不监视

        const includeGlob = `{${includePatterns.join(',')}}`;
        this.watcher = vscode.workspace.createFileSystemWatcher(includeGlob);

        // 文件创建事件处理
        this.watcher.onDidCreate(uri => {
            const fileName = path.parse(uri.fsPath).name.toUpperCase();
            if (!this.index.has(fileName)) {
                this.index.set(fileName, []);
            }
            const uris = this.index.get(fileName)!;
            if (!uris.some(existingUri => existingUri.fsPath === uri.fsPath)) {
                uris.push(uri);
            }
        });

        // 文件删除事件处理
        this.watcher.onDidDelete(uri => {
            const fileName = path.parse(uri.fsPath).name.toUpperCase();
            if (this.index.has(fileName)) {
                let uris = this.index.get(fileName)!;
                uris = uris.filter(existingUri => existingUri.fsPath !== uri.fsPath);
                if (uris.length > 0) {
                    this.index.set(fileName, uris);
                } else {
                    this.index.delete(fileName);
                }
            }
        });
    }

    /**
     * 实现 vscode.Disposable 接口。在插件停用时被调用，用于清理资源。
     */
    public dispose(): void {
        if (this.watcher) {
            // 必须销毁监视器，否则会造成资源泄漏
            this.watcher.dispose();
        }
    }
}