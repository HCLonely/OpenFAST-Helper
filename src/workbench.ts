import { registerTimedCompletion } from './editor-performance';
import { outputBlockAt } from './output-blocks';
import {
  naturalSortKey,
  candidateLabel,
  outputCategory,
  prioritizeDiagnostics,
  selectedCaseGraph,
} from './editor-presentation';
import nodalOutputs from '../data/nodal-outputs.json';
import { supplements, customValueIssues } from './workspace-dictionary';
import { expandedFields } from './table-layout';
import { tableFeedback } from './editor-table-feedback';
import { arrayFeedback } from './editor-arrays';
import { tableColumn } from './editor-context';
import { replacementPaused } from './editor-input-state';
import { t, descriptionFor } from './i18n';
import { lex } from './parser';
import {
  documentSnapshot,
  parseForEditor as parseDocument,
  tablesForEditor as readTables,
} from './editor-snapshot';
import { numberedOutputs, completionRanges, compatibleSelections } from './editor-rules';
import {
  tokenFeedback,
  normalizedOutput,
  localStyle,
  deferDocumentation,
  resolveDocumentation,
} from './editor-intelligence';
import { findEntry } from './catalog';
import { resolveVersion, SUPPORTED } from './versions';
import { analyze, inactiveEntries, outputChoices } from './analysis';

