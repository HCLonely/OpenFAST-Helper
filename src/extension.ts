import { supplements, customScalarContext } from './workspace-dictionary';
import { registerEditorTools } from './editor-tools';
import { registerTimedCompletion } from './editor-performance';
import nodalOutputs from '../data/nodal-outputs.json';
import { dependencyRules } from './parser';
import {
  configureLanguage,
  languageFor,
  t,
  localizeText,
  descriptionFor,
  localizeApplicability,
  moduleLabel,
} from './i18n';
import { lineComments } from './comments';
import type { ConfigToken, ParsedDocument, ParameterExplanation } from './types';
import * as vscode from 'vscode';
import { errorMessage } from './errors';
import { lex, tokenAt, explainToken } from './parser';
import { isOpenFASTTextFile } from './file-formats';
import { catalog, findDocumentation, documentation } from './catalog';
import { enableFileIcons } from './icon-integration';
import { optionsFor, valueContext } from './value-options';
import { registerWorkbench, profileFor } from './workbench';
import { resolveVersion, documentationUrl, versionOptions } from './versions';
import { registerRunner } from './runner';
import { registerSweep } from './sweep-view';
import { registerResults } from './results-view';
import { registerEditorAssistance } from './editor-assistance';
import { tokenType } from './editor-context';
import { documentSnapshot } from './editor-snapshot';
import { completionRanges, compatibleSelections } from './editor-rules';
import {
  candidateState,
  localStyle,
  styledValue,
  deferDocumentation,
  resolveDocumentation,
} from './editor-intelligence';
import { registerSemanticAssistance } from './editor-semantic';
import { replacementPaused } from './editor-input-state';
import { canReadReference } from './reference-access';
const TYPES = [
  'parameter',
  'property',
  'enumMember',
  'number',
  'string',
  'keyword',
  'openfastPath',
  'openfastDefinition',
  'openfastReference',
  'openfastUnresolved',
  'openfastNumericSign',
  'openfastNumericExponent',
];
function parsed(document: vscode.TextDocument): ParsedDocument {
  return documentSnapshot(document).parsed;
}

