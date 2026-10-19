import type * as VSCode from 'vscode';

// 只根据当前工作区中的主输入文件识别项目，不受活动编辑器或历史任务影响。
export function registerProjectContext(
  vscode: typeof VSCode,
  context: VSCode.ExtensionContext,
): void {
  const pattern = '**/*.{[fF][sS][tT],[fF][sS][tT][fF]}';
  const exclude = '**/{node_modules,.git,test-results}/**';
  let pending: VSCode.CancellationTokenSource | undefined;
  let disposed = false;

  const refresh = async (): Promise<void> => {
    pending?.cancel();
    pending?.dispose();
    const request = new vscode.CancellationTokenSource();
    pending = request;
    try {
      const roots = vscode.workspace.workspaceFolders?.length
        ? await vscode.workspace.findFiles(pattern, exclude, 1, request.token)
        : [];
      // 删除文件或切换工作区后，旧查询不得覆盖较新的识别结果。
      if (!disposed && pending === request) {
        await vscode.commands.executeCommand('setContext', 'openfast.project', roots.length > 0);
      }
    } catch (error) {
      if (!disposed && pending === request) {
        await vscode.commands.executeCommand('setContext', 'openfast.project', false);
        console.warn('OpenFAST project detection:', error);
      }
    } finally {
      if (pending === request) {
        pending = undefined;
        request.dispose();
      }
    }
  };

  const watcher = vscode.workspace.createFileSystemWatcher(pattern, false, true, false);
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(refresh),
    watcher.onDidDelete(refresh),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
    {
      dispose() {
        disposed = true;
        pending?.cancel();
        pending?.dispose();
        pending = undefined;
      },
    },
  );
  void refresh();
}
