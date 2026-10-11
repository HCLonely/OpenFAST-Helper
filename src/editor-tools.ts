import { t, localizeText } from './i18n';
import { fieldFeedback, spellingRepairs, nextIncompleteField } from './editor-fields';
import { repairMissingPath } from './editor-path-repair';
import {
  performanceSummary,
  timed,
  setEmptyCompletionHandler,
  armManualCompletion,
} from './editor-performance';
import { completionExplanation } from './editor-completion-feedback';
import { resolveVersion } from './versions';
import { snapshotMetrics } from './editor-snapshot';
import { replacementPaused } from './editor-input-state';
import { lex } from './parser';
import { errorMessage } from './errors';

export const displayPresets = {
  reading: {
    hintDensity: 'compact',
    enableTableHints: false,
    showCurrentValueHint: false,
    highlightArrayMatrix: false,
    highlightSymbolRoles: false,
    highlightNumericParts: false,
    highlightTableFieldGroups: false,
    highlightActiveTableColumn: false,
  },
  table: {
    hintDensity: 'standard',
    enableTableHints: true,
    showCurrentValueHint: false,
    highlightArrayMatrix: true,
    highlightSymbolRoles: false,
    highlightNumericParts: false,
    highlightTableFieldGroups: true,
    highlightActiveTableColumn: true,
  },
  structure: {
    hintDensity: 'detailed',
    enableTableHints: true,
    showCurrentValueHint: true,
    highlightArrayMatrix: true,
    highlightSymbolRoles: true,
    highlightNumericParts: true,
    highlightTableFieldGroups: true,
    highlightActiveTableColumn: true,
  },
};

/** Preserve the original override, including its absence, across preset switches/reloads. */
export async function applyDisplayPreset(
  config,
  store,
  storageKey: string,
  preset: string,
  target,
  property: string,
) {
  const saved = store.get(storageKey);
  if (preset === 'restore' && !saved) return false;
  const values = preset === 'restore' ? saved : displayPresets[preset];
  if (!values) return false;
  const before = Object.fromEntries(
    Object.keys(values).map((key) => {
      const value = config.inspect(key)?.[property];
      return [key, { present: value !== undefined, value }];
    }),
  );
  if (!saved && preset !== 'restore') await store.update(storageKey, before);
  const changed = [];
  try {
    for (const [key, value] of Object.entries(values)) {
      await config.update(
        key,
        preset === 'restore' ? ((value as any).present ? (value as any).value : undefined) : value,
        target,
      );
      changed.push(key);
    }
    if (preset === 'restore') await store.update(storageKey, undefined);
    return true;
  } catch (error) {
    for (const key of changed.reverse())
      await config.update(key, before[key].present ? before[key].value : undefined, target);
    if (!saved && preset !== 'restore') await store.update(storageKey, undefined);
    throw error;
  }
}