import { buildGraph, crossIssues, fileReferences } from './references';
import { CaseGraphCache, CaseSelection } from './case-graph-cache';
import { resourceKey } from './resource-key';
import { documentSize } from './file-formats';
import { canReadReference } from './reference-access';
import { compareGraphs, comparisonMarkdown } from './comparison';
const inheritedProfiles = new Map();
function profileFor(vscode, document) {
  const own = resolveVersion(
    document.getText(),
    vscode.workspace.getConfiguration('openfast', document.uri).get('version', 'auto'),
  );
  return own.known ? own : inheritedProfiles.get(document.uri.toString()) || own;
}
function outputContext(text, line, character) {
  const lines = text.split(/\r?\n/);
  const output = outputBlockAt(text, line);
  const source = lines[line] || '';
  if (
    !output ||
    /^\s*(BldNd_OutList|OutList|END)\b/i.test(source) ||
    character > lex(source).commentStart ||
    /\s[-–]\s/.test(source.slice(0, character))
  ) {
    return null;
  }
  let start = character;
  let end = character;
  while (start > 0 && /[A-Za-z0-9_]/.test(source[start - 1])) {
    start--;
  }
  while (end < source.length && /[A-Za-z0-9_]/.test(source[end])) {
    end++;
  }
  return {
    start,
    end,
    quoted:
      source.slice(0, start).split('"').length % 2 === 0 ||
      source.slice(0, start).split("'").length % 2 === 0,
  };
}
function registerWorkbench(vscode, context) {
  const subscriptions = context.subscriptions;
  const register = (x) => subscriptions.push(x);
  const diagnostics = vscode.languages.createDiagnosticCollection('openfast');
  register(diagnostics);
  const inactiveStyles = new Map();
  register({
    dispose() {
      for (const style of inactiveStyles.values()) style.dispose();
    },
  });
  const treeEvents = new vscode.EventEmitter();
  const hintEvents = new vscode.EventEmitter();
  register(treeEvents);
  register(hintEvents);
  const localIssues = new Map();
  const graphIssues = new Map();
  const graphs = new CaseGraphCache<any>(12, resourceKey);
  const selection = new CaseSelection();
  const documentChecks = new Map<string, object>();
  const selectedLines = new WeakMap<object, string>();
  const reports = new Map();
  let epoch = 0;
  let activeRoot;
  function selectRoot(root) {
    const key = root.toString();
    if (selection.key !== key) inheritedProfiles.clear();
    activeRoot = root;
    return selection.select(key);
  }
  let lastReport;
  let reportIndex = 0;
  let graphTimer;
  const timers = new Map();
  const config = <T = boolean>(name: string, uri, fallback: T = true as T): T =>
    vscode.workspace.getConfiguration('openfast', uri).get(name, fallback);
  const io = {
    read: async (value) => {
      const uri = vscode.Uri.parse(value);
      if (!canReadReference(vscode.workspace, uri)) throw Error(t('runner.trustRequired'));
      const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === value);
      if (open) {
        if (open.getText().length > 2000000) {
          throw Error(t('references.fileTooLarge'));
        }
        return open.getText();
      }
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > 2000000) {
        throw Error(t('references.fileTooLarge'));
      }
      return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    },
    exists: async (value) => {
      const uri = vscode.Uri.parse(value);
      if (!canReadReference(vscode.workspace, uri)) return false;
      try {
        await vscode.workspace.fs.stat(uri);
        return true;
      } catch {
        return vscode.workspace.textDocuments.some((d) => d.uri.toString() === value);
      }
    },
    resolve: (value, filename) => {
      if (/^[A-Za-z]:[\\/]|^\\\\|^\//.test(filename)) {
        return vscode.Uri.file(filename).toString();
      }
      return vscode.Uri.joinPath(
        vscode.Uri.parse(value),
        '..',
        filename.replace(/\\/g, '/'),
      ).toString();
    },
  };
  const valid = (document) =>
    document.languageId === 'openfast' && documentSize(document) <= 2000000;
  function toDiagnostic(issue, uri) {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri);
    const line = Math.max(
      0,
      Math.min(issue.line || 0, (open?.lineCount || Number.MAX_SAFE_INTEGER) - 1),
    );
    const length = open?.lineAt(line).text.length;
    const start = Math.max(0, Math.min(issue.start || 0, length ?? Number.MAX_SAFE_INTEGER));
    const end = Math.max(
      start,
      Math.min(issue.end || start + 1, length ?? Number.MAX_SAFE_INTEGER),
    );
    const d = new vscode.Diagnostic(
      new vscode.Range(line, start, line, end),
      issue.message,
      {
        error: vscode.DiagnosticSeverity.Error,
        warning: vscode.DiagnosticSeverity.Warning,
        information: vscode.DiagnosticSeverity.Information,
      }[issue.severity] ?? vscode.DiagnosticSeverity.Warning,
    );
    d.source = 'OpenFAST';
    d.code = issue.url ? { value: issue.code, target: vscode.Uri.parse(issue.url) } : issue.code;
    return d;
  }
  function flush(uri, runChecks = false) {
    if (!runChecks && !config('enableDiagnostics', vscode.Uri.parse(uri))) {
      diagnostics.delete(vscode.Uri.parse(uri));
      return;
    }
    const list = [...(localIssues.get(uri) || []), ...(graphIssues.get(uri) || [])];
    diagnostics.set(
      vscode.Uri.parse(uri),
      prioritizeDiagnostics(list).map((i) => toDiagnostic(i, uri)),
    );
  }
  function decorate(editor) {
    if (!editor) {
      return;
    }
    const document = editor.document;
    const opacity = Math.max(
      0.1,
      Math.min(1, Number(config('inactiveParameterOpacity', document.uri, 0.48)) || 0.48),
    );
    if (!inactiveStyles.has(opacity)) {
      inactiveStyles.set(
        opacity,
        vscode.window.createTextEditorDecorationType({ opacity: String(opacity) }),
      );
    }
    for (const [key, style] of inactiveStyles)
      if (key !== opacity) editor.setDecorations(style, []);
    const inactive = inactiveStyles.get(opacity);
    const ranges =
      valid(document) && config('dimInactiveParameters', document.uri)
        ? inactiveEntries(parseDocument(document.getText())).map((entry) => ({
            range: document.lineAt(entry.line).range,
            hoverMessage: t('diagnostic.inactiveParameter'),
          }))
        : [];
    editor.setDecorations(inactive, ranges);
  }
  async function checkDocument(document, request: object) {
    if (!valid(document) || document.uri.scheme === 'openfast-highlight-preview') {
      return;
    }
    const version = document.version;
    const revision = epoch;
    const text = document.getText();
    const lines = text.split(/\r?\n/);
    const profile = profileFor(vscode, document);
    const parsed = documentSnapshot(document).parsed;
    const extra = supplements(vscode, document, parsed.module, profile);
    const extraNames = new Set(
      extra.filter((e) => e.kind === 'parameter').map((e) => e.name.toLowerCase()),
    );
    const key = document.uri.toString();
    const activeLines = new Set<number>(
      vscode.window.visibleTextEditors
        .filter((e) => e.document === document)
        .flatMap((e) => (e.selections || [e.selection]).map((s) => s.active.line)),
    );
    const issues = analyze(text, profile).filter(
      (issue) =>
        ![
          'table-field-type',
          'table-field-enum',
          'table-extra-cell',
          'table-list-repeat',
          'table-columns',
        ].includes(issue.code) &&
        !(
          activeLines.has(issue.line) &&
          ['table-type', 'table-columns', 'table-reference'].includes(issue.code)
        ) &&
        !(
          issue.code === 'numeric' &&
          activeLines.has(issue.line) &&
          /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)[eEdD][-+]?$/.test(
            lex(lines[issue.line] || '').items[0]?.text || '',
          )
        ),
    );
    if (config('enableTableFieldDiagnostics', document.uri, true))
      issues.push(
        ...(tableFeedback(text, activeLines) as any),
        ...(arrayFeedback(text, profile, activeLines) as any),
      );
    issues.push(...(customValueIssues(text, extra, activeLines) as any));
    issues.push(
      ...(tokenFeedback(text).filter(
        (i) =>
          !(i.code === 'unknown-parameter' && extraNames.has(i.name.toLowerCase())) &&
          !issues.some((old) => old.line === i.line && old.start === i.start && old.end === i.end),
      ) as any),
    );
    if (document.uri.scheme !== 'untitled') {
      for (const reference of fileReferences(parsed, text)) {
        if (
          document.isClosed ||
          document.version !== version ||
          documentChecks.get(key) !== request
        )
          return;
        if (reference.active && !(await io.exists(io.resolve(key, reference.path)))) {
          issues.push({
            ...reference,
            severity: 'error',
            code: 'missing-file',
            message: t('diagnostic.missingReference', reference.parameter, reference.path),
          });
        }
      }
    }
    if (
      document.isClosed ||
      version !== document.version ||
      revision !== epoch ||
      documentChecks.get(key) !== request
    ) {
      return;
    }
    localIssues.set(key, issues);
    flush(key);
    vscode.window.visibleTextEditors.filter((e) => e.document === document).forEach(decorate);
  }
  function schedule(document) {
    const key = document.uri.toString();
    const request = {};
    documentChecks.set(key, request);
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        if (replacementPaused(document)) {
          schedule(document);
          return;
        }
        void checkDocument(document, request).catch((e) =>
          console.warn('OpenFAST document checks:', e.message),
        );
      }, 300),
    );
  }
  async function graphFor(root, force = false) {
    const key = root.toString();
    return graphs.get(key, force, async (track, signal) => {
      const trackedIO = {
        ...io,
        resolve: (from, filename) => {
          const uri = io.resolve(from, filename);
          track(uri);
          return uri;
        },
        read: (uri) => {
          track(uri);
          return io.read(uri);
        },
        exists: (uri) => {
          track(uri);
          return io.exists(uri);
        },
      };
      const graph = await buildGraph(
        key,
        trackedIO,
        config('maxReferencedFiles', root, 300),
        signal,
      );
      if (!graph || signal.aborted) return undefined;
      const rootNode = graph.nodes.get(key);
      const profile = resolveVersion(rootNode?.text || '', config('version', root, 'auto'));
      for (const node of graph.nodes.values()) {
        const uri = vscode.Uri.parse(node.uri);
        const own = resolveVersion(node.text, config('version', uri, 'auto'));
        node.profile = own.known ? own : profile;
        if (node.profile.known && selection.key === key) {
          inheritedProfiles.set(node.uri, node.profile);
        }
      }
      return graph;
    });
  }
  async function checkRoot(root, force = false, runChecks = false) {
    const current = selectRoot(root);
    const graph = await graphFor(root, force);
    if (!graph) {
      return undefined;
    }
    const cross = runChecks || config('enableCrossFileChecks', root) ? crossIssues(graph) : [];
    const nodeIssues = new Map<string, ReturnType<typeof analyze>>();
    for (const node of graph.nodes.values())
      nodeIssues.set(node.uri, analyze(node.text, node.profile, node.parsed, node.tables));
    const result = {
      graph,
      issues: [
        ...graph.issues,
        ...cross,
        ...[...nodeIssues].flatMap(([uri, issues]) => issues.map((i) => ({ ...i, uri }))),
      ],
    };
    if (!current()) return result;
    for (const node of graph.nodes.values()) {
      if (node.profile.known) inheritedProfiles.set(node.uri, node.profile);
    }
    const previousKeys = [...graphIssues.keys()];
    graphIssues.clear();
    for (const issue of [...graph.issues, ...cross]) {
      if (!graphIssues.has(issue.uri)) {
        graphIssues.set(issue.uri, []);
      }
      graphIssues.get(issue.uri).push(issue);
    }
    for (const node of graph.nodes.values()) {
      localIssues.set(node.uri, nodeIssues.get(node.uri));
    }
    for (const key of new Set([...previousKeys, ...localIssues.keys(), ...graphIssues.keys()])) {
      flush(key, runChecks && (graph.nodes.has(key) || graphIssues.has(key)));
    }
    vscode.window.visibleTextEditors.forEach(decorate);
    return result;
  }
  function invalidate(uri?) {
    const key = uri?.toString();
    const affected = graphs.invalidate(key);
    if (!key) {
      epoch++;
      inheritedProfiles.clear();
    } else {
      if (activeRoot && affected.has(activeRoot.toString())) inheritedProfiles.clear();
      else inheritedProfiles.delete(key);
    }
    treeEvents.fire();
    hintEvents.fire();
    if (
      activeRoot &&
      (!key || affected.has(activeRoot.toString()) || activeRoot.toString() === key)
    ) {
      selection.select(activeRoot.toString());
      clearTimeout(graphTimer);
      graphTimer = setTimeout(
        () =>
          void checkRoot(activeRoot, true).catch((e) =>
            console.warn('OpenFAST case checks:', e.message),
          ),
        700,
      );
    }
  }
  const rootPattern = /\.(fst|fstf)$/i;
  async function chooseRoot(resource) {
    const target = resource?.uri || resource;
    const uri = typeof target === 'string' ? vscode.Uri.parse(target) : target;
    if (uri && rootPattern.test(uri.path)) {
      return uri;
    }
    if (
      vscode.window.activeTextEditor &&
      rootPattern.test(vscode.window.activeTextEditor.document.uri.path)
    ) {
      return vscode.window.activeTextEditor.document.uri;
    }
    if (activeRoot) {
      return activeRoot;
    }
    return (
      await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { [t('filePicker.mainInputFilter')]: ['fst', 'fstf'] },
        title: t('case.selectMainInput'),
      })
    )?.[0];
  }
  const treeProvider = {
    onDidChangeTreeData: treeEvents.event,
    getTreeItem(element) {
      const edge = element.edge;
      const uri = element.uri;
      const cycle = edge && element.ancestors.has(uri.toString());
      const expandable = !edge || (edge.exists && edge.active && edge.isConfig && !cycle);
      const item = new vscode.TreeItem(
        edge ? edge.parameter + ' → ' + edge.path : uri.path.split('/').pop(),
        expandable
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      );
      item.resourceUri = uri;
      item.description = edge
        ? cycle
          ? t('tree.circularReference')
          : !edge.active
            ? t('tree.inactive')
            : !edge.exists
              ? t('tree.missingFile')
              : !edge.isConfig
                ? t('tree.dataFile')
                : ''
        : uri.path.split('/').slice(-2, -1)[0];
      item.tooltip = uri.fsPath || uri.toString();
      item.contextValue = edge ? 'openfastReference' : 'openfastRoot';
      if (!edge || edge.exists) {
        item.command = {
          command: 'vscode.open',
          title: t('tree.openConfiguration'),
          arguments: [uri],
        };
      }
      if (edge && !edge.exists && edge.active) {
        item.iconPath = new vscode.ThemeIcon('warning');
      }
      return item;
    },
    async getChildren(element) {
      if (!element) {
        const roots = await vscode.workspace.findFiles(
          '**/*.{fst,fstf}',
          '**/{node_modules,.git,test-results}/**',
          500,
        );
        return roots
          .sort((a, b) => a.path.localeCompare(b.path))
          .map((uri) => ({ uri, root: uri, ancestors: new Set() }));
      }
      const graph = await graphFor(element.root);
      if (!graph) {
        return [];
      }
      const key = element.uri.toString();
      if (element.ancestors.has(key)) {
        return [];
      }
      const ancestors = new Set(element.ancestors);
      ancestors.add(key);
      return graph.edges
        .filter((e) => e.from === key)
        .map((edge) => ({ edge, uri: vscode.Uri.parse(edge.to), root: element.root, ancestors }));
    },
  };
  register(
    vscode.window.createTreeView('openfast.configurationTree', {
      treeDataProvider: treeProvider,
      showCollapseAll: true,
    }),
  );
  register(
    vscode.commands.registerCommand('openfast.refreshTree', () => {
      invalidate();
      return true;
    }),
  );
  register(
    vscode.commands.registerCommand('openfast.checkCase', async (resource) => {
      const root = await chooseRoot(resource);
      if (!root) {
        return undefined;
      }
      const checked = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: t('progress.checkCase'),
        },
        () => checkRoot(root, true),
      );
      if (!checked) {
        return undefined;
      }
      const errors = checked.issues.filter((i) => i.severity === 'error').length;
      void vscode.window.showInformationMessage(
        t(
          'validation.caseSummary',
          checked.graph.nodes.size,
          errors,
          checked.issues.length - errors,
        ),
      );
      return { files: checked.graph.nodes.size, issues: checked.issues };
    }),
  );
  register(
    vscode.workspace.registerTextDocumentContentProvider('openfast-report', {
      provideTextDocumentContent: (uri) => reports.get(uri.toString()) || '',
    }),
  );
  register(
    vscode.commands.registerCommand('openfast.compareCases', async (left, right) => {
      const asUri = (x) => (typeof x === 'string' ? vscode.Uri.parse(x) : x);
      if (!left || !right) {
        const picks = await vscode.window.showOpenDialog({
          canSelectMany: true,
          filters: { [t('filePicker.mainInputFilter')]: ['fst', 'fstf'] },
          title: t('comparison.selectInputs'),
        });
        if (!picks) {
          return undefined;
        }
        if (picks.length !== 2) {
          void vscode.window.showInformationMessage(t('comparison.selectExactlyTwo'));
          return undefined;
        }
        [left, right] = picks;
      }
      left = asUri(left);
      right = asUri(right);
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: t('progress.compareCases') },
        async () => {
          const [a, b] = await Promise.all([graphFor(left, true), graphFor(right, true)]);
          if (!a || !b) {
            return undefined;
          }
          const rows = compareGraphs(a, b);
          const text = comparisonMarkdown(
            rows,
            left.fsPath || left.toString(),
            right.fsPath || right.toString(),
          );
          const limitations = [...a.issues, ...b.issues].filter((i) =>
            /read-file|missing-file|graph-limit/.test(i.code),
          );
          const full =
            text +
            (limitations.length
              ? t('report.incompleteReferences') +
                limitations.map((i) => '- ' + i.message).join('\n') +
                '\n'
              : '');
          const uri = vscode.Uri.parse(t('report.comparisonUri', ++reportIndex));
          reports.set(uri.toString(), full);
          lastReport = uri;
          const document = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(document, { preview: true });
          return { rows, uri: uri.toString(), unread: limitations.length };
        },
      );
      return result;
    }),
  );
  register(
    vscode.commands.registerCommand('openfast.exportComparison', async (destination) => {
      const current = vscode.window.activeTextEditor?.document.uri;
      const source = current && reports.has(current.toString()) ? current : lastReport;
      if (!source) {
        void vscode.window.showInformationMessage(t('report.generateFirst'));
        return false;
      }
      const uri = destination
        ? typeof destination === 'string'
          ? vscode.Uri.parse(destination)
          : destination
        : await vscode.window.showSaveDialog({
            filters: { Markdown: ['md'] },
            saveLabel: t('report.exportTitle'),
          });
      if (!uri) {
        return false;
      }
      await vscode.workspace.fs.writeFile(uri, Buffer.from(reports.get(source.toString()), 'utf8'));
      return true;
    }),
  );
  register(
    vscode.commands.registerCommand('openfast.selectVersion', async () => {
      const doc = vscode.window.activeTextEditor?.document;
      const current = config('version', doc?.uri, 'auto');
      const picked = await vscode.window.showQuickPick(
        SUPPORTED.map((value) => ({
          label:
            value === 'auto'
              ? t('version.auto')
              : value === 'main'
                ? t('version.main')
                : `OpenFAST ${value}.x`,
          description: value === current ? t('common.current') : '',
          value,
        })),
        {
          title: t('version.selectTitle'),
          placeHolder: t('version.selectPlaceholder'),
        },
      );
      if (!picked) {
        return false;
      }
      const target = vscode.workspace.workspaceFolders?.length
        ? vscode.workspace.workspaceFolders.length > 1 && doc
          ? vscode.ConfigurationTarget.WorkspaceFolder
          : vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
      await vscode.workspace
        .getConfiguration('openfast', doc?.uri)
        .update('version', picked.value, target);
      return true;
    }),
  );
  register(
    vscode.commands.registerCommand('openfast.outputSuggestionSettings', () =>
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@id:openfast.enableOutputSuggestions',
      ),
    ),
  );
  register(
    vscode.commands.registerCommand('openfast.openSettings', () =>
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:hclonely.openfast-helper',
      ),
    ),
  );
  register(
    registerTimedCompletion(
      vscode,
      { language: 'openfast' },
      {
        provideCompletionItems(document, position) {
          if (!config('enableOutputSuggestions', document.uri)) {
            return [];
          }
          const text = documentSnapshot(document).text;
          const where = outputContext(text, position.line, position.character);
          if (!where) {
            return [];
          }
          const parsed = parseDocument(text);
          const block = outputBlockAt(text, position.line);
          const extra = supplements(vscode, document, parsed.module, profileFor(vscode, document));
          const items =
            block.kind === 'regular'
              ? [
                  ...numberedOutputs(text, editorContext(document).texts),
                  ...extra.filter((e) => e.kind === 'output'),
                ]
              : block.kind === 'bladeNodes' && parsed.module === 'ElastoDyn'
                ? nodalOutputs.channels.map((c) => ({
                    ...c,
                    description: t('editor.nodalChannel', c.name),
                  }))
                : [];
          const existing = new Set(
            parsed.tokens
              .filter(
                (t) =>
                  t.kind === 'output' &&
                  t.outputBlock === block.id &&
                  !(t.line === position.line && t.start === where.start),
              )
              .map((t) =>
                block.kind === 'regular'
                  ? normalizedOutput(t.name, parsed.module)
                  : t.name.toLowerCase(),
              ),
          );
          const quote = localStyle(text, position.line).quote;
          if (
            !compatibleSelections(vscode, document, (cursor) => {
              const c = outputContext(text, cursor.line, cursor.character);
              return (
                c && {
                  ...c,
                  signature:
                    'output:' +
                    c.quoted +
                    ':' +
                    document.lineAt(cursor.line).text.slice(c.start, c.end),
                }
              );
            })
          )
            return [];
          return items.map((entry) => {
            const added = existing.has(
              block.kind === 'regular'
                ? normalizedOutput(entry.name, parsed.module)
                : entry.name.toLowerCase(),
            );
            const item = new vscode.CompletionItem(
              {
                label: entry.name,
                description: candidateLabel(
                  '',
                  [
                    added ? t('completion.alreadyAdded') : '',
                    entry.unit,
                    t(('editor.group.' + outputCategory(entry.name)) as any),
                    entry.description,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                ).description,
              },
              vscode.CompletionItemKind.EnumMember,
            );
            item.sortText = (added ? '1' : '0') + naturalSortKey(entry.name);
            item.filterText = entry.name;
            item.range = completionRanges(
              vscode,
              position.line,
              where.start,
              where.end,
              position.character,
            );
            const source = document.lineAt(position.line).text;
            const sign =
              !where.quoted && /[-+]/.test(source[where.start - 1] || ' ')
                ? source[where.start - 1]
                : '';
            // Adding quotes must replace the whole token even in editor insert mode.
            if (!where.quoted && parsed.module !== 'MoorDyn')
              item.range = new vscode.Range(
                position.line,
                where.start - (sign ? 1 : 0),
                position.line,
                where.end,
              );
            item.insertText =
              where.quoted || parsed.module === 'MoorDyn'
                ? entry.name
                : quote + sign + entry.name + quote;
            item.detail =
              t(
                'completion.outputDetail',
                parsed.module,
                entry.unit,
                added ? t('completion.alreadyAddedSuffix') : '',
              ) +
              ('kind' in entry ? ' · ' + t('editor.workspaceSource') : '') +
              ' · ' +
              t(
                'editor.rankReason',
                t('editor.rank.moduleOutput') + (added ? ' / ' + t('editor.rank.selected') : ''),
              );
            deferDocumentation(
              item,
              () => {
                const md = new vscode.MarkdownString();
                md.appendText(entry.description);
                return md;
              },
              document,
            );
            return item;
          });
        },
        resolveCompletionItem: resolveDocumentation,
      },
      '"',
      "'",
      '-',
      ',',
      ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split(''),
    ),
  );
  register(
    vscode.languages.registerInlayHintsProvider(
      { language: 'openfast' },
      {
        onDidChangeInlayHints: hintEvents.event,
        provideInlayHints(document, range) {
          if (
            !config('enableTableHints', document.uri) ||
            config<string>('hintDensity', document.uri, 'standard') === 'compact'
          ) {
            return [];
          }
          const editor = vscode.window.activeTextEditor;
          if (editor?.document !== document) {
            return [];
          }
          const line = editor.selection.active.line;
          if (line < range.start.line || line > range.end.line) {
            return [];
          }
          const table = readTables(document.getText()).find((t) =>
            t.rows.some((r) => r.line === line),
          );
          if (!table) {
            return [];
          }
          const row = table.rows.find((r) => r.line === line);
          const fields = expandedFields(table.headers, row.cells, table.units);
          return row.cells.slice(0, fields.length).map((cell, index) => {
            const name =
              fields[index].name +
              (fields[index].element
                ? '[' + fields[index].element + '/' + fields[index].count + ']'
                : '');
            const hint = new vscode.InlayHint(
              new vscode.Position(line, cell.start),
              name +
                (config<string>('hintDensity', document.uri, 'standard') === 'detailed'
                  ? ' ' + (fields[index].unit || '')
                  : '') +
                ':',
              vscode.InlayHintKind.Parameter,
            );
            hint.paddingRight = true;
            hint.tooltip = t(
              'table.columnHint',
              index + 1,
              name,
              fields[index].unit || t('table.seeHeader'),
              descriptionFor({
                name: fields[index].name,
                module: parseDocument(document.getText()).module,
                kind: 'header',
              }),
            );
            return hint;
          });
        },
      },
    ),
  );
  register(
    vscode.languages.registerHoverProvider(
      { language: 'openfast' },
      {
        provideHover(document, position) {
          if (!config('enableHover', document.uri, true) || document.getText().length > 2000000)
            return;
          const where = tableColumn(document.getText(), position.line, position.character);
          if (!where?.cell) return;
          const { table, column: index, cell } = where;
          const md = new vscode.MarkdownString();
          md.appendText(
            t(
              'table.cellDescription',
              table.section,
              index + 1,
              where.field,
              where.unit || t('common.notProvided'),
              cell.text,
            ),
          );
          return new vscode.Hover(
            md,
            new vscode.Range(position.line, cell.start, position.line, cell.end),
          );
        },
      },
    ),
  );
  register(
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (valid(document)) {
        schedule(document);
      }
    }),
  );
  register(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === 'openfast') {
        invalidate(event.document.uri);
        if (valid(event.document)) schedule(event.document);
        else {
          const key = event.document.uri.toString();
          clearTimeout(timers.get(key));
          documentChecks.delete(key);
          localIssues.delete(key);
          graphIssues.delete(key);
          diagnostics.delete(event.document.uri);
        }
        vscode.window.visibleTextEditors
          .filter((e) => e.document === event.document)
          .forEach(decorate);
      }
    }),
  );
  register(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (valid(document)) {
        invalidate(document.uri);
        schedule(document);
      }
    }),
  );
  register(
    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = document.uri.toString();
      clearTimeout(timers.get(key));
      timers.delete(key);
      documentChecks.delete(key);
      localIssues.delete(key);
      diagnostics.delete(document.uri);
      if (valid(document)) {
        invalidate(document.uri);
      }
    }),
  );
  register(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      decorate(editor);
      hintEvents.fire();
      if (editor && valid(editor.document)) {
        schedule(editor.document);
        if (rootPattern.test(editor.document.uri.path)) {
          selectRoot(editor.document.uri);
          clearTimeout(graphTimer);
          graphTimer = setTimeout(
            () =>
              void checkRoot(activeRoot).catch((e) => console.warn('OpenFAST graph:', e.message)),
            700,
          );
        }
      }
    }),
  );
  register(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (valid(event.textEditor.document)) {
        hintEvents.fire();
        const document = event.textEditor.document;
        const lines = [
          ...new Set<number>(
            vscode.window.visibleTextEditors
              .filter((e) => e.document === document)
              .flatMap((e) => (e.selections || [e.selection]).map((s) => s.active.line)),
          ),
        ]
          .sort((a, b) => a - b)
          .join(',');
        if (selectedLines.get(document) !== lines) {
          selectedLines.set(document, lines);
          schedule(document);
        }
      }
    }),
  );
  register(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('openfast')) {
        invalidate();
        vscode.workspace.textDocuments.filter(valid).forEach(schedule);
        vscode.window.visibleTextEditors.forEach(decorate);
        hintEvents.fire();
      }
    }),
  );
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{fst,fstf,dat,in,txt}');
  register(watcher);
  register(watcher.onDidCreate(invalidate));
  register(watcher.onDidChange(invalidate));
  register(watcher.onDidDelete(invalidate));
  register({
    dispose() {
      clearTimeout(graphTimer);
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      inheritedProfiles.clear();
      graphs.invalidate();
      documentChecks.clear();
      selection.select('');
    },
  });
  vscode.workspace.textDocuments.filter(valid).forEach(schedule);
  vscode.window.visibleTextEditors.forEach(decorate);
  if (
    vscode.window.activeTextEditor &&
    rootPattern.test(vscode.window.activeTextEditor.document.uri.path)
  ) {
    selectRoot(vscode.window.activeTextEditor.document.uri);
  }
  function editorContext(document) {
    const graph = selectedCaseGraph(
      graphs.values(),
      document.uri.toString(),
      activeRoot?.toString(),
    );
    return {
      graph,
      texts: graph ? [...graph.nodes.values()].map((node) => node.text) : [],
      references: graph ? graph.edges.filter((edge) => edge.active).map((edge) => edge.to) : [],
    };
  }
  return { treeProvider, diagnostics, graphFor, checkRoot, editorContext };
}
export { registerWorkbench, profileFor, outputContext };
