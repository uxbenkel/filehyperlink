import * as vscode from 'vscode';
import * as path from 'path';

import { IndexerService } from './IndexerService'; // 导入我们的新服务

// 将 indexerService 提升为模块级变量，以便 deactivate 函数可以访问
let indexerService: IndexerService;

/**
 * 插件的激活函数，是整个插件的入口点。
 * @param context 插件的上下文对象，用于管理插件的资源和订阅。
 */
export function activate(context: vscode.ExtensionContext) {
    // 实例化索引服务，创建单例
    indexerService = new IndexerService();

    // 插件启动时，立即在后台开始构建索引 (无需 await，让它在后台运行)
    indexerService.buildIndex();

    // 注册“手动重建索引”的命令，并将其连接到索引服务的 buildIndex 方法
    const rebuildIndexCommand = vscode.commands.registerCommand('fileHyperlink.rebuildIndex', () => {
        indexerService.buildIndex();
    });

    // 注册 DefinitionProvider，并通过构造函数将索引服务实例“注入”进去
    const definitionProvider = vscode.languages.registerDefinitionProvider(
        ['*'], // 对所有文件类型生效
        new FileDefinitionProvider(indexerService)
    );

    // 将所有需要清理的资源（命令、Provider、服务本身）添加到插件的订阅中
    // 这样 VS Code 关闭时会自动调用它们的 dispose 方法
    context.subscriptions.push(rebuildIndexCommand, definitionProvider, indexerService);
}

/**
 * 实现 VS Code 的 DefinitionProvider 接口，用于处理“转到定义”的请求。
 * 当用户按住 Cmd/Ctrl 并点击文本时，VS Code 会调用这个类的 provideDefinition 方法。
 * DefinitionProvider 现在变得非常“轻”，它的主要职责是从索引服务查询结果，并对结果进行二次加工。
 */
class FileDefinitionProvider implements vscode.DefinitionProvider {
    // 在构造函数中接收 IndexerService 的实例，并保存为私有成员
    constructor(private indexerService: IndexerService) {}

