import { scopedTableProvider } from './editor-large-context';
import { canReadReference } from './reference-access';
import { fieldGroup } from './editor-fields';
import { countedArrayContext, nodeChoices } from './editor-arrays';
import { registerTimedCompletion } from './editor-performance';
import {
  candidateLabel,
  naturalSortKey,
  scalarUnit,
  controlSources,
  outputCategory,
} from './editor-presentation';
import { registerEditorPreview } from './editor-preview';
import { expandedFields } from './table-layout';
import { tableContinuation } from './table-cells';
import { registerRenameAssistance } from './editor-rename';
import { symbolRoles } from './editor-visuals';
import { selectedMembers } from './editor-table-feedback';
import { tableValueChoices } from './table-rules';
import { jointListContext } from './editor-context';
import { registerNavigationAssistance } from './editor-navigation';
import { noteInput, replacementPaused, currentRevision } from './editor-input-state';
import { outputBlockAt } from './output-blocks';
import { normalizedOutput } from './output-names';
import { unusedIds, registerTableAssistance } from './editor-table';
import { fileListContext } from './editor-lists';
import { supplements, customScalarContext } from './workspace-dictionary';
import { editDistance } from './editor-rules';
import { registerUnicodeAssistance } from './unicode-assistance';
import * as path from 'node:path';
import { t, descriptionFor, localizeText, localizeApplicability } from './i18n';
import { parseDocument, lex, applicability, detectModule, explainToken } from './parser';
import { documentSnapshot } from './editor-snapshot';
import {
  candidateState,
  localStyle,
  deferDocumentation,
  resolveDocumentation,
  registerSymbolAssistance,
} from './editor-intelligence';
import {
  tableEnums,
  arrayFocus,
  numberedOutputs,
  completionRanges,
  compatibleSelections,
} from './editor-rules';
import { registerNumericAssistance } from './numeric-assistance';
import { optionsFor } from './value-options';
import { versionIssues } from './versions';
import { errorMessage } from './errors';
import { DirectoryCache } from './directory-cache';
import { resourceKey } from './resource-key';
import {
  pathContext,
  pathRank,
  sectionFolds,
  tableColumn,
  tableAt,
  tableReferenceChoices,
  arrayContext,
  countEdits,
  outputGroups,
  parameterNameContext,
} from './editor-context';

