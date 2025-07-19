import * as vscode from 'vscode';
import * as path from 'path';

/**
 * 实现 VS Code 的 DefinitionProvider 接口，用于处理“转到定义”的请求。
 * 当用户按住 Cmd/Ctrl 并点击文本时，VS Code 会调用这个类的 provideDefinition 方法。
 */
class FileDefinitionProvider implements vscode.DefinitionProvider {
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
        const excludePatterns = vscode.workspace.getConfiguration('fileHyperlink').get<string[]>('excludeFolders', []);
        // 将数组形式的排除规则转换成 findFiles API 需要的 glob 字符串格式，例如 '{**/node_modules/**,**/dist/**}'。
        const excludeGlob = `{${excludePatterns.join(',')}}`;
        // 使用 VS Code API 在整个工作区内查找文件。'**/*' 表示查找所有子目录下的所有文件。
        const allFiles = await vscode.workspace.findFiles('**/*', excludeGlob, undefined, token);

        // --- 执行文件匹配 ---
        // 第一阶段：进行模糊匹配。
        // 遍历所有找到的文件，筛选出文件名（不含扩展名）包含选中文字的文件。
        const matchedFiles = allFiles.filter(fileUri => {
            // 使用 Node.js 的 path 模块来解析路径，并获取不带扩展名的文件名部分。
            const fileNameWithoutExt = path.parse(fileUri.fsPath).name;
            // 将文件名和搜索文本都转为小写，以实现不区分大小写的包含查询。
            return fileNameWithoutExt.toLowerCase().includes(selectedText.toLowerCase());
        });

        // 如果经过模糊匹配后一个文件都没找到，就没必要继续了。
        if (matchedFiles.length === 0) {
            return undefined;
        }

        // --- 执行“_SPARK”文件优选逻辑 ---
        // 第二阶段：在模糊匹配的结果中，再次筛选，找出文件名以 "_SPARK" 结尾的优先文件。
        const sparkFiles = matchedFiles.filter(fileUri => {
            const fileNameWithoutExt = path.parse(fileUri.fsPath).name;
            return fileNameWithoutExt.toLowerCase().endsWith('_spark');
        });

        // 定义一个变量，用于存放最终需要展示给用户的文件列表。
        let filesToShow: vscode.Uri[];

        // 判断是否存在优选的 _SPARK 文件。
        if (sparkFiles.length > 0) {
            // 如果找到了一个或多个 _SPARK 文件，那么最终列表就只包含这些优选文件。
            filesToShow = sparkFiles;
        } else {
            // 如果没有找到任何 _SPARK 文件，则回退到默认行为，显示所有模糊匹配到的文件。
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
 * 插件的激活函数，是整个插件的入口点。
 * 当满足 package.json 中 activationEvents 定义的条件时，VS Code 会调用此函数。
 * @param context 插件的上下文对象，用于管理插件的资源和订阅。
 */
export function activate(context: vscode.ExtensionContext) {
    // 注册我们的 DefinitionProvider。
    // 这行代码的作用就是告诉 VS Code：“嘿，当用户需要‘转到定义’时，请使用我的 FileDefinitionProvider 类的逻辑”。
    const disposable = vscode.languages.registerDefinitionProvider(
        ['*'], // 第一个参数是 DocumentSelector，['*'] 表示对所有语言和文件类型都生效。
        new FileDefinitionProvider()
    );

    // 将注册的 provider 添加到插件的订阅中。
    // 这样做可以确保当插件被停用时，VS Code 会自动清理掉这个 provider，避免内存泄漏。
    context.subscriptions.push(disposable);
}

/**
 * 插件的停用函数。
 * 在插件被禁用或 VS Code 关闭时调用，用于执行清理工作。
 */
export function deactivate() {}