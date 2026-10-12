const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { isTurbSimInput } = require('../out/run-input');
const { registerTurbSimRunner } = require('../out/turbsim-runner');
const { readExecutable, saveExecutable } = require('../out/runner');

const primary =
  '--------- TurbSim v2.00 Input File --------\n5 NumGrid_Z\n5 NumGrid_Y\n0.05 TimeStep\n60 AnalysisTime- duration';
function harness() {
  const commands = new Map(),
    messages = [],
    tasks = [],
    storage = new Map();
  const uri = {
    scheme: 'file',
    path: '/case/wind.inp',
    fsPath: path.resolve("case 空格 & $ ' chars/wind.inp"),
    toString() {
      return this.fsPath;
    },
  };
  const doc = { uri, isDirty: false, getText: () => primary, save: async () => true };
  const settings = {
    executablePath: path.resolve('openfast.exe'),
    turbSimExecutablePath: path.resolve('TurbSim.exe'),
  };
  const state = {
    get: (key) => storage.get(key),
    update: async (key, value) => storage.set(key, value),
  };
  const context = { subscriptions: [], workspaceState: state, globalState: state };
  const disposable = () => ({ dispose() {} });
  const status = { show() {}, hide() {} };
  let endProcess;
  const vscode = {
    workspace: {
      isTrusted: true,
      workspaceFolders: [{}],
      getWorkspaceFolder: () => undefined,
      getConfiguration: () => ({
        get: (key, fallback) => settings[key] ?? fallback,
        inspect: () => undefined,
      }),
      fs: { stat: async () => ({ type: 1 }) },
      openTextDocument: async () => doc,
      onDidChangeTextDocument: disposable,
      onDidChangeConfiguration: disposable,
    },
    window: {
      activeTextEditor: { document: doc },
      createStatusBarItem: () => status,
      onDidChangeActiveTextEditor: disposable,
      showWarningMessage: (value) => messages.push(value),
      showInformationMessage: (value) => messages.push(value),
      showErrorMessage: (value) => messages.push(value),
      showOpenDialog: async () => [
        { scheme: 'file', fsPath: path.resolve('selected TurbSim.exe') },
      ],
    },
    commands: {
      registerCommand: (name, callback) => {
        commands.set(name, callback);
        return disposable();
      },
      executeCommand: async () => {},
    },
    tasks: {
      taskExecutions: [],
      executeTask: async (task) => {
        const execution = { task };
        tasks.push(task);
        vscode.tasks.taskExecutions.push(execution);
        return execution;
      },
      onDidEndTaskProcess: (callback) => {
        endProcess = callback;
        return disposable();
      },
    },
    ProcessExecution: class {
      constructor(executable, args, options) {
        Object.assign(this, { executable, args, options });
      }
    },
    Task: class {
      constructor(definition, scope, name, source, execution) {
        Object.assign(this, { definition, scope, name, source, execution });
      }
    },
    Uri: { file: (fsPath) => ({ fsPath }) },
    FileType: { File: 1 },
    StatusBarAlignment: { Right: 2 },
    ConfigurationTarget: { Workspace: 2 },
    TaskScope: { Workspace: 2 },
    TaskRevealKind: { Always: 1 },
    TaskPanelKind: { Dedicated: 2 },
  };
  registerTurbSimRunner(vscode, context);
  return {
    vscode,
    context,
    commands,
    messages,
    tasks,
    doc,
    uri,
    settings,
    end: (code) => endProcess({ execution: { task: tasks[0] }, exitCode: code }),
  };
}
test('only primary TurbSim text inputs are runnable', () => {
  assert.equal(isTurbSimInput('wind.INP', primary), true);
  assert.equal(isTurbSimInput('wind.dat', primary.replace('AnalysisTime-', 'AnalysisTime')), true);
  for (const filename of ['wind.bts', 'wind.sum', 'wind.echo', 'wind.fst'])
    assert.equal(isTurbSimInput(filename, primary), false);
  for (const text of [
    'TurbSim user-defined spectra Input File\n2 NumUSRf\n1 SpecScale1',
    'ROSCO controller input\n0 ! LoggingLevel',
    primary.replace('5 NumGrid_Y', ''),
    primary + '\0',
    'x'.repeat(2_000_001),
  ])
    assert.equal(isTurbSimInput('wind.inp', text), false);
});
test('TurbSim uses separate executable storage and preserves the OpenFAST path', async () => {
  const h = harness();
  const original = readExecutable(h.vscode, h.context, h.uri);
  await saveExecutable(h.vscode, h.context, h.uri, 'fallback.exe', 'TurbSim');
  assert.equal(readExecutable(h.vscode, h.context, h.uri, 'TurbSim'), 'fallback.exe');
  assert.equal(readExecutable(h.vscode, h.context, h.uri), original);
  h.settings.turbSimExecutablePath = 'manual.exe';
  assert.equal(readExecutable(h.vscode, h.context, h.uri, 'TurbSim'), 'manual.exe');
});
test('launch uses one literal argument, input directory, saved edits and duplicate protection', async () => {
  const h = harness();
  let saves = 0;
  h.doc.isDirty = true;
  h.doc.save = async () => {
    saves++;
    return true;
  };
  const result = await h.commands.get('openfast.runTurbSim')();
  assert.equal(result.started, true);
  assert.equal(saves, 1);
  const task = h.tasks[0];
  assert.equal(task.source, 'TurbSim');
  assert.equal(task.execution.executable, h.settings.turbSimExecutablePath);
  assert.deepEqual(task.execution.args, [h.uri.fsPath]);
  assert.equal(task.execution.options.cwd, path.dirname(h.uri.fsPath));
  await h.commands.get('openfast.runTurbSim')();
  assert.equal(h.tasks.length, 1);
  h.end(3);
  assert.match(h.messages.at(-1), /TurbSim.*3/);
});
test('trust, workspace, input, executable and save failures block launch', async () => {
  const changes = [
    (h) => {
      h.vscode.workspace.isTrusted = false;
    },
    (h) => {
      h.vscode.workspace.workspaceFolders = [];
    },
    (h) => {
      h.uri.scheme = 'untitled';
    },
    (h) => {
      h.doc.getText = () => 'TurbSim user-defined spectra input file';
    },
    (h) => {
      h.settings.turbSimExecutablePath = 'relative.exe';
    },
    (h) => {
      h.vscode.workspace.fs.stat = async () => {
        throw Error('missing');
      };
    },
    (h) => {
      h.vscode.workspace.fs.stat = async () => ({ type: 2 });
    },
    (h) => {
      h.doc.isDirty = true;
      h.doc.save = async () => false;
    },
    (h) => {
      h.doc.isDirty = true;
      h.doc.save = async () => {
        h.doc.getText = () => '';
        return true;
      };
    },
  ];
  for (const change of changes) {
    const h = harness();
    change(h);
    assert.equal(await h.commands.get('openfast.runTurbSim')(), undefined);
    assert.equal(h.tasks.length, 0);
    assert.ok(h.messages.length > 0);
  }
});
test('first-run picker saves path; cancelling the picker leaves input unsaved', async () => {
  const h = harness();
  h.settings.turbSimExecutablePath = '';
  assert.equal((await h.commands.get('openfast.runTurbSim')()).started, true);
  assert.equal(
    readExecutable(h.vscode, h.context, h.uri, 'TurbSim'),
    path.resolve('selected TurbSim.exe'),
  );
  const cancelled = harness();
  cancelled.settings.turbSimExecutablePath = '';
  cancelled.doc.isDirty = true;
  cancelled.doc.save = async () => assert.fail('must not save');
  cancelled.vscode.window.showOpenDialog = async () => undefined;
  assert.equal(await cancelled.commands.get('openfast.runTurbSim')(), undefined);
  assert.equal(cancelled.tasks.length, 0);
});