function range(token: Pick<ConfigToken, 'line' | 'start' | 'end'>): vscode.Range {
  return new vscode.Range(token.line, token.start, token.line, token.end);
}
function markdown(info: ParameterExplanation): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = false;
  md.supportHtml = false;
  md.appendMarkdown('**');
  md.appendText(info.name);
  md.appendMarkdown('** · ');
  md.appendText(moduleLabel(info.module));
  if (info.value !== undefined) {
    md.appendMarkdown(t('hover.currentValue'));
    md.appendText(info.value);
  }
  info = {
    ...info,
    profile:
      info.profile ||
      resolveVersion('', vscode.workspace.getConfiguration('openfast').get('version', 'auto')),
  };
  if (info.profile.known) {
    md.appendMarkdown('\n\n');
    md.appendText(t('hover.version', info.profile.version, info.profile.source));
  }
  const versioned = versionOptions(info.module, info.name, info.profile);
  md.appendMarkdown(
    info.source ? '\n\n**' + info.source + '**\n\n' : t('hover.builtInDescription'),
  );
  md.appendText(
    versioned
      ? t('hover.verifiedModelChoices', info.name, info.profile.version)
      : descriptionFor(info),
  );
  const options = optionsFor(info);
  if (options.length) {
    md.appendMarkdown(t('hover.availableValues'));
    for (const option of options) {
      md.appendText(`${option.value} — ${localizeText(option.label)}`);
      md.appendMarkdown('  \n');
    }
  }
  if (vscode.workspace.getConfiguration('openfast').get('showOriginalDescription', true)) {
    const comments = lineComments(info);
    if (comments.length) {
      md.appendMarkdown(t('hover.lineComments'));
      comments.forEach((comment, index) => {
        if (index > 0) md.appendMarkdown('\n\n');
        md.appendText(comment);
      });
    }
  }
  if (info.applicability) {
    md.appendMarkdown('\n\n');
    md.appendText(localizeApplicability(info.applicability));
  }
  const doc = findDocumentation(info.name, info.module);
  if (doc) {
    md.appendMarkdown(t('hover.specificDocumentation', doc.url));
    md.appendText(doc.section);
    md.appendMarkdown('\n\n');
    md.appendText(t('hover.documentationCheckedOn', documentation.checkedOn));
  } else {
    md.appendMarkdown('\n\n');
    md.appendText(t('hover.documentationUnavailable'));
    const url =
      catalog.sources[info.module] ||
      `https://openfast.readthedocs.io/en/main/source/user/${info.module.toLowerCase()}/index.html`;
    const fallback = ['OpenFAST', '通用', 'ROSCO', 'MoorDyn'].includes(info.module)
      ? catalog.sources[info.module] || catalog.sources.OpenFAST
      : url;
    md.appendMarkdown(t('hover.generalDocumentation', fallback));
  }
  if (info.profile.known && info.profile.major < 5) {
    md.appendMarkdown(
      t(
        'hover.versionDocumentation',
        documentationUrl(doc?.url || catalog.sources.OpenFAST, info.profile),
      ),
    );
  }
  return md;
}
async function autoDetect(document: vscode.TextDocument): Promise<void> {
  if (!vscode.workspace.getConfiguration('openfast', document.uri).get('autoDetect', true)) {
    return;
  }
  if (document.languageId !== 'plaintext') {
    return;
  }
  if (isOpenFASTTextFile(document.uri.path, document.getText())) {
    await vscode.languages.setTextDocumentLanguage(document, 'openfast');
  }
}
function semanticType(token, source?: string) {
  if (source !== undefined) return tokenType(token, source);
  if (token.kind === 'parameter') {
    return 'parameter';
  }
  if (token.kind === 'header') {
    return 'property';
  }
  if (token.kind === 'output') {
    return 'enumMember';
  }
  if (token.kind === 'end') {
    return 'keyword';
  }
  const value = token.value || '';
  if (/^[-+]?(?:\d|\.\d)/.test(value)) {
    return 'number';
  }
  if (
    /^(true|false|default|ranlux|none|unused|fixed|vessel|n\/a)$/i.test(
      value.replace(/^["']|["']$/g, ''),
    )
  ) {
    return 'keyword';
  }
  return 'string';
}
async function provideLinks(document, cancellation) {
  if (document.uri.scheme === 'untitled') {
    return [];
  }
  const links = [];
  for (const entry of parsed(document).parameters.values()) {
    if (cancellation?.isCancellationRequested) {
      break;
    }
    if (!/(?:File|Files|Names|FilenameRoot|PotFile)/i.test(entry.name)) {
      continue;
    }
    for (const match of entry.value.matchAll(/"([^"]+)"|'([^']+)'/g)) {
      const filename = match[1] || match[2];
      if (/^(none|unused|default)$/i.test(filename) || !filename.trim()) {
        continue;
      }
      let destination;
      if (/^[A-Za-z]:[\\/]|^\\\\/.test(filename) || filename.startsWith('/')) {
        destination = vscode.Uri.file(filename);
      } else {
        destination = vscode.Uri.joinPath(document.uri, '..', filename.replace(/\\/g, '/'));
      }
      if (entry.name === 'PotFile' || entry.name === 'FilenameRoot') {
        destination = destination.with({
          path: destination.path + (entry.name === 'PotFile' ? '.hst' : '.wnd'),
        });
      }
      try {
        if (!canReadReference(vscode.workspace, destination)) continue;
        await vscode.workspace.fs.stat(destination);
      } catch {
        continue;
      }
      const line = document.lineAt(entry.line).text;
      const valueStart = line.indexOf(entry.value);
      const start = valueStart + match.index + 1;
      const link = new vscode.DocumentLink(
        new vscode.Range(entry.line, start, entry.line, start + filename.length),
        destination,
      );
      link.tooltip = t('links.openReference');
      links.push(link);
    }
  }
  return links;
}
function activate(context: vscode.ExtensionContext) {
  configureLanguage(() =>
    languageFor(
      vscode.workspace.getConfiguration('openfast').get('language', 'auto'),
      vscode.env.language,
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('openfast.selectLanguage', async () => {
      const choices = [
        { label: t('language.auto'), value: 'auto' },
        { label: '简体中文', value: 'zh-CN' },
        { label: 'English', value: 'en' },
      ];
      const choice = await vscode.window.showQuickPick(choices, {
        title: t('language.selectTitle'),
      });
      if (choice)
        await vscode.workspace
          .getConfiguration('openfast')
          .update('language', choice.value, vscode.ConfigurationTarget.Global);
    }),
  );
  const selector = { language: 'openfast' };
  const register = (x) => context.subscriptions.push(x);
  const safelyDetect = (doc) => {
    void autoDetect(doc).catch((error) => console.warn('OpenFAST detection:', error.message));
  };
  register(vscode.workspace.onDidOpenTextDocument(safelyDetect));
  register(
    vscode.workspace.onDidChangeTextDocument((event) => {
      // Only retry on header edits; typing into a large config should not rescan it twice.
      if (event.contentChanges.some((x) => x.range.start.line < 15)) {
        safelyDetect(event.document);
      }
    }),
  );
  register(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('openfast.autoDetect')) {
        vscode.workspace.textDocuments.forEach(safelyDetect);
      }
    }),
  );
  vscode.workspace.textDocuments.forEach(safelyDetect);
  register(
    vscode.commands.registerCommand('openfast.enableFileIcons', async () => {
      try {
        return await enableFileIcons(vscode, context);
      } catch (error) {
        void vscode.window.showErrorMessage(t('icons.configurationFailed', errorMessage(error)));
        return false;
      }
    }),
  );
  register(
    vscode.languages.registerHoverProvider(selector, {
      provideHover(document, position) {
        if (!vscode.workspace.getConfiguration('openfast', document.uri).get('enableHover', true)) {
          return;
        }
        const data = parsed(document);
        const token = tokenAt(data, position.line, position.character);
        if (!token || token.kind === 'end') {
          const source = document.lineAt(position.line).text,
            items = lex(source).items;
          const entries = supplements(vscode, document, data.module, profileFor(vscode, document));
          const custom = customScalarContext(
            document.getText(),
            position.line,
            items[0]?.start ?? 0,
            entries,
          );
          const cell = items.find(
            (c) => c.start <= position.character && position.character < c.end,
          );
          if (custom && cell && (cell.start === custom.start || cell.text === custom.entry.name)) {
            const md = new vscode.MarkdownString();
            md.appendText(custom.entry.description + '\n' + t('editor.workspaceSource'));
            md.appendText(
              '\n' +
                t(
                  'editor.customConstraint',
                  [
                    custom.entry.valueType,
                    ...(custom.entry.options || []),
                    ...(custom.entry.specialValues || []),
                  ]
                    .filter(Boolean)
                    .join(' · '),
                ),
            );
            return new vscode.Hover(
              md,
              new vscode.Range(position.line, cell.start, position.line, cell.end),
            );
          }
          return;
        }
        const profile = profileFor(vscode, document);
        const custom = supplements(vscode, document, data.module, profile).find(
          (e) =>
            e.name.toLowerCase() === token.name.toLowerCase() &&
            e.kind === (token.kind === 'output' ? 'output' : 'parameter'),
        );
        const nodal =
          token.kind === 'output' &&
          token.outputKind === 'bladeNodes' &&
          data.module === 'ElastoDyn'
            ? nodalOutputs.channels.find((c) => c.name.toLowerCase() === token.name.toLowerCase())
            : undefined;
        const info = {
          ...explainToken(data, token),
          profile,
          ...(custom
            ? { description: custom.description, source: t('editor.workspaceSource') }
            : nodal
              ? { description: t('editor.nodalChannel', nodal.name) + ' · ' + nodal.unit }
              : {}),
        };
        const md = markdown(info);
        if (
          custom &&
          (custom.valueType || custom.options?.length || custom.specialValues?.length)
        ) {
          md.appendMarkdown('\n\n');
          md.appendText(
            t(
              'editor.customConstraint',
              [custom.valueType, ...(custom.options || []), ...(custom.specialValues || [])]
                .filter(Boolean)
                .join(' · '),
            ),
          );
        }
        const controlled = [
          ...new Set(
            data.records
              .filter((r) =>
                dependencyRules(data, r.name).some(
                  (d) => d[0].toLowerCase() === token.name.toLowerCase(),
                ),
              )
              .map((r) => r.name),
          ),
        ];
        if (controlled.length) {
          md.appendMarkdown('\n\n');
          md.appendText(t('editor.controls', controlled.join(', ')));
        }
        return new vscode.Hover(md, range(token));
      },
    }),
  );
  const suggestionsEnabled = (document) =>
    vscode.workspace.getConfiguration('openfast', document.uri).get('enableValueSuggestions', true);
  register(
    registerTimedCompletion(
      vscode,
      selector,
      {
        provideCompletionItems(document, position, cancellation, context) {
          if (
            !suggestionsEnabled(document) ||
            replacementPaused(document, Date.now(), position.line)
          ) {
            return [];
          }
          const value = valueContext(
            document.getText(),
            position.line,
            position.character,
            profileFor(vscode, document),
          );
          if (!value) {
            return [];
          }
          if (
            cancellation?.isCancellationRequested ||
            !compatibleSelections(vscode, document, (cursor) => {
              const context = valueContext(
                documentSnapshot(document).text,
                cursor.line,
                cursor.character,
                profileFor(vscode, document),
              );
              return context && { ...context, signature: context.module + ':' + context.name };
            })
          )
            return [];
          const state = candidateState(parsed(document), value.name, value.profile);
          const style = localStyle(document.getText(), position.line);
          return value.options.map((option, index) => {
            const insertion = styledValue(option.value, style);
            const item = new vscode.CompletionItem(
              { label: option.value, description: localizeText(option.label) },
              vscode.CompletionItemKind.EnumMember,
            );
            item.insertText = insertion + (value.needsSeparator ? ' ' : '');
            item.range = /^["']/.test(value.value)
              ? new vscode.Range(value.line, value.start, value.line, value.end)
              : completionRanges(vscode, value.line, value.start, value.end, position.character);
            item.detail = `${value.module} · ${value.name} · ${option.source}`;
            const explanation = explainToken(parsed(document), { ...value, kind: 'parameter' });
            if (explanation.applicability)
              item.detail += ' · ' + localizeApplicability(explanation.applicability);
            deferDocumentation(
              item,
              () =>
                markdown({
                  ...explainToken(parsed(document), { ...value, kind: 'parameter' }),
                  profile: value.profile,
                  description: localizeText(option.label),
                }),
              document,
            );
            // Manual expansion (including selected values) shows every choice;
            // automatic typing filters by the value prefix at the cursor.
            item.filterText =
              context?.triggerKind === vscode.CompletionTriggerKind.Invoke
                ? `${value.value} ${option.value} ${option.label}`.trim()
                : option.value;
            if (state.detail) item.detail += ' · ' + state.detail;
            item.sortText =
              String(state.rank) +
              (option.value.toLowerCase() === value.value.toLowerCase() ? '0' : '1') +
              String(index).padStart(3, '0');
            item.preselect = option.value.toLowerCase() === value.value.toLowerCase();
            return item;
          });
        },
        resolveCompletionItem: resolveDocumentation,
      },
      ...'0123456789TFtfDd'.split(''),
    ),
  );
  register(
    vscode.commands.registerCommand('openfast.chooseParameterValue', async (uri, line) => {
      let editor = vscode.window.activeTextEditor;
      if (uri && editor?.document.uri.toString() !== uri.toString()) {
        editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
      }
      if (!editor || editor.document.languageId !== 'openfast') {
        return false;
      }
      line = line ?? editor.selection.active.line;
      const document = editor.document;
      const version = document.version;
      const value = valueContext(document.getText(), line, undefined, profileFor(vscode, document));
      if (!value) {
        void vscode.window.showInformationMessage(t('parameter.noFixedChoices'));
        return false;
      }
      const choices = value.options.map((option) => ({
        label: option.value,
        description: localizeText(option.label),
        detail:
          option.value.toLowerCase() === value.value.toLowerCase()
            ? t('common.currentValue')
            : option.source,
        option,
      }));
      const picked = await vscode.window.showQuickPick(choices, {
        title: `${value.module} · ${value.name}`,
        placeHolder: t('parameter.selectValue'),
        matchOnDescription: true,
      });
      if (!picked) {
        return false;
      }
      if (document.version !== version) {
        void vscode.window.showInformationMessage(t('parameter.documentChanged'));
        return false;
      }
      return editor.edit((builder) =>
        builder.replace(
          new vscode.Range(line, value.start, line, value.end),
          picked.option.value + (value.needsSeparator ? ' ' : ''),
        ),
      );
    }),
  );
  register(
    vscode.languages.registerCodeActionsProvider(
      selector,
      {
        provideCodeActions(document, selection) {
          if (
            !suggestionsEnabled(document) ||
            replacementPaused(document, Date.now(), selection.start.line)
          ) {
            return [];
          }
          const value = valueContext(
            document.getText(),
            selection.start.line,
            undefined,
            profileFor(vscode, document),
          );
          if (!value) {
            return [];
          }
          const action = new vscode.CodeAction(
            t('parameter.chooseFixedValue', value.name),
            vscode.CodeActionKind.RefactorRewrite,
          );
          action.command = {
            title: action.title,
            command: 'openfast.chooseParameterValue',
            arguments: [document.uri, value.line],
          };
          return [action];
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.RefactorRewrite] },
    ),
  );
  registerSemanticAssistance(vscode, context, TYPES, semanticType);
  register(
    vscode.languages.registerDocumentSymbolProvider(selector, {
      provideDocumentSymbols(document) {
        const data = parsed(document);
        const result = [];
        for (let index = 0; index < data.sections.length; index++) {
          const section = data.sections[index];
          const end = (data.sections[index + 1]?.line ?? document.lineCount) - 1;
          const selection = document.lineAt(section.line).range;
          const symbol = new vscode.DocumentSymbol(
            section.name || data.module,
            '',
            vscode.SymbolKind.Namespace,
            new vscode.Range(
              selection.start,
              document.lineAt(Math.max(end, section.line)).range.end,
            ),
            selection,
          );
          for (const token of data.tokens.filter(
            (x) => x.kind === 'parameter' && x.line > section.line && x.line <= end,
          )) {
            symbol.children.push(
              new vscode.DocumentSymbol(
                token.name,
                token.value || '',
                vscode.SymbolKind.Property,
                document.lineAt(token.line).range,
                range(token),
              ),
            );
          }
          result.push(symbol);
        }
        return result;
      },
    }),
  );
  register(
    vscode.languages.registerDocumentLinkProvider(selector, { provideDocumentLinks: provideLinks }),
  );
  register(
    vscode.commands.registerCommand('openfast.setLanguage', async () => {
      const document = vscode.window.activeTextEditor?.document;
      if (document) {
        await vscode.languages.setTextDocumentLanguage(document, 'openfast');
      }
    }),
  );
  register(
    vscode.commands.registerCommand('openfast.lookupParameter', async () => {
      const items = [
        ...catalog.parameters.map((x) => ({ ...x, kind: 'parameter' })),
        ...catalog.tables.map((x) => ({ ...x, kind: 'header' })),
        ...catalog.outputs.map((x) => ({ ...x, kind: 'output' })),
      ].map((entry) => ({
        label: entry.name,
        description: `${moduleLabel(entry.module || '通用')} · ${{ parameter: t('lookup.parameterKind'), header: t('lookup.tableKind'), output: t('lookup.outputKind') }[entry.kind]}`,
        detail: descriptionFor(entry),
        entry,
      }));
      const choice = await vscode.window.showQuickPick(items, {
        title: t('lookup.title'),
        placeHolder: t('lookup.placeholder'),
        matchOnDescription: true,
        matchOnDetail: true,
      });
      if (!choice) {
        return;
      }
      const md = markdown({ ...choice.entry, module: choice.entry.module || 'OpenFAST' });
      const document = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: md.value,
      });
      await vscode.window.showTextDocument(document, { preview: true });
    }),
  );
  const workbench = registerWorkbench(vscode, context);
  registerEditorAssistance(vscode, context, profileFor, workbench.editorContext);
  registerEditorTools(vscode, context, workbench.editorContext);
  const runner = registerRunner(vscode, context, workbench);
  registerSweep(vscode, context, workbench);
  registerResults(vscode, context);
  return { workbench, runner };
}
function deactivate() {}
export { activate, deactivate, autoDetect, provideLinks, semanticType, markdown };