export function performanceReport(document?) {
  const cache = snapshotMetrics();
  const size = document?.getText().length || 0;
  const lines = [
    t('editor.performanceTitle'),
    '',
    t('editor.performanceScope'),
    '',
    t(
      'editor.performanceDocument',
      size,
      document?.version ?? '-',
      size > 2000000 ? t('editor.performancePartial') : t('editor.performanceFull'),
    ),
    t(
      'editor.performanceCache',
      cache.builds,
      cache.textHits,
      cache.documentHits,
      cache.entries,
      cache.retained,
    ),
    t(
      'editor.performanceDetails',
      cache.detailBuilds,
      cache.estimatedBytes,
      cache.maxEstimatedBytes,
    ),
    '',
    '| Provider | Calls | Mean ms | Recent p95 ms | Max ms | Failures |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const metric of performanceSummary())
    lines.push(
      `| ${metric.name} | ${metric.count} | ${metric.meanMs.toFixed(3)} | ${metric.p95Ms.toFixed(3)} | ${metric.maxMs.toFixed(3)} | ${metric.failures} |`,
    );
  lines.push('', t('editor.performanceLimits'));
  return lines.join('\n');
}

export function registerEditorTools(
  vscode,
  context,
  caseContext = (_document) => ({ references: [] }),
) {
  const register = (value) => context.subscriptions.push(value);
  const command = (name, callback) =>
    register(
      vscode.commands.registerCommand(name, async (...args) => {
        try {
          return await callback(...args);
        } catch (error) {
          void vscode.window.showErrorMessage(t('editor.failed', errorMessage(error)));
          return false;
        }
      }),
    );
  const active = () =>
    vscode.window.activeTextEditor?.document.languageId === 'openfast'
      ? vscode.window.activeTextEditor
      : undefined;
  async function explain(document, position, automatic = false) {
    if (
      document.languageId !== 'openfast' ||
      replacementPaused(document, Date.now(), position.line)
    )
      return;
    const config = vscode.workspace.getConfiguration('openfast', document.uri);
    const reason = completionExplanation(
      document.getText(),
      position.line,
      position.character,
      resolveVersion(document.getText(), config.get('version', 'auto')),
      Object.fromEntries(
        ['enableTableSuggestions', 'enablePathSuggestions', 'enableValueSuggestions'].map((key) => [
          key,
          config.get(key, true),
        ]),
      ),
    );
    if (automatic && ['available', 'context'].includes(reason.code)) return;
    const revision = document.version;
    const action = reason.command ? t('editor.suggestAction') : undefined;
    const prompt = vscode.window.showInformationMessage(reason.detail, ...(action ? [action] : []));
    if (!action) {
      void prompt;
      return reason.code;
    }
    const selected = await prompt;
    if (
      action &&
      selected === action &&
      !document.isClosed &&
      document.version === revision &&
      vscode.window.activeTextEditor?.document === document &&
      vscode.window.activeTextEditor.selection.active.line === position.line &&
      vscode.window.activeTextEditor.selection.active.character === position.character &&
      !replacementPaused(document, Date.now(), position.line)
    )
      return vscode.commands.executeCommand(reason.command, ...reason.args);
    return reason.code;
  }
  register(
    setEmptyCompletionHandler((document, position) =>
      explain(document, position, true).catch(() => {}),
    ),
  );
  command('openfast.explainSuggestions', () => {
    const editor = active();
    if (!editor) return false;
    return explain(editor.document, editor.selection.active);
  });
  command('openfast.suggestWithExplanation', async () => {
    const editor = active();
    if (!editor || replacementPaused(editor.document)) return false;
    armManualCompletion(editor.document, editor.selection.active);
    await vscode.commands.executeCommand('editor.action.triggerSuggest');
    return true;
  });
  command('openfast.applyDisplayPreset', async (preset?) => {
    const document = active()?.document;
    const folder = document && vscode.workspace.getWorkspaceFolder(document.uri);
    const target = folder
      ? vscode.ConfigurationTarget.WorkspaceFolder
      : vscode.workspace.workspaceFolders?.length || vscode.workspace.workspaceFile
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    const property = folder
      ? 'workspaceFolderValue'
      : target === vscode.ConfigurationTarget.Workspace
        ? 'workspaceValue'
        : 'globalValue';
    const store =
      target === vscode.ConfigurationTarget.Global ? context.globalState : context.workspaceState;
    const key = 'openfast.displayPreset.' + (folder?.uri.toString() || property);
    if (!preset) {
      const items = Object.keys(displayPresets).map((id) => ({
        label: t(('editor.preset.' + id) as any),
        id,
        description: folder?.name || t('editor.presetScope'),
      }));
      if (store.get(key))
        items.push({
          label: t('editor.preset.restore'),
          id: 'restore',
          description: folder?.name || t('editor.presetScope'),
        });
      preset = (await vscode.window.showQuickPick(items, { title: t('editor.presetTitle') }))?.id;
    }
    if (!preset) return false;
    return applyDisplayPreset(
      vscode.workspace.getConfiguration('openfast', document?.uri),
      store,
      key,
      preset,
      target,
      property,
    );
  });
  command('openfast.nextIncompleteField', async () => {
    const editor = active();
    if (!editor) return false;
    if (replacementPaused(editor.document)) return false;
    if (editor.document.getText().length > 2000000) {
      void vscode.window.showInformationMessage(t('editor.nextFieldLarge'));
      return false;
    }
    const next = nextIncompleteField(
      editor.document.getText(),
      editor.selection.active.line,
      editor.selection.active.character,
    );
    if (!next) {
      void vscode.window.showInformationMessage(t('editor.noIncompleteField'));
      return false;
    }
    editor.selection = new vscode.Selection(next.line, next.start, next.line, next.end);
    editor.revealRange(new vscode.Range(next.line, next.start, next.line, next.end));
    await vscode.commands.executeCommand('editor.action.triggerSuggest');
    return true;
  });
  command('openfast.repairMissingPath', async (uri?, line?) => {
    const editor = active();
    const document = uri
      ? vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString())
      : editor?.document;
    if (!document) return false;
    const targetLine = line ?? editor?.selection.active.line ?? 0;
    const character = lex(document.lineAt(targetLine).text).items[0]?.start || 0;
    return timed('path.alternatives', () =>
      repairMissingPath(vscode, document, { line: targetLine, character }, caseContext(document)),
    );
  });
  let report = '';
  const scheme = 'openfast-editor-performance';
  const event = new vscode.EventEmitter();
  register(event);
  register(
    vscode.workspace.registerTextDocumentContentProvider(scheme, {
      onDidChange: event.event,
      provideTextDocumentContent: () => report,
    }),
  );
  command('openfast.showEditorPerformance', async () => {
    report = performanceReport(active()?.document);
    const uri = vscode.Uri.parse(scheme + ':/performance.md');
    event.fire(uri);
    const document = await vscode.workspace.openTextDocument(uri);
    return vscode.window.showTextDocument(document, { preview: true });
  });
  register(
    vscode.languages.registerHoverProvider(
      { language: 'openfast' },
      {
        provideHover(document, position, token) {
          if (
            token?.isCancellationRequested ||
            document.getText().length > 2000000 ||
            !vscode.workspace.getConfiguration('openfast', document.uri).get('enableHover', true)
          )
            return;
          const feedback = fieldFeedback(document.getText(), position.line, position.character);
          if (!feedback) return;
          const md = new vscode.MarkdownString();
          md.isTrusted = false;
          md.appendText(
            t(
              'editor.fieldExpectation',
              feedback.field,
              feedback.value,
              t(('editor.type.' + feedback.type) as any),
              feedback.unit || t('table.seeHeader'),
            ),
          );
          if (feedback.choices.length)
            md.appendText(
              '\n' +
                t(
                  'editor.fieldOptions',
                  feedback.choices.map((c) => c.value + ' — ' + localizeText(c.label)).join(' / '),
                ),
            );
          for (const issue of feedback.issues) md.appendText('\n' + issue.message);
          if (feedback.referenceKnown)
            md.appendText('\n' + t('editor.referenceCount', feedback.referenceCount));
          for (const definition of feedback.definitions.slice(0, 8)) {
            const uri = document.uri.with({ fragment: 'L' + (definition.line + 1) });
            md.appendMarkdown(
              `\n[${t('editor.fieldDefinition', definition.line + 1)}](${uri.toString().replace(/\(/g, '%28').replace(/\)/g, '%29')})`,
            );
          }
          return new vscode.Hover(
            md,
            new vscode.Range(position.line, feedback.cell.start, position.line, feedback.cell.end),
          );
        },
      },
    ),
  );
  register(
    vscode.languages.registerCodeActionsProvider(
      { language: 'openfast' },
      {
        provideCodeActions(document, selection, actionContext, token) {
          if (
            token?.isCancellationRequested ||
            document.getText().length > 2000000 ||
            replacementPaused(document, Date.now(), selection.start.line)
          )
            return [];
          const config = vscode.workspace.getConfiguration('openfast', document.uri);
          if (!config.get('enableDiagnostics', true)) return [];
          const actions = [];
          const repairs = spellingRepairs(
            document.getText(),
            selection.start.line,
            selection.start.character,
          );
          for (const repair of repairs) {
            const action = new vscode.CodeAction(
              t('editor.fixSpelling', repair.replacement),
              vscode.CodeActionKind.QuickFix,
            );
            action.edit = new vscode.WorkspaceEdit();
            action.edit.replace(
              document.uri,
              new vscode.Range(repair.line, repair.start, repair.line, repair.end),
              repair.replacement,
            );
            actions.push(action);
          }
          if (
            actionContext?.diagnostics?.some(
              (d) => (typeof d.code === 'object' ? d.code.value : d.code) === 'missing-file',
            )
          ) {
            const action = new vscode.CodeAction(
              t('editor.repairPathTitle'),
              vscode.CodeActionKind.QuickFix,
            );
            action.command = {
              command: 'openfast.repairMissingPath',
              title: action.title,
              arguments: [document.uri, selection.start.line],
            };
            actions.push(action);
          }
          return actions;
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );
}
