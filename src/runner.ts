import { t } from './i18n';
import * as path from 'node:path';
import { errorMessage } from './errors';
import { prepareCase } from './preflight';
import { RunQueue } from './run-queue';
import { executeManaged } from './run-process';
import { RunMonitor } from './run-monitor';
function executablePath(value) {
  const text = String(value || '').trim();
  const clean = /^(["']).*\1$/.test(text) ? text.slice(1, -1) : text;
  if (!clean) {
    return undefined;
  }
  if (!path.isAbsolute(clean)) {
    throw Error(t('runner.absolutePathRequired'));
  }
  return clean;
}
function createRunTask(vscode, uri, executable) {
  const folder = vscode.workspace.getWorkspaceFolder(uri) || vscode.workspace.workspaceFolders?.[0];
  const execution = new vscode.ProcessExecution(executable, [uri.fsPath], {
    cwd: path.dirname(uri.fsPath),
  });
  const task = new vscode.Task(
    { type: 'openfast', input: uri.toString() },
    folder || vscode.TaskScope.Workspace,
    t('runner.taskName', path.basename(uri.fsPath)),
    'OpenFAST',
    execution,
    [],
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Dedicated,
    clear: true,
  };
  return task;
}
function pathStore(vscode, context, uri) {
  const folder = uri && vscode.workspace.getWorkspaceFolder(uri);
  return {
    state: vscode.workspace.workspaceFolders?.length ? context.workspaceState : context.globalState,
    key: 'openfast.runner.path:' + (folder?.uri.toString() || 'default'),
  };
}
function readExecutable(vscode, context, uri) {
  const configured = vscode.workspace.getConfiguration('openfast', uri).get('executablePath', '');
  const { state, key } = pathStore(vscode, context, uri);
  const saved =
    state?.get(key) ||
    state?.get('openfast.runner.path:default') ||
    context.globalState?.get('openfast.runner.path:default');
  return saved && (!configured || configured === saved.previous) ? saved.path : configured;
}
async function saveExecutable(vscode, context, uri, value) {
  const config = vscode.workspace.getConfiguration('openfast', uri);
  const { state, key } = pathStore(vscode, context, uri);
  // Persist the user's selection even when the current window still has an older
  // configuration contribution registry after an in-place VSIX update.
  await state.update(key, { path: value, previous: config.get('executablePath', '') });
  if (config.inspect('executablePath')?.defaultValue === undefined) {
    return false;
  }
  const folder = uri && vscode.workspace.getWorkspaceFolder(uri);
  const level = folder
    ? vscode.ConfigurationTarget.WorkspaceFolder
    : vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  try {
    await config.update('executablePath', value, level);
    await state.update(key, undefined);
    return true;
  } catch {
    return false;
  }
}
function registerRunner(vscode, context, workbench = undefined) {
  const pending = new Set();
  let queue: RunQueue;
  const runtimeCollections = new Map();
  const managed = !!workbench;
  const monitor =
    managed && vscode.window.createWebviewPanel
      ? new RunMonitor(vscode, () =>
          readExecutable(
            vscode,
            context,
            vscode.window.activeTextEditor?.document.uri ||
              vscode.workspace.workspaceFolders?.[0]?.uri,
          ),
        )
      : undefined;
  if (monitor) context.subscriptions.push(monitor);
  const queueEvents = managed ? new vscode.EventEmitter() : undefined;
  let preparation = Promise.resolve();
  const trusted = () => {
    if (vscode.workspace.isTrusted) {
      return true;
    }
    void vscode.window.showWarningMessage(t('runner.trustRequired'));
    return false;
  };
  const target = (resource) => {
    const value = resource?.uri || resource || vscode.window.activeTextEditor?.document.uri;
    return typeof value === 'string' ? vscode.Uri.parse(value) : value;
  };
  async function configure(resource) {
    if (!trusted()) {
      return;
    }
    const selected = await vscode.window.showOpenDialog({
      title: t('runner.selectExecutable'),
      canSelectMany: false,
      canSelectFiles: true,
      canSelectFolders: false,
    });
    const file = selected?.[0];
    if (!file) {
      return;
    }
    if (file.scheme !== 'file') {
      throw Error(t('runner.localExecutableRequired'));
    }
    const scope = target(resource);
    const inSettings = await saveExecutable(vscode, context, scope, file.fsPath);
    void vscode.window.showInformationMessage(
      inSettings ? t('runner.pathSaved') : t('runner.pathSavedFallback'),
    );
    return file.fsPath;
  }
  async function launch(resource, signal?: AbortSignal) {
    if (!trusted()) {
      return;
    }
    const uri = target(resource);
    if (!uri || uri.scheme !== 'file' || !/\.(fst|fstf)$/i.test(uri.path)) {
      throw Error(t('runner.savedLocalFstRequired'));
    }
    if (!vscode.workspace.workspaceFolders?.length) {
      throw Error(t('runner.workspaceRequired'));
    }
    const key = uri.toString();
    if (
      pending.has(key) ||
      vscode.tasks.taskExecutions.some(
        (e) => e.task.definition.type === 'openfast' && e.task.definition.input === key,
      )
    ) {
      void vscode.window.showInformationMessage(t('runner.alreadyRunning'));
      return;
    }
    pending.add(key);
    try {
      const executable =
        executablePath(readExecutable(vscode, context, uri)) || (await configure(uri));
      if (!executable) {
        if (managed) queue.cancel(key);
        return;
      }
      let stat;
      try {
        stat = await vscode.workspace.fs.stat(vscode.Uri.file(executable));
      } catch {
        throw Error(t('runner.executableNotFound'));
      }
      if (!(stat.type & vscode.FileType.File)) {
        throw Error(t('runner.fileRequired'));
      }
      // Serialize dialogs and saves across workers that may share module files.
      const ready = preparation.then(() =>
        signal?.aborted ? false : prepareCase(vscode, workbench, uri),
      );
      preparation = ready.then(
        () => undefined,
        () => undefined,
      );
      if (!(await ready)) {
        if (managed) queue.cancel(key);
        return;
      }
      if (signal?.aborted || !trusted()) return;
      await vscode.workspace.fs.stat(uri);
      if (managed) {
        const graph = await workbench.graphFor(uri, true);
        if (!graph || signal?.aborted) return;
        let diagnostics = runtimeCollections.get(key);
        if (!diagnostics) {
          diagnostics = vscode.languages.createDiagnosticCollection('openfast-runtime-' + key);
          runtimeCollections.set(key, diagnostics);
          context.subscriptions.push(diagnostics);
        }
        diagnostics.clear();
        return await executeManaged(
          vscode,
          uri,
          executable,
          graph,
          diagnostics,
          signal,
          () => queue.cancel(key),
          {
            started: (pid) => monitor?.started(key, pid),
            output: (value) => monitor?.output(key, value),
          },
        );
      }
      await vscode.tasks.executeTask(createRunTask(vscode, uri, executable));
      return { started: true, input: key, executable };
    } finally {
      pending.delete(key);
    }
  }
  async function run(resource) {
    if (!managed) return launch(resource);
    if (!trusted()) return;
    const uri = target(resource);
    if (!uri || uri.scheme !== 'file' || !/\.(fst|fstf)$/i.test(uri.path))
      throw Error(t('runner.savedLocalFstRequired'));
    if (!vscode.workspace.workspaceFolders?.length) throw Error(t('runner.workspaceRequired'));
    queue.concurrency = vscode.workspace.getConfiguration('openfast').get('runConcurrency', 1);
    if (!queue.add(uri.toString())) {
      void vscode.window.showInformationMessage(t('runner.alreadyRunning'));
      return;
    }
    return { queued: true, input: uri.toString() };
  }
  const handled =
    (fn) =>
    async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        void vscode.window.showErrorMessage(t('common.errorMessage', errorMessage(error)));
        return undefined;
      }
    };
  if (managed) {
    queue = new RunQueue(
      async (job, signal) => {
        try {
          return !!(await launch(vscode.Uri.parse(job.key), signal));
        } catch (error) {
          if (!signal.aborted)
            void vscode.window.showErrorMessage(t('common.errorMessage', errorMessage(error)));
          throw error;
        }
      },
      (jobs) => {
        queueEvents.fire();
        monitor?.sync(jobs);
      },
      vscode.workspace.getConfiguration('openfast').get('runConcurrency', 1),
    );
    const provider = {
      onDidChangeTreeData: queueEvents.event,
      getChildren: () => [...queue.jobs.values()],
      getTreeItem(job) {
        const uri = vscode.Uri.parse(job.key);
        const item = new vscode.TreeItem(path.basename(uri.fsPath));
        item.description = t(`queue.${job.state}` as Parameters<typeof t>[0]);
        item.tooltip = uri.fsPath + (job.error ? '\n' + job.error : '');
        item.resourceUri = uri;
        item.contextValue = 'openfastRun-' + job.state;
        item.command = { command: 'vscode.open', title: t('queue.open'), arguments: [uri] };
        item.iconPath = new vscode.ThemeIcon(
          {
            waiting: 'clock',
            running: 'sync~spin',
            success: 'pass',
            failed: 'error',
            cancelled: 'circle-slash',
          }[job.state],
        );
        return item;
      },
    };
    const batch = async (resource, resources) => {
      if (!trusted()) return;
      if (!vscode.workspace.workspaceFolders?.length) throw Error(t('runner.workspaceRequired'));
      const supplied = Array.isArray(resources)
        ? resources
        : Array.isArray(resource)
          ? resource
          : undefined;
      const files =
        supplied ||
        (await vscode.window.showOpenDialog({
          canSelectMany: true,
          filters: { OpenFAST: ['fst', 'fstf'] },
          title: t('queue.select'),
        }));
      if (!files?.length) return;
      if (files.some((uri) => uri.scheme !== 'file' || !/\.(fst|fstf)$/i.test(uri.path)))
        throw Error(t('runner.savedLocalFstRequired'));
      // Resolve the program once before queue workers start, avoiding concurrent pickers.
      const executable =
        executablePath(readExecutable(vscode, context, files[0])) || (await configure(files[0]));
      if (!executable) return;
      queue.concurrency = vscode.workspace.getConfiguration('openfast').get('runConcurrency', 1);
      queue.batch(() => {
        for (const uri of files) {
          if (uri.scheme === 'file') queue.add(uri.toString());
        }
      });
      await vscode.commands.executeCommand('openfast.runQueue.focus');
    };
    context.subscriptions.push(
      queueEvents,
      queue,
      vscode.window.registerTreeDataProvider('openfast.runQueue', provider),
      vscode.commands.registerCommand('openfast.runBatch', handled(batch)),
      vscode.commands.registerCommand('openfast.cancelRun', (job) => queue.cancel(job.key)),
      vscode.commands.registerCommand('openfast.retryRun', (job) => queue.retry(job.key)),
      vscode.commands.registerCommand('openfast.cancelAllRuns', () => {
        queue.batch(() => {
          for (const key of queue.jobs.keys()) queue.cancel(key);
        });
      }),
      vscode.commands.registerCommand(
        'openfast.openRunDirectory',
        handled(async (job) => {
          const uri = vscode.Uri.parse(job.key);
          await vscode.commands.executeCommand('revealFileInOS', uri);
        }),
      ),
    );
  }
  if (vscode.window.createStatusBarItem) {
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 30);
    const refresh = () => {
      status.text = t('runner.statusPath');
      status.command = 'openfast.configureExecutable';
      status.tooltip = t('runner.statusTooltip');
      const doc = vscode.window.activeTextEditor?.document;
      if (doc && (doc.languageId === 'openfast' || /\.(fst|fstf)$/i.test(doc.uri.path))) {
        status.show();
      } else {
        status.hide();
      }
    };
    context.subscriptions.push(
      status,
      vscode.window.onDidChangeActiveTextEditor(refresh),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('openfast.language')) {
          refresh();
          queueEvents?.fire();
        }
      }),
    );
    refresh();
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('openfast.configureExecutable', handled(configure)),
    vscode.commands.registerCommand('openfast.runFst', handled(run)),
    vscode.tasks.onDidEndTaskProcess((event) => {
      if (
        event.execution.task.definition.type === 'openfast' &&
        event.exitCode !== undefined &&
        event.exitCode !== 0
      ) {
        void vscode.window.showErrorMessage(t('runner.exitCode', event.exitCode));
      }
    }),
  );
  return { queue, monitor };
}
export { executablePath, createRunTask, registerRunner, readExecutable, saveExecutable };
