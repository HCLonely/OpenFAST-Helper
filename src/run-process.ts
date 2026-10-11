import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import * as path from 'node:path';
import { t } from './i18n';
import { interpretLog } from './run-log';

/** A VS Code task terminal that keeps raw output while interpreting a bounded log tail. */
export async function executeManaged(
  vscode,
  uri,
  executable,
  graph,
  diagnostics,
  signal: AbortSignal,
  onCancel = () => {},
  observer?: { started(pid: number): void; output(value: string): void },
): Promise<boolean> {
  const write = new vscode.EventEmitter();
  const exit = new vscode.EventEmitter();
  let child;
  let execution;
  let finished = false;
  let log = '';
  let resolveDone: (ok: boolean) => void;
  const done = new Promise<boolean>((resolve) => {
    resolveDone = resolve;
  });
  const finish = (ok: boolean, code: number) => {
    if (finished) return;
    finished = true;
    if (!signal.aborted) {
      const issues = interpretLog(log, graph);
      if (!ok && !issues.length)
        issues.push({
          uri: uri.toString(),
          line: 0,
          message: t('runLog.unknown') + '\n' + t('runner.exitCode', code),
        });
      const groups = new Map<string, any[]>();
      for (const issue of issues) {
        const values = groups.get(issue.uri) || [];
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(issue.line, 0, issue.line, 1),
          issue.message,
          vscode.DiagnosticSeverity.Error,
        );
        diagnostic.source = 'OpenFAST runtime';
        values.push(diagnostic);
        groups.set(issue.uri, values);
      }
      diagnostics.set([...groups].map(([key, values]) => [vscode.Uri.parse(key), values]));
      if (!ok) void vscode.window.showErrorMessage(t('runLog.failed', path.basename(uri.fsPath)));
    }
    exit.fire(code);
    resolveDone(ok && !signal.aborted);
  };
  const append = (value: string) => {
    log = (log + value).slice(-1_000_000);
    observer?.output(value);
    write.fire(value.replace(/\r?\n/g, '\r\n'));
  };
  const stop = () => {
    if (finished) return;
    if (child) child.kill();
    else finish(false, 130);
  };
  const abort = () => {
    stop();
    execution?.terminate();
  };
  signal.addEventListener('abort', abort, { once: true });
  const endSubscription = vscode.tasks.onDidEndTask((event) => {
    if (event.execution === execution && !finished) {
      onCancel();
      stop();
    }
  });
  try {
    if (signal.aborted) return false;
    const terminal = {
      onDidWrite: write.event,
      onDidClose: exit.event,
      open() {
        if (finished || signal.aborted) {
          exit.fire(130);
          return;
        }
        try {
          child = spawn(executable, [uri.fsPath], {
            cwd: path.dirname(uri.fsPath),
            windowsHide: true,
            shell: false,
          });
          child.once('spawn', () => observer?.started(child.pid));
          const stdout = new StringDecoder('utf8');
          const stderr = new StringDecoder('utf8');
          child.stdout.on('data', (chunk) => append(stdout.write(chunk)));
          child.stderr.on('data', (chunk) => append(stderr.write(chunk)));
          child.on('error', (error) => append(error.message + '\n'));
          child.on('close', (code) => {
            append(stdout.end());
            append(stderr.end());
            finish(code === 0, code ?? 1);
          });
        } catch (error) {
          append(String(error));
          finish(false, 1);
        }
      },
      close() {
        if (!finished) onCancel();
        stop();
      },
      handleInput: (data: string) => child?.stdin?.write(data),
    };
    const task = new vscode.Task(
      { type: 'openfast', input: uri.toString() },
      vscode.workspace.getWorkspaceFolder(uri) || vscode.workspace.workspaceFolders[0],
      t('runner.taskName', path.basename(uri.fsPath)),
      'OpenFAST',
      new vscode.CustomExecution(async () => terminal),
      [],
    );
    task.presentationOptions = {
      reveal: vscode.TaskRevealKind.Always,
      panel: vscode.TaskPanelKind.Dedicated,
      clear: true,
    };
    execution = await vscode.tasks.executeTask(task);
    if (signal.aborted) abort();
    return await done;
  } finally {
    signal.removeEventListener('abort', abort);
    endSubscription.dispose();
    write.dispose();
    exit.dispose();
  }
}