/** Editor adapter. All mutation is limited to an explicit command or accepted completion. */
export function registerEditorAssistance(
  vscode,
  context,
  profileFor,
  caseContext = (_document) => ({ texts: [], references: [] }),
) {
  const register = (item) => context.subscriptions.push(item);
  const config = (document, key, fallback) =>
    vscode.workspace.getConfiguration('openfast', document.uri).get(key, fallback);
  const enabled = (document, key) => config(document, key, true);
  const selector = { language: 'openfast' };
  const range = (line, start, end) => new vscode.Range(line, start, line, end);
  const changes = new vscode.EventEmitter();
  register(changes);
  const rowDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('editor.hoverHighlightBackground'),
  });
  const columnDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
    border: '1px solid',
    borderColor: new vscode.ThemeColor('editor.wordHighlightBorder'),
  });
  register(rowDecoration);
  register(columnDecoration);
  const cellDecoration = vscode.window.createTextEditorDecorationType({
    border: '1px solid',
    borderColor: new vscode.ThemeColor('focusBorder'),
  });
  register(cellDecoration);
  const fieldStatus = vscode.window.createStatusBarItem?.(vscode.StatusBarAlignment?.Right, 99);
  if (fieldStatus) register(fieldStatus);
  registerEditorPreview(vscode, context);
  const roleStyles = ['openfastDefinition', 'openfastReference', 'openfastUnresolved'].map(
    (role, index) =>
      vscode.window.createTextEditorDecorationType({
        border: index === 0 ? '1px solid' : undefined,
        borderWidth: index === 1 ? '0 0 1px 0' : undefined,
        borderStyle: index === 1 ? 'dotted' : undefined,
        borderColor: new vscode.ThemeColor(
          index === 2 ? 'editorWarning.foreground' : 'editor.wordHighlightBorder',
        ),
        textDecoration: index === 2 ? 'underline wavy' : undefined,
      }),
  );
  roleStyles.forEach(register);
  const groupNames = ['identity', 'reference', 'geometry', 'coefficient'];
  const groupStyles = groupNames.map((_, index) =>
    vscode.window.createTextEditorDecorationType({
      borderWidth: '0 0 1px 0',
      borderStyle: 'dotted',
      borderColor: new vscode.ThemeColor('editorBracketHighlight.foreground' + (index + 1)),
    }),
  );
  groupStyles.forEach(register);
  register(vscode.workspace.onDidChangeTextDocument(noteInput));
  const data = documentSnapshot;
  registerSymbolAssistance(vscode, context);
  registerRenameAssistance(vscode, context);
  registerNavigationAssistance(vscode, context);
  registerTableAssistance(vscode, context);
  registerUnicodeAssistance(vscode, context);
  const pathRequests = new WeakMap();
  const pathMetadata = new WeakMap();
  const drawnRanges = new WeakMap<object, Map<object, string>>();
  function draw(editor, style, ranges) {
    if (!drawnRanges.has(editor)) drawnRanges.set(editor, new Map());
    const cache = drawnRanges.get(editor);
    const signature =
      editor.document.uri.toString() +
      ':' +
      editor.document.version +
      ':' +
      ranges
        .map((r) => [r.start.line, r.start.character, r.end.line, r.end.character].join(','))
        .join(';');
    if (cache.get(style) === signature) return;
    editor.setDecorations(style, ranges);
    cache.set(style, signature);
  }
  const headerCache = new Map();
  const directories = new DirectoryCache<{
    name: string;
    type: number;
    uri: any;
    key: string;
    natural: string;
  }>();
  const invalidateDirectory = (uri) => {
    directories.invalidate(resourceKey(vscode.Uri.joinPath(uri, '..').toString()));
    directories.invalidate(resourceKey(uri.toString()));
    headerCache.delete(resourceKey(uri.toString()));
  };
  if (vscode.workspace.createFileSystemWatcher) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    register(watcher);
    register(watcher.onDidCreate(invalidateDirectory));
    register(watcher.onDidChange(invalidateDirectory));
    register(watcher.onDidDelete(invalidateDirectory));
  }
  register(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('openfast')) {
        directories.invalidate();
        headerCache.clear();
      }
    }),
  );
  register({
    dispose() {
      directories.invalidate();
      headerCache.clear();
    },
  });
  const expectedModule = {
    EDFile: 'ElastoDyn',
    HydroFile: 'HydroDyn',
    AeroFile: 'AeroDyn',
    ServoFile: 'ServoDyn',
    SeaStFile: 'SeaState',
    MooringFile: 'MoorDyn',
    InflowFile: 'InflowWind',
    BDBldFile: 'BeamDyn',
  };
  async function headerModule(uri, cancellation) {
    if (
      !canReadReference(vscode.workspace, uri) ||
      !vscode.workspace.fs.stat ||
      !vscode.workspace.fs.readFile ||
      !/\.(?:fst|fstf|dat|in|txt)$/i.test(uri.path)
    )
      return { module: '', status: 'unsupported' };
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (cancellation?.isCancellationRequested) return { module: '', status: 'cancelled' };
      if (stat.size > 131072) return { module: '', status: 'large' };
      const key = resourceKey(uri.toString());
      const old = headerCache.get(key);
      if (old?.mtime === stat.mtime && old.size === stat.size) return old;
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (cancellation?.isCancellationRequested) return { module: '', status: 'cancelled' };
      const module = detectModule(Buffer.from(bytes).toString('utf8')) || '';
      const result = {
        mtime: stat.mtime,
        size: stat.size,
        module,
        status: module ? 'known' : 'unknown',
      };
      headerCache.set(key, result);
      if (headerCache.size > 128) headerCache.delete(headerCache.keys().next().value);
      return result;
    } catch {
      return { module: '', status: 'unreadable' };
    }
  }
  function decorate(editor) {
    if (!editor) return;
    const document = editor.document;
    const grouped = groupNames.map(() => []);
    const groupCursor = editor.selection?.active;
    const activeGroupCell =
      document.languageId === 'openfast' && document.getText().length <= 2000000 && groupCursor
        ? tableColumn(data(document).text, groupCursor.line, groupCursor.character)
        : undefined;
    if (
      document.languageId === 'openfast' &&
      config(document, 'highlightTableFieldGroups', false) &&
      document.getText().length <= 2000000
    ) {
      let count = 0;
      for (const table of data(document).tables)
        for (const row of [{ line: table.line, cells: table.headerTokens }, ...table.rows]) {
          if (
            editor.visibleRanges?.length &&
            !editor.visibleRanges.some((r) => row.line >= r.start.line && row.line <= r.end.line)
          )
            continue;
          const fields =
            row.line === table.line
              ? table.headers.map((name, index) => ({ name, index }))
              : expandedFields(table.headers, row.cells, table.units);
          for (let i = 0; i < Math.min(fields.length, row.cells.length) && count < 2000; i++) {
            const group = groupNames.indexOf(fieldGroup(fields[i].name));
            if (group < 0) continue;
            const cell = row.cells[i];
            // Definition/reference borders and the active-cell border already convey these roles.
            if (config(document, 'highlightSymbolRoles', false) && group < 2) continue;
            if (
              config(document, 'highlightActiveTableColumn', true) &&
              row.line === groupCursor?.line &&
              cell.start === activeGroupCell?.cell?.start &&
              cell.end === activeGroupCell?.cell?.end
            )
              continue;
            grouped[group].push(range(row.line, cell.start, cell.end));
            count++;
          }
        }
    }
    groupStyles.forEach((style, index) => draw(editor, style, grouped[index]));
    const roles =
      document.languageId === 'openfast' &&
      config(document, 'highlightSymbolRoles', false) &&
      document.getText().length <= 2000000
        ? symbolRoles(data(document).text)
        : [];
    for (let i = 0; i < roleStyles.length; i++) {
      const type = ['openfastDefinition', 'openfastReference', 'openfastUnresolved'][i];
      draw(
        editor,
        roleStyles[i],
        roles
          .filter(
            (c) =>
              c.type === type &&
              (!editor.visibleRanges?.length ||
                editor.visibleRanges.some((r) => c.line >= r.start.line && c.line <= r.end.line)),
          )
          .map((c) => range(c.line, c.start, c.end)),
      );
    }
    const rows = [],
      columns = [],
      cells = [];
    let statusText = '';
    if (
      document.languageId === 'openfast' &&
      (enabled(document, 'highlightActiveTableColumn') || enabled(document, 'highlightArrayMatrix'))
    ) {
      const cursor = editor.selection.active;
      const snapshot = data(document);
      const { text } = snapshot;
      const visible = (line) =>
        !editor.visibleRanges?.length ||
        editor.visibleRanges.some((r) => line >= r.start.line && line <= r.end.line);
      const where = tableColumn(text, cursor.line, cursor.character);
      if (where && enabled(document, 'highlightActiveTableColumn')) {
        rows.push(document.lineAt(cursor.line).range);
        if (where.cell) cells.push(range(cursor.line, where.cell.start, where.cell.end));
        if (
          fieldStatus &&
          editor === vscode.window.activeTextEditor &&
          enabled(document, 'enableTableHints')
        ) {
          statusText =
            '$(table) ' +
            t(
              'editor.activeColumn',
              where.column + 1,
              where.field,
              where.unit || t('table.seeHeader'),
            );
        }
        for (const row of [
          { line: where.table.line, cells: where.table.headerTokens },
          ...where.table.rows,
        ]) {
          if (!visible(row.line)) continue;
          const fields =
            row.line === where.table.line
              ? where.table.headers.map((name) => ({ name, element: 0 }))
              : expandedFields(where.table.headers, row.cells, where.table.units);
          for (let i = 0; i < fields.length; i++) {
            if (
              fields[i].name !== where.field ||
              (where.element && fields[i].element && fields[i].element !== where.element)
            )
              continue;
            const cell = row.cells[i];
            // The active cell already has the row background and its own focus border.
            if (
              cell &&
              !(
                row.line === cursor.line &&
                cell.start === where.cell?.start &&
                cell.end === where.cell?.end
              )
            )
              columns.push(range(row.line, cell.start, cell.end));
          }
        }
      }
      if (enabled(document, 'highlightArrayMatrix')) {
        const array = arrayFocus(text, cursor.line, cursor.character);
        if (array) columns.push(range(cursor.line, array.token.start, array.token.end));
        const matrix = snapshot.tokensByLine
          .get(cursor.line)
          ?.find(
            (token) =>
              token.kind === 'matrix' &&
              token.start <= cursor.character &&
              cursor.character <= token.end,
          );
        if (matrix) {
          rows.push(document.lineAt(cursor.line).range);
          for (const [line, tokens] of snapshot.tokensByLine)
            if (visible(line))
              for (const token of tokens) {
                if (
                  token.kind === 'matrix' &&
                  token.name === matrix.name &&
                  token.column === matrix.column &&
                  line - (token.row - 1) === cursor.line - (matrix.row - 1)
                )
                  columns.push(range(line, token.start, token.end));
              }
        }
      }
    }
    draw(editor, rowDecoration, rows);
    draw(editor, columnDecoration, columns);
    draw(editor, cellDecoration, cells);
    if (fieldStatus && editor === vscode.window.activeTextEditor) {
      if (statusText) {
        if (fieldStatus.text !== statusText) fieldStatus.text = statusText;
        fieldStatus.tooltip = t('editor.fieldStatus');
        fieldStatus.show();
      } else fieldStatus.hide();
    }
  }
  function refresh() {
    changes.fire();
    if (!vscode.window.activeTextEditor) fieldStatus?.hide();
    // Draw the active editor last so a split with the same document keeps its own field status.
    [...vscode.window.visibleTextEditors]
      .sort(
        (a, b) =>
          Number(a === vscode.window.activeTextEditor) -
          Number(b === vscode.window.activeTextEditor),
      )
      .forEach(decorate);
  }
  register(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (event.textEditor.document.languageId === 'openfast') {
        decorate(event.textEditor);
        changes.fire();
      }
    }),
  );
  register(vscode.window.onDidChangeActiveTextEditor(refresh));
  register(vscode.window.onDidChangeVisibleTextEditors(refresh));
  register(vscode.window.onDidChangeTextEditorVisibleRanges((event) => decorate(event.textEditor)));
  register(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('openfast')) refresh();
    }),
  );
  register(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === 'openfast') refresh();
    }),
  );

  register(
    vscode.languages.registerFoldingRangeProvider(selector, {
      provideFoldingRanges(document) {
        return sectionFolds(data(document).text).map(
          (f) => new vscode.FoldingRange(f.start, f.end, vscode.FoldingRangeKind.Region),
        );
      },
    }),
  );

  register(
    registerTimedCompletion(
      vscode,
      selector,
      {
        async provideCompletionItems(document, position, cancellation) {
          if (
            !enabled(document, 'enablePathSuggestions') ||
            ['untitled', 'openfast-highlight-preview'].includes(document.uri.scheme)
          )
            return [];
          if (cancellation?.isCancellationRequested) return [];
          const request = {};
          pathRequests.set(document, request);
          const revision = document.version;
          const where = pathContext(data(document).text, position.line, position.character);
          if (!where) return [];
          if (
            !compatibleSelections(vscode, document, (cursor) => {
              const value = pathContext(data(document).text, cursor.line, cursor.character);
              return value && { ...value, signature: value.name + ':' + value.value };
            })
          )
            return [];
          const slash = Math.max(where.prefix.lastIndexOf('/'), where.prefix.lastIndexOf('\\'));
          const parent = slash < 0 ? '' : where.prefix.slice(0, slash + 1);
          // URI joins keep remote filesystem access in the extension host's filesystem.
          const normalized = parent.replace(/\\/g, '/');
          const folder =
            path.posix.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized)
              ? document.uri.with({
                  path: normalized.startsWith('/') ? normalized : '/' + normalized,
                })
              : vscode.Uri.joinPath(document.uri, '..', normalized || '.');
          let entries;
          if (!canReadReference(vscode.workspace, folder)) return [];
          try {
            entries = await directories.read(resourceKey(folder.toString()), async () => {
              const listing = await vscode.workspace.fs.readDirectory(folder);
              return listing.map(([name, type]) => {
                const uri = vscode.Uri.joinPath(folder, name);
                return {
                  name,
                  type,
                  uri,
                  key: resourceKey(uri.toString()),
                  natural: naturalSortKey(name),
                };
              });
            });
          } catch {
            return [];
          }
          if (
            cancellation?.isCancellationRequested ||
            document.version !== revision ||
            pathRequests.get(document) !== request
          )
            return [];
          const used = new Set(caseContext(document).references.map(resourceKey));
          const knownModules = new Map();
          const files = entries
            .filter(
              ({ name, type }) =>
                !(type & vscode.FileType.Directory) && pathRank(where.name, name) < 2,
            )
            .slice(0, entries.length > 100 ? 0 : 24);
          for (let i = 0; i < files.length; i += 4) {
            if (
              cancellation?.isCancellationRequested ||
              document.version !== revision ||
              pathRequests.get(document) !== request
            )
              return [];
            await Promise.all(
              files
                .slice(i, i + 4)
                .map(async ({ name, uri }) =>
                  knownModules.set(name, await headerModule(uri, cancellation)),
                ),
            );
          }
          if (
            cancellation?.isCancellationRequested ||
            document.version !== revision ||
            pathRequests.get(document) !== request
          )
            return [];
          const seen = new Set();
          const style = localStyle(data(document).text, position.line);
          const state = candidateState(
            data(document).parsed,
            where.name,
            profileFor(vscode, document),
          );
          return entries.flatMap(({ name, type, uri, key, natural }) => {
            const directory = !!(type & vscode.FileType.Directory);
            const stem =
              where.name === 'PotFile' && /\.(?:hst|1)$/i.test(name)
                ? name.replace(/\.(?:hst|1)$/i, '')
                : where.name === 'FilenameRoot' && /\.wnd$/i.test(name)
                  ? name.replace(/\.wnd$/i, '')
                  : name;
            const separator = /[\\/]/.test(where.prefix)
              ? where.separator
              : style.separator || where.separator;
            const candidate = parent + stem + (directory ? separator : '');
            const quote = /^["']/.test(where.value) ? where.quote : style.quote;
            if (seen.has(candidate) || candidate.includes(quote)) return [];
            seen.add(candidate);
            const item = new vscode.CompletionItem(
              { label: stem + (directory ? where.separator : ''), description: where.name },
              directory ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File,
            );
            // Replace the full path value, never the label or description. Explicit filterText
            // includes the typed quote and directory so VS Code can match full-token edits.
            item.range = range(position.line, where.start, where.end);
            if (directory) {
              const snippet = new vscode.SnippetString();
              snippet.appendText(quote + candidate);
              snippet.appendTabstop(0);
              snippet.appendText(quote + (where.needsSeparator ? ' ' : ''));
              item.insertText = snippet;
              item.command = {
                command: 'editor.action.triggerSuggest',
                title: t('editor.browseFolder'),
              };
            } else item.insertText = quote + candidate + quote + (where.needsSeparator ? ' ' : '');
            item.filterText = (/^["']/.test(where.value) ? where.quote : '') + candidate;
            const header = knownModules.get(name) || headerCache.get(key);
            const module = header?.module || '';
            const expected = expectedModule[where.name.replace(/\(\d+\)|\d+$/g, '')];
            const mismatch = module && expected && module !== expected;
            const referenced = used.has(key);
            const compatible =
              module && module === expectedModule[where.name.replace(/\(\d+\)|\d+$/g, '')];
            item.sortText =
              String(state.rank + (mismatch ? 3 : 0)) +
              (referenced
                ? '0'
                : directory
                  ? '1'
                  : compatible
                    ? '2'
                    : String(3 + pathRank(where.name, name))) +
              natural;
            const buildDetail = () =>
              t('editor.pathDetail', where.name, candidate) +
              (where.listIndex
                ? ' · ' + t('editor.listPosition', where.listIndex, where.listCount)
                : '') +
              (referenced ? ' · ' + t('editor.pathUsed') : '') +
              (state.detail ? ' · ' + state.detail : '') +
              ' · ' +
              t(
                'editor.rankReason',
                [
                  referenced && t('editor.rank.reference'),
                  compatible && t('editor.rank.module'),
                  pathRank(where.name, name) < 2 && t('editor.rank.name'),
                ]
                  .filter(Boolean)
                  .join(' / ') || t('editor.rank.natural'),
              );
            const baseDetail =
              entries.length > 100
                ? where.name + (state.detail ? ' · ' + state.detail : '')
                : buildDetail();
            item.detail =
              baseDetail +
              (module ? ' · ' + t('editor.pathModule', module) : '') +
              (mismatch ? ' · ' + t('editor.pathMismatch', expected, module) : '') +
              (!directory && header && ['unreadable', 'large', 'unknown'].includes(header.status)
                ? ' · ' + t(('editor.pathStatus.' + header.status) as any)
                : '');
            deferDocumentation(
              item,
              () => {
                const md = new vscode.MarkdownString();
                md.appendText(
                  localizeApplicability(where.applicability || '') || t('editor.relativePath'),
                );
                return md;
              },
              document,
            );
            if (!directory && entries.length > 100)
              pathMetadata.set(item, {
                uri,
                document,
                revision,
                expected,
                detail: buildDetail,
              });
            return [item];
          });
        },
        async resolveCompletionItem(item, token) {
          const meta = pathMetadata.get(item);
          if (meta && meta.document.version === meta.revision && !token?.isCancellationRequested) {
            const header = await headerModule(meta.uri, token),
              module = header.module;
            if (currentRevision(meta.document, meta.revision) && !token?.isCancellationRequested) {
              item.detail =
                meta.detail() +
                (module ? ' · ' + t('editor.pathModule', module) : '') +
                (module && meta.expected && module !== meta.expected
                  ? ' · ' + t('editor.pathMismatch', meta.expected, module)
                  : '') +
                (['unreadable', 'large', 'unknown'].includes(header.status)
                  ? ' · ' + t(('editor.pathStatus.' + header.status) as any)
                  : '');
              pathMetadata.delete(item);
            }
          }
          return resolveDocumentation(item, token);
        },
      },
      '"',
      "'",
      '/',
      '\\',
    ),
  );

  register(
    registerTimedCompletion(
      vscode,
      selector,
      scopedTableProvider(
        {
          provideCompletionItems(document, position) {
            if (
              !enabled(document, 'enableTableSuggestions') ||
              replacementPaused(document, Date.now(), position.line)
            )
              return [];
            const where = tableReferenceChoices(
              data(document).text,
              position.line,
              position.character,
            );
            const column = tableColumn(data(document).text, position.line, position.character);
            if (!column || position.line === column.table.line) return [];
            if (
              !compatibleSelections(vscode, document, (cursor) => {
                const value = tableColumn(data(document).text, cursor.line, cursor.character);
                return (
                  value && {
                    signature: value.field,
                    start: value.cell?.start ?? cursor.character,
                    end: value.cell?.end ?? cursor.character,
                  }
                );
              })
            )
              return [];
            const enums = tableValueChoices(data(document).parsed.module, column.field);
            const ids = document.openfastPartial
              ? []
              : unusedIds(column.table, column.field, data(document).parsed.module);
            const choices = where?.choices || (ids.length ? ids : enums);
            const selected = selectedMembers(data(document).text, position.line, column.column);
            return choices.map((choice) => {
              const item = new vscode.CompletionItem(
                candidateLabel(choice.value, choice.summary || localizeText(choice.label || '')),
                vscode.CompletionItemKind.Reference,
              );
              item.insertText = choice.value;
              const end = column.cell?.end ?? position.character;
              if (
                end === (data(document).lines[position.line] || '').length &&
                column.column <
                  expandedFields(
                    column.table.headers,
                    column.table.rows.find((r) => r.line === position.line)?.cells || [],
                  ).length -
                    1
              )
                item.insertText += tableContinuation(
                  data(document).lines,
                  column.table,
                  position.line,
                  column.column,
                  choice.value,
                  column.cell?.start ?? position.character,
                );
              item.commitCharacters = [];
              item.filterText = choice.value;
              item.sortText =
                (selected.has(choice.value) ? '1' : '0') + naturalSortKey(choice.value);
              item.detail =
                (selected.has(choice.value) ? t('editor.memberSelected') + ' · ' : '') +
                (choice.section
                  ? t('editor.referenceDetail', column.field, choice.section) +
                    (choice.summary ? ' · ' + choice.summary : '')
                  : choice.label) +
                ' · ' +
                t(
                  'editor.rankReason',
                  [
                    where
                      ? t('editor.rank.definition')
                      : ids.length
                        ? t('editor.rank.unused')
                        : choice.label,
                    selected.has(choice.value) && t('editor.rank.selected'),
                  ]
                    .filter(Boolean)
                    .join(' / '),
                );
              if (choice.source) {
                const md = new vscode.MarkdownString();
                md.appendText(choice.label + '\n' + choice.source);
                item.documentation = md;
              }
              item.range = completionRanges(
                vscode,
                position.line,
                column.cell?.start ?? position.character,
                column.cell?.end ?? position.character,
                position.character,
              );
              return item;
            });
          },
        },
        vscode,
      ),
      ...'0123456789TFtfCcVvFf'.split(''),
    ),
  );

  register(
    registerTimedCompletion(vscode, selector, {
      provideCompletionItems(document, position) {
        if (
          !enabled(document, 'enableParameterNameSuggestions') ||
          replacementPaused(document, Date.now(), position.line)
        )
          return [];
        const where = parameterNameContext(data(document).text, position.line, position.character);
        if (!where) return [];
        if (
          !compatibleSelections(vscode, document, (cursor) => {
            const value = parameterNameContext(data(document).text, cursor.line, cursor.character);
            return value && { ...value, signature: value.text.toLowerCase() };
          })
        )
          return [];
        const profile = profileFor(vscode, document);
        const extra = supplements(vscode, document, where.module, profile)
          .filter((e) => e.kind === 'parameter')
          .map((e) => ({ ...e, rank: editDistance(where.text, e.name), custom: true }))
          .filter((e) => e.name.toLowerCase().startsWith(where.text.toLowerCase()) || e.rank <= 2);
        return [...where.candidates, ...extra].map((entry) => {
          const item = new vscode.CompletionItem(entry.name, vscode.CompletionItemKind.Property);
          item.range = completionRanges(
            vscode,
            position.line,
            where.start,
            where.end,
            position.character,
          );
          item.insertText = entry.name;
          item.detail =
            t('editor.correctName', where.module) +
            ('custom' in entry
              ? ' · ' +
                t('editor.workspaceSource') +
                ('versions' in entry && Array.isArray(entry.versions) && entry.versions.length
                  ? ' · ' + entry.versions.join('/')
                  : '')
              : '');
          item.filterText = where.text;
          item.sortText = String(entry.rank).padStart(3, '0') + entry.name;
          const state = candidateState(data(document).parsed, entry.name, profile);
          item.sortText = String(state.rank) + item.sortText;
          if (state.detail) item.detail += ' · ' + state.detail;
          if (state.deprecated) item.tags = [1];
          deferDocumentation(
            item,
            () => {
              const md = new vscode.MarkdownString();
              md.appendText(descriptionFor({ ...entry, module: where.module }));
              const warnings = versionIssues(
                {
                  module: where.module,
                  parameters: new Map(),
                  records: [{ ...entry, line: position.line }],
                },
                profile,
              );
              for (const warning of warnings.filter((w) => w.line === position.line))
                md.appendText('\n' + warning.message);
              return md;
            },
            document,
          );
          return item;
        });
      },
      resolveCompletionItem: resolveDocumentation,
    }),
  );

  register(
    registerTimedCompletion(
      vscode,
      selector,
      scopedTableProvider(
        {
          provideCompletionItems(document, position, token) {
            if (
              !enabled(document, 'enableTableSuggestions') ||
              token?.isCancellationRequested ||
              replacementPaused(document, Date.now(), position.line)
            )
              return [];
            const where = jointListContext(data(document).text, position.line, position.character);
            if (!where) return [];
            if (
              !compatibleSelections(vscode, document, (cursor) => {
                const value = jointListContext(data(document).text, cursor.line, cursor.character);
                return value && { ...value, signature: 'JOutLst' };
              })
            )
              return [];
            return where.choices.map((choice) => {
              const item = new vscode.CompletionItem(
                candidateLabel(choice.value, choice.summary),
                vscode.CompletionItemKind.Reference,
              );
              item.insertText = choice.value + (where.needsSeparator ? ' ' : '');
              item.range = completionRanges(
                vscode,
                position.line,
                where.start,
                where.end,
                position.character,
              );
              item.detail =
                t('editor.referenceDetail', 'JOutLst', choice.section) +
                ' · ' +
                choice.summary +
                ' · ' +
                t('editor.listPosition', where.index, where.count ?? '?') +
                ' · ' +
                t(
                  'editor.rankReason',
                  t('editor.rank.definition') +
                    (where.selected.has(choice.value) ? ' / ' + t('editor.rank.selected') : ''),
                );
              item.filterText = choice.value;
              item.sortText =
                (where.selected.has(choice.value) ? '1' : '0') + naturalSortKey(choice.value);
              item.commitCharacters = [];
              return item;
            });
          },
        },
        vscode,
      ),
      ...'0123456789,'.split(''),
    ),
  );

  register(
    registerTimedCompletion(vscode, selector, {
      provideCompletionItems(document, position, token) {
        if (
          !enabled(document, 'enableValueSuggestions') ||
          token?.isCancellationRequested ||
          replacementPaused(document, Date.now(), position.line)
        )
          return [];
        const snapshot = data(document);
        const entries = supplements(
          vscode,
          document,
          snapshot.parsed.module,
          profileFor(vscode, document),
        );
        const where = customScalarContext(
          snapshot.text,
          position.line,
          position.character,
          entries,
        );
        if (
          !where ||
          !compatibleSelections(vscode, document, (cursor) => {
            const other = customScalarContext(
              snapshot.text,
              cursor.line,
              cursor.character,
              entries,
            );
            return other && { ...other, signature: other.entry.name };
          })
        )
          return [];
        return where.options.map((choice) => {
          const item = new vscode.CompletionItem(choice.value, vscode.CompletionItemKind.Value);
          item.insertText = choice.value + (where.needsSeparator ? ' ' : '');
          item.range = completionRanges(
            vscode,
            position.line,
            where.start,
            where.end,
            position.character,
          );
          item.detail = t('editor.workspaceSource') + ' · ' + where.entry.description;
          item.commitCharacters = [];
          return item;
        });
      },
    }),
  );

  register(
    vscode.languages.registerInlayHintsProvider(selector, {
      onDidChangeInlayHints: changes.event,
      provideInlayHints(document, requestedRange) {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document !== document) return [];
        const line = editor.selection.active.line;
        if (line < requestedRange.start.line || line > requestedRange.end.line) return [];
        const { text, parsed } = data(document);
        const labels = [];
        const density = config(document, 'hintDensity', 'standard');
        if (enabled(document, 'enableTableHints')) {
          const where = tableColumn(text, line, editor.selection.active.character);
          if (where)
            labels.push(
              density === 'compact'
                ? where.field
                : t(
                    'editor.activeColumn',
                    where.column + 1,
                    where.field,
                    where.unit || t('table.seeHeader'),
                  ),
            );
          if (where?.element) labels.push(t('editor.listPosition', where.element, where.count));
          const files = fileListContext(text, line, editor.selection.active.character, parsed);
          if (files) labels.push(t('editor.listPosition', files.index, files.count));
          const array = arrayContext(text, line, profileFor(vscode, document));
          if (array && density !== 'compact')
            labels.push(t('editor.arrayCount', array.name, array.actual, array.count));
          const focus = arrayFocus(text, line, editor.selection.active.character);
          if (focus) labels.push(t('editor.arrayElement', focus.index, focus.count));
          const matrix = data(document)
            .tokensByLine.get(line)
            ?.find(
              (token) =>
                token.kind === 'matrix' &&
                token.start <= editor.selection.active.character &&
                editor.selection.active.character <= token.end,
            );
          if (matrix) {
            labels.push(t('editor.matrixPosition', matrix.row, matrix.column));
            if (density !== 'compact') labels.push(descriptionFor(explainToken(parsed, matrix)));
          }
        }
        if (config(document, 'showCurrentValueHint', false)) {
          const record = parsed.records.find((r) => r.line === line);
          if (record) {
            const choice = optionsFor({
              ...record,
              module: parsed.module,
              profile: profileFor(vscode, document),
            }).find((option) => option.value.toLowerCase() === record.value.toLowerCase());
            if (choice) {
              const meaning = localizeText(choice.label);
              labels.push(
                density === 'compact'
                  ? candidateLabel('', meaning.split(/[；;。]/)[0]).description.slice(0, 32)
                  : candidateLabel('', meaning).description,
              );
            }
            const unit = scalarUnit(record.name, parsed.module);
            if (unit) labels.push(density === 'compact' ? unit : t('editor.scalarUnit', unit));
          }
        }
        if (!labels.length) return [];
        const hint = new vscode.InlayHint(
          new vscode.Position(line, document.lineAt(line).text.length),
          '  ' + labels.join(' · '),
          vscode.InlayHintKind.Parameter,
        );
        hint.paddingLeft = true;
        if (density === 'detailed') {
          const record = parsed.records.find((r) => r.line === line);
          if (record)
            hint.tooltip =
              descriptionFor({ ...record, module: parsed.module }) +
              '\n' +
              localizeApplicability(applicability(parsed, record.name));
        }
        return [hint];
      },
    }),
  );

  if (vscode.languages.registerHoverProvider)
    register(
      vscode.languages.registerHoverProvider(selector, {
        provideHover(document, position, token) {
          if (!enabled(document, 'enableHover') || token?.isCancellationRequested) return;
          const snapshot = data(document);
          const target = snapshot.parsed.tokens.find(
            (c) =>
              ['parameter', 'value'].includes(c.kind) &&
              c.line === position.line &&
              c.start <= position.character &&
              position.character < c.end,
          );
          if (!target) return;
          const sources = controlSources(caseContext(document), document.uri.toString(), (uri) =>
            vscode.workspace.textDocuments
              ?.find((d) => !d.isClosed && d.uri.toString() === uri)
              ?.getText(),
          );
          if (!sources.length) return;
          const md = new vscode.MarkdownString();
          md.isTrusted = false;
          for (const source of sources) {
            const uri = vscode.Uri.parse(source.uri).with({ fragment: 'L' + (source.line + 1) });
            md.appendText(
              (vscode.workspace.asRelativePath?.(vscode.Uri.parse(source.uri)) || source.uri) +
                '\n',
            );
            md.appendText(
              t(
                'editor.controlSource',
                source.role,
                source.name,
                source.value,
                source.active ? t('editor.controlEnabled') : t('editor.controlDisabled'),
              ) + '\n',
            );
            md.appendMarkdown(
              `[${t('editor.locateControl')}](${uri.toString().replace(/\(/g, '%28').replace(/\)/g, '%29')})\n\n`,
            );
          }
          return new vscode.Hover(md, range(target.line, target.start, target.end));
        },
      }),
    );

  function command(name, callback) {
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
  }
  const activeEditor = () => {
    const editor = vscode.window.activeTextEditor;
    return editor?.document.languageId === 'openfast' ? editor : undefined;
  };
  command('openfast.insertArrayValues', async () => {
    const editor = activeEditor();
    if (!editor) return false;
    const document = editor.document;
    const line = editor.selection.active.line;
    if (replacementPaused(document, Date.now(), line) || document.getText().length > 2000000)
      return false;
    const text = data(document).text;
    const array = arrayContext(text, line, profileFor(vscode, document));
    if (!array || array.count < 1 || array.count > 1000 || array.actual > array.count) {
      void vscode.window.showInformationMessage(t('editor.noArray'));
      return false;
    }
    const source = document.lineAt(line).text;
    const label = lex(source).items.find((item) => item.text === array.name);
    const values = array.values;
    const start = values[0]?.start ?? editor.selection.active.character;
    if (start > label.start) return false;
    const end = values.at(-1)?.end ?? start;
    const snippet = new vscode.SnippetString();
    for (let index = 0; index < array.count; index++) {
      if (index) snippet.appendText(', ');
      snippet.appendPlaceholder(
        values[index]?.text ||
          (array.placeholder === 'time'
            ? 'time_' + (index + 1) + '_s'
            : array.name + '_' + (index + 1)),
        index + 1,
      );
    }
    if (!values.length && start === label.start) snippet.appendText(' ');
    return editor.insertSnippet(snippet, range(line, start, end));
  });
  command('openfast.insertTableRow', async () => {
    const editor = activeEditor();
    if (!editor || !enabled(editor.document, 'enableTableSuggestions')) return false;
    const table = tableAt(data(editor.document).text, editor.selection.active.line);
    if (!table || table.headers.includes('FillMList') || table.headers.includes('NodeLocs')) {
      void vscode.window.showInformationMessage(t('editor.noTable'));
      return false;
    }
    const snippet = new vscode.SnippetString();
    const line = table.rows.at(-1)?.line ?? table.line + (table.units.length ? 1 : 0);
    snippet.appendText('\n');
    table.headers.forEach((header, index) => {
      if (index)
        snippet.appendText(
          tableContinuation(
            data(editor.document).lines,
            table,
            line + 1,
            index - 1,
            table.headers[index - 1],
            0,
            false,
          ),
        );
      // Field names deliberately require real user values; no guessed physics/defaults.
      const reference = tableReferenceChoices(
        data(editor.document).text,
        table.rows[0]?.line ?? table.line + 1,
        table.rows[0]?.cells[index]?.start ?? 0,
      );
      const choices = unusedIds(table, header, data(editor.document).parsed.module);
      const values = choices.length
        ? choices.map((c) => c.value)
        : reference?.field === header
          ? reference.choices.map((c) => c.value)
          : tableValueChoices(data(editor.document).parsed.module, header).map((c) => c.value);
      if (values.length && snippet.appendChoice)
        snippet.appendChoice([...new Set(values)].slice(0, 100), index + 1);
      else snippet.appendPlaceholder(header, index + 1);
    });
    const result = await editor.insertSnippet(
      snippet,
      new vscode.Position(line, editor.document.lineAt(line).text.length),
    );
    if (result && table.count) void vscode.window.showInformationMessage(t('editor.countAfterRow'));
    return result;
  });

  // Keep previews immutable and tied to the exact source version until apply.
  const previews = new Map();
  const previewScheme = 'openfast-count-preview';
  register(
    vscode.workspace.registerTextDocumentContentProvider(previewScheme, {
      provideTextDocumentContent: (uri) => previews.get(uri.toString())?.text || '',
    }),
  );
  register(
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.uri.scheme === previewScheme) previews.delete(document.uri.toString());
    }),
  );
  register({ dispose: () => previews.clear() });
  command('openfast.previewTableCounts', async () => {
    const editor = activeEditor();
    if (!editor) return false;
    const document = editor.document;
    const edits = countEdits(data(document).text);
    if (!edits.length) {
      void vscode.window.showInformationMessage(t('editor.noCountChanges'));
      return false;
    }
    const lines = document.getText().split(/\r?\n/);
    for (const edit of edits)
      lines[edit.line] =
        lines[edit.line].slice(0, edit.start) + edit.value + lines[edit.line].slice(edit.end);
    const uri = vscode.Uri.parse(
      previewScheme + ':/' + Date.now() + '-' + previews.size + '/counts.dat',
    );
    previews.set(uri.toString(), {
      text: lines.join(document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n'),
      source: document.uri,
      sourceText: document.getText(),
      version: document.version,
      edits,
    });
    await vscode.commands.executeCommand(
      'vscode.diff',
      document.uri,
      uri,
      t('editor.countPreviewTitle'),
    );
    const answer = await vscode.window.showInformationMessage(
      t('editor.countPreviewPrompt'),
      t('editor.applyCounts'),
    );
    if (answer !== t('editor.applyCounts')) return false;
    return vscode.commands.executeCommand('openfast.applyTableCounts', uri);
  });
  command('openfast.applyTableCounts', async (uri?) => {
    const key = (uri || vscode.window.activeTextEditor?.document.uri)?.toString();
    const preview = previews.get(key);
    if (!preview) return false;
    const document = await vscode.workspace.openTextDocument(preview.source);
    if (document.version !== preview.version || document.getText() !== preview.sourceText) {
      void vscode.window.showInformationMessage(t('editor.stalePreview'));
      return false;
    }
    const editor = await vscode.window.showTextDocument(document);
    // showTextDocument is asynchronous: check again after focus changes.
    if (document.version !== preview.version || document.getText() !== preview.sourceText)
      return false;
    const applied = await editor.edit((builder) => {
      for (const edit of preview.edits)
        builder.replace(range(edit.line, edit.start, edit.end), edit.value);
    });
    if (applied) previews.delete(key);
    return applied;
  });

  command('openfast.browseOutputChannels', () =>
    vscode.commands.executeCommand('openfast.insertOutputGroup', true),
  );
  command('openfast.insertOutputGroup', async (browse = false) => {
    const editor = activeEditor();
    if (!editor || !enabled(editor.document, 'enableOutputSuggestions')) return false;
    const document = editor.document;
    const version = document.version;
    const text = data(document).text;
    const parsed = parseDocument(text);
    const line = editor.selection.active.line;
    // Insert only on a blank line within an existing list; never manufacture file layout.
    let inList = false;
    for (const source of text.split(/\r?\n/).slice(0, line)) {
      if (/^\s*OutList\b/i.test(source) || /^[-=!\s]+.*OUTPUT(?: CHANNELS|S)\b/i.test(source))
        inList = true;
      else if (/^\s*END\b/i.test(source) || /^\s*[-=]{3}/.test(source)) inList = false;
    }
    const block = outputBlockAt(text, line);
    if (!inList || !block || block.kind !== 'regular' || document.lineAt(line).text.trim()) {
      void vscode.window.showInformationMessage(t('editor.outputPosition'));
      return false;
    }
    const existing = new Set(
      parsed.tokens
        .filter((token) => token.kind === 'output' && token.outputBlock === block.id)
        .map((token) => normalizedOutput(token.name, parsed.module)),
    );
    const dynamic = [
      ...numberedOutputs(text, caseContext(document).texts),
      ...supplements(vscode, document, parsed.module, profileFor(vscode, document)).filter(
        (e) => e.kind === 'output',
      ),
    ];
    const grouped =
      browse === true
        ? ['motion', 'loads', 'environment', 'control', 'other'].map((id) => ({
            id,
            channels: dynamic.filter((c) => outputCategory(c.name) === id),
          }))
        : outputGroups(parsed.module);
    const groups = grouped
      .map((group) => ({
        ...group,
        channels: dynamic.filter(
          (c) =>
            group.channels.some((g) => g.name === c.name) ||
            (group.id === 'blade' && /^Root[FM][xyz]b\d+$/.test(c.name)),
        ),
      }))
      .filter((group) => group.channels.length)
      .map((group) => ({
        label: t(('editor.group.' + group.id) as any),
        description: group.channels.map((c) => c.name).join(', '),
        group,
      }));
    if (!groups.length) {
      void vscode.window.showInformationMessage(t('editor.noOutputGroups'));
      return false;
    }
    const selected = await vscode.window.showQuickPick(groups, { title: t('editor.selectGroup') });
    if (!selected) return false;
    const choices = selected.group.channels
      .filter((c) => !existing.has(normalizedOutput(c.name, parsed.module)))
      .sort((a, b) => naturalSortKey(a.name).localeCompare(naturalSortKey(b.name), 'en'))
      .map((c) => ({
        label: c.name,
        description: c.unit,
        detail: c.description,
        picked: browse !== true,
      }));
    if (!choices.length) {
      void vscode.window.showInformationMessage(t('editor.groupAlreadyAdded'));
      return false;
    }
    const channels = await vscode.window.showQuickPick(choices, {
      canPickMany: true,
      title: t('editor.selectChannels'),
    });
    if (!channels?.length) return false;
    if (document.version !== version) {
      void vscode.window.showInformationMessage(t('parameter.documentChanged'));
      return false;
    }
    const quote =
      parsed.module === 'MoorDyn'
        ? ''
        : /^\s*'/.test(
              text
                .split(/\r?\n/)
                .find((s, i) =>
                  parsed.tokens.some((token) => token.line === i && token.kind === 'output'),
                ) || '',
            )
          ? "'"
          : '"';
    const indent = document.lineAt(line).text;
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    return editor.edit((builder) =>
      builder.replace(
        document.lineAt(line).range,
        channels.map((c) => indent + quote + c.label + quote).join(eol),
      ),
    );
  });
  registerNumericAssistance(vscode, context);
  register(
    registerTimedCompletion(
      vscode,
      selector,
      {
        provideCompletionItems(document, position, token) {
          if (
            token?.isCancellationRequested ||
            !enabled(document, 'enableTableSuggestions') ||
            replacementPaused(document, Date.now(), position.line) ||
            document.getText().length > 2000000
          )
            return [];
          const where = countedArrayContext(
            data(document).text,
            position.line,
            position.character,
            profileFor(vscode, document),
          );
          if (
            !where ||
            where.placeholder !== 'node' ||
            !compatibleSelections(vscode, document, (cursor) => {
              const c = countedArrayContext(
                data(document).text,
                cursor.line,
                cursor.character,
                profileFor(vscode, document),
              );
              return c && { ...c, signature: c.name };
            })
          )
            return [];
          const prefix = where.cell?.text.slice(0, position.character - where.cell.start) || '';
          return nodeChoices(where, prefix).map((choice) => {
            const item = new vscode.CompletionItem(
              candidateLabel(
                choice.value,
                t('editor.nodeChoice', where.name, where.index, where.count, where.nodes),
              ),
              vscode.CompletionItemKind.Value,
            );
            item.insertText = choice.value + (where.needsSeparator ? ' ' : '');
            item.filterText = choice.value;
            item.sortText = (choice.selected ? '1' : '0') + naturalSortKey(choice.value);
            item.range = completionRanges(
              vscode,
              position.line,
              where.start,
              where.end,
              position.character,
            );
            item.detail =
              t('editor.nodeChoice', where.name, where.index, where.count, where.nodes) +
              (choice.selected ? ' · ' + t('editor.memberSelected') : '');
            const md = new vscode.MarkdownString();
            md.appendText(
              where.source + '\n' + t('editor.arrayRuleVersion', where.versions.join('/')),
            );
            item.documentation = md;
            return item;
          });
        },
      },
      ...'0123456789;,'.split(''),
    ),
  );
  refresh();
}
