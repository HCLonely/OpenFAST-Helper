import * as path from 'node:path';
import { createRunTask, readExecutable, saveExecutable } from './runner';
import { isTurbSimInput } from './run-input';
import { errorMessage } from './errors';
import { t } from './i18n';

/** TurbSim uses its own primary input and executable, without OpenFAST case checks. */
export function registerTurbSimRunner(vscode, context) {
  const pending = new Set<string>();
  const target = (resource) => {
    const value = resource?.uri || resource || vscode.window.activeTextEditor?.document.uri;
    return typeof value === 'string' ? vscode.Uri.parse(value) : value;
  };
  const trusted = () => {
    if (vscode.workspace.isTrusted) return true;
    void vscode.window.showWarningMessage(t('turbSimRunner.trustRequired'));
    return false;
  };
  const handled =
    (fn) =>
    async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        void vscode.window.showErrorMessage(t('common.errorMessage', errorMessage(error)));
      }
    };
  async function configure(resource) {
    if (!trusted()) return;
    const uri = target(resource);
    const selected = await vscode.window.showOpenDialog({
      title: t('turbSimRunner.selectExecutable'),
      canSelectMany: false,
      canSelectFiles: true,
      canSelectFolders: false,
    });
    const file = selected?.[0];
    if (!file) return;
    if (file.scheme !== 'file') throw Error(t('turbSimRunner.localExecutableRequired'));
    const saved = await saveExecutable(vscode, context, uri, file.fsPath, 'TurbSim');
    void vscode.window.showInformationMessage(
      saved ? t('turbSimRunner.pathSaved') : t('turbSimRunner.pathSavedFallback'),
    );
    return file.fsPath;
  }
  async function run(resource) {
    if (!trusted()) return;
    const uri = target(resource);
    if (!uri || uri.scheme !== 'file') throw Error(t('turbSimRunner.inputRequired'));
    if (!vscode.workspace.workspaceFolders?.length)
      throw Error(t('turbSimRunner.workspaceRequired'));
    const key = uri.toString();
    if (
      pending.has(key) ||
      vscode.tasks.taskExecutions.some(
        (execution) =>
          execution.task.definition.type === 'turbsim' && execution.task.definition.input === key,
      )
    ) {
      void vscode.window.showInformationMessage(t('turbSimRunner.alreadyRunning'));
      return;
    }
    pending.add(key);
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      if (!isTurbSimInput(uri.path, doc.getText())) throw Error(t('turbSimRunner.inputRequired'));
      const value = String(readExecutable(vscode, context, uri, 'TurbSim') || '').trim();
      const executable =
        (/^(["']).*\1$/.test(value) ? value.slice(1, -1) : value) || (await configure(uri));
      if (!executable) return;
      if (!path.isAbsolute(executable)) throw Error(t('turbSimRunner.absolutePathRequired'));
      let stat;
      try {
        stat = await vscode.workspace.fs.stat(vscode.Uri.file(executable));
      } catch {
        throw Error(t('turbSimRunner.executableNotFound'));
      }
      if (!(stat.type & vscode.FileType.File)) throw Error(t('turbSimRunner.fileRequired'));
      if (doc.isDirty && !(await doc.save())) throw Error(t('turbSimRunner.saveFailed'));
      // Saving may invoke a formatter or alter the input signature.
      if (!isTurbSimInput(uri.path, doc.getText())) throw Error(t('turbSimRunner.inputRequired'));
      if (!trusted()) return;
      await vscode.workspace.fs.stat(uri);
      const execution = await vscode.tasks.executeTask(
        createRunTask(vscode, uri, executable, 'TurbSim'),
      );
      return { started: true, input: key, executable, execution };
    } finally {
      pending.delete(key);
    }
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('openfast.configureTurbSimExecutable', handled(configure)),
    vscode.commands.registerCommand('openfast.runTurbSim', handled(run)),
    vscode.tasks.onDidEndTaskProcess((event) => {
      if (
        event.execution.task.definition.type === 'turbsim' &&
        event.exitCode !== undefined &&
        event.exitCode !== 0
      )
        void vscode.window.showErrorMessage(t('turbSimRunner.exitCode', event.exitCode));
    }),
  );
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 31);
  const refresh = () => {
    const doc = vscode.window.activeTextEditor?.document;
    const runnable =
      !!doc && doc.uri.scheme === 'file' && isTurbSimInput(doc.uri.path, doc.getText());
    void vscode.commands.executeCommand('setContext', 'openfast.runnableTurbSim', runnable);
    status.text = t('turbSimRunner.statusPath');
    status.tooltip = t('turbSimRunner.statusTooltip');
    status.command = 'openfast.configureTurbSimExecutable';
    if (runnable) status.show();
    else status.hide();
  };
  context.subscriptions.push(
    status,
    vscode.window.onDidChangeActiveTextEditor(refresh),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document === vscode.window.activeTextEditor?.document) refresh();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('openfast.language')) refresh();
    }),
  );
  refresh();
}