    /**
     * VS Code 调用此方法来获取一个符号（在这里是选中的文本）的定义位置。
     * @param document  当前操作的文本文档对象。
     * @param position  当前光标在文档中的位置。
     * @param token     一个取消令牌，用于在操作耗时过长时中止。
     * @returns         返回一个或多个 Location 对象组成的数组，或者在找不到时返回 undefined。
     */
    public async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Definition | undefined> {

        // 获取当前活动的编辑器实例，因为我们需要从中获取用户的选择信息。
        const editor = vscode.window.activeTextEditor;
        // 如果没有活动的编辑器（例如，焦点在侧边栏），则无法继续，直接返回。
        if (!editor) {
            return undefined;
        }

        // --- 智能获取用户想要搜索的文本 ---
        // 默认情况下，先尝试获取光标所在位置的“单词”。
        let selectedText = document.getText(document.getWordRangeAtPosition(position));
        
        // 然后，检查用户是否用鼠标拖动进行了“显式选择”。
        const userSelection = document.getText(editor.selection);
        // 如果用户的选择不是空的（即确实拖动了鼠标），那么就用这个显式选择的文本覆盖掉默认获取的单词。
        // 这样可以支持查找包含空格或特殊符号的文件名。
        if (userSelection && !editor.selection.isEmpty) {
            selectedText = userSelection.trim(); // .trim() 用于去除首尾可能误选的空格
        }

        // 如果最终没有获取到任何有效文本，则中止操作。
        if (!selectedText) { 
            return undefined;
        }

        // --- 文件搜索准备 ---
        // 从 VS Code 的用户设置中读取需要排除的文件夹配置。
        // --- 核心逻辑变化：从“实时文件搜索”变为“即时内存查询” ---
        
        // 1. 从索引服务快速获取初步匹配列表，这是一个毫秒级的操作
        const allMatchesFromIndex = this.indexerService.query(selectedText);
        
        // 如果索引中没有任何匹配，则直接返回
        if (!allMatchesFromIndex || allMatchesFromIndex.length === 0) {
            return undefined;
        }

        // --- 在快速查询结果的基础上，执行我们之前定义好的高级过滤和优选逻辑 ---
        // 2. 应用“按文件名排除”的规则
        const excludeFilePatterns = vscode.workspace.getConfiguration('fileHyperlink').get<string[]>('excludeFilePatterns', []);
        let matchedFiles = allMatchesFromIndex;
        if (excludeFilePatterns.length > 0) {
            matchedFiles = allMatchesFromIndex.filter(fileUri => {
                // 这里我们用包含扩展名的完整文件名进行匹配，例如 "AB_CHK.hql"
                const fileNameWithExt = path.basename(fileUri.fsPath);
                // .some() 方法检查 excludeFilePatterns 数组中是否至少有一个模式被包含在文件名中。
                // 如果是，则 .some() 返回 true，我们用 ! 将其反转为 false，从而将该文件排除。
                return !excludeFilePatterns.some(pattern => fileNameWithExt.toUpperCase().includes(pattern.toUpperCase()));
            });
        }
        
        // 如果经过所有匹配和过滤后一个文件都没找到，就没必要继续了。
        if (matchedFiles.length === 0) {
             return undefined;
             }

        // --- 执行“_SPARK”文件优选逻辑 ---
        // 3a. 在当前匹配结果中，预先找出所有特殊类型的文件
        const hotSparkFiles = matchedFiles.filter(uri => path.parse(uri.fsPath).name.toUpperCase().endsWith('_HOT_SPARK'));
        const hotFiles = matchedFiles.filter(uri => path.parse(uri.fsPath).name.toUpperCase().endsWith('_HOT'));
        const sparkFiles = matchedFiles.filter(uri => path.parse(uri.fsPath).name.toUpperCase().endsWith('_SPARK'));

        // 定义一个变量，用于存放最终需要展示给用户的文件列表。
        let filesToShow: vscode.Uri[];

        // 判断是否存在优选的 _SPARK 文件。
        // 3b. 按照“HOT_SPARK” -> “HOT” -> “SPARK (仅2个匹配时)”的优先级阶梯进行判断
        if (hotSparkFiles.length > 0) {
            // 最高优先级：如果找到了 _HOT_SPARK 文件，则只显示它们。
            filesToShow = hotSparkFiles;
        } else if (hotFiles.length > 0) {
            // 次高优先级：如果没有 _HOT_SPARK，但找到了 _HOT 文件，则只显示它们。
            filesToShow = hotFiles;
        } else if (matchedFiles.length === 2 && sparkFiles.length > 0) {
            // 只有当模糊匹配结果总数正好为 2，并且其中存在 _SPARK 文件时，才触发优选逻辑。
            filesToShow = sparkFiles;
        } else {
            // 其他所有情况（匹配数不为2，或匹配数为2但没有_SPARK文件），都回退到显示全部模糊匹配结果。
            filesToShow = matchedFiles;
        }

        // --- 返回最终结果 ---
        // 这是解决“触发过于灵敏”问题的关键：始终返回一个 Location 对象的数组。
        // 当 VS Code 收到一个数组（即使数组里只有一个元素）时，它会打开一个“窥视窗口”(Peek View) 而不是直接跳转。
        // 这个“窥视窗口”需要用户进行二次点击，从而提供了一个操作缓冲，避免了连锁反应。
        return filesToShow.map(fileUri => 
            // 将每个文件的 Uri 转换成一个 Location 对象，位置指向文件的开头 (第0行, 第0列)。
            new vscode.Location(fileUri, new vscode.Position(0, 0))
        );
    }
}

/**
 * 插件的停用函数。
 * 在插件被禁用或 VS Code 关闭时调用，用于执行清理工作。
 * 会调用 context.subscriptions 中所有对象的 dispose 方法。
 * 我们在这里确保 indexerService 的 dispose 被调用，从而清理掉文件监视器。
 */
export function deactivate() {
    if (indexerService) {
        indexerService.dispose();
    }
}