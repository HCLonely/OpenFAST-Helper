import { documentSnapshot, textSnapshot } from './editor-snapshot';
import { numericParts, symbolRoles } from './editor-visuals';
import { largeContext } from './editor-large-context';
import { timed } from './editor-performance';
import { resultHighlightTokens } from './result-highlights';

/** One bounded edit, aligned to token records. Applying it recreates next exactly. */
export function semanticDelta(previous: Uint32Array, next: Uint32Array) {
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
  start -= start % 5;
  let tail = 0;
  while (
    tail < previous.length - start &&
    tail < next.length - start &&
    previous[previous.length - 1 - tail] === next[next.length - 1 - tail]
  )
    tail++;
  tail -= tail % 5;
  return previous.length === next.length && start === previous.length
    ? []
    : [
        {
          start,
          deleteCount: previous.length - start - tail,
          data: next.slice(start, next.length - tail),
        },
      ];
}
export const LARGE_DOCUMENT = 2_000_000;
export function registerSemanticAssistance(vscode, context, types, classify) {
  const legend = new vscode.SemanticTokensLegend(types);
  const changes = vscode.EventEmitter ? new vscode.EventEmitter() : undefined;
  if (changes) {
    context.subscriptions.push(changes);
    if (vscode.workspace?.onDidChangeConfiguration)
      context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration('openfast')) changes.fire();
        }),
      );
    context.subscriptions.push(
      vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
        const doc = event.textEditor.document;
        if (
          ['openfast', 'openfast-output'].includes(doc.languageId) &&
          doc.offsetAt(
            new vscode.Position(doc.lineCount - 1, doc.lineAt(doc.lineCount - 1).text.length),
          ) > LARGE_DOCUMENT
        )
          changes.fire();
      }),
    );
  }
  const previous = new WeakMap();
  let sequence = 0;
  function buildTokens(document, token, requested?) {
    if (token?.isCancellationRequested) return;
    const last = document.lineCount - 1;
    const size = document.offsetAt(new vscode.Position(last, document.lineAt(last).text.length));
    const large = size > LARGE_DOCUMENT;
    const ranges = large
      ? requested
        ? [requested]
        : vscode.window?.visibleTextEditors
            ?.filter((e) => e.document === document)
            .flatMap((e) => e.visibleRanges || [])
            .slice(0, 8) || []
      : [];
    if (large && !ranges.length) return;
    let tokens,
      lines,
      shift = 0;
    if (document.languageId === 'openfast-output') {
      const result = resultHighlightTokens(
        document,
        large
          ? ranges
          : [
              requested || {
                start: { line: 0 },
                end: { line: last },
              },
            ],
        token,
      );
      tokens = result.tokens;
      lines = result.lines;
    } else if (large) {
      tokens = [];
      lines = [];
      const seen = new Set();
      for (const visible of ranges) {
        const context = largeContext(
          document,
          Math.max(0, visible.start.line - 5),
          visible.end.line + 1,
          token,
        );
        if (!context) continue;
        const parsed = textSnapshot(context.lines.join('\n')).parsed;
        for (const value of parsed.tokens) {
          const line = context.map[value.line];
          if (line < visible.start.line || line > visible.end.line) continue;
          const key = line + ':' + value.start;
          if (seen.has(key)) continue;
          seen.add(key);
          lines[line] = context.lines[value.line];
          tokens.push({ ...value, line });
        }
      }
      tokens.sort((a, b) => a.line - b.line || a.start - b.start);
    } else {
      const snapshot = documentSnapshot(document);
      tokens = snapshot.parsed.tokens;
      lines = snapshot.lines;
    }
    const builder = new vscode.SemanticTokensBuilder(legend);
    const config = vscode.workspace?.getConfiguration?.('openfast', document.uri);
    const components = config?.get('highlightNumericParts', false);
    const roles =
      !large &&
      document.languageId !== 'openfast-output' &&
      config?.get('highlightSymbolRoles', false)
        ? new Map(
            symbolRoles(documentSnapshot(document).text).map((c) => [
              c.line + ':' + c.start,
              c.type,
            ]),
          )
        : new Map();
    for (const value of tokens) {
      if (token?.isCancellationRequested) return;
      const line = value.line + shift;
      if (requested && (line < requested.start.line || line > requested.end.line)) continue;
      if (value.end <= value.start) continue;
      const classified = classify(value, lines[value.line]);
      const parts =
        components && classified === 'number'
          ? numericParts(lines[value.line].slice(value.start, value.end), value.start)
          : [];
      const role = roles.get(line + ':' + value.start);
      if (parts.length && !role) {
        for (const part of parts)
          builder.push(new vscode.Range(line, part.start, line, part.end), part.type);
        continue;
      }
      builder.push(new vscode.Range(line, value.start, line, value.end), role || classified);
    }
    return builder.build(String(++sequence));
  }
  const build = (document, token, requested?) =>
    timed('highlight.semantic', () => buildTokens(document, token, requested));
  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      [{ language: 'openfast' }, { language: 'openfast-output' }],
      {
        onDidChangeSemanticTokens: changes?.event,
        provideDocumentSemanticTokens(document, token) {
          const result = build(document, token);
          if (result) previous.set(document, result);
          return result;
        },
        provideDocumentSemanticTokensEdits(document, id, token) {
          const old = previous.get(document),
            result = build(document, token);
          if (!result) return;
          previous.set(document, result);
          if (!old || old.resultId !== id) return result;
          return new vscode.SemanticTokensEdits(
            semanticDelta(old.data, result.data).map(
              (e) => new vscode.SemanticTokensEdit(e.start, e.deleteCount, e.data),
            ),
            result.resultId,
          );
        },
      },
      legend,
    ),
  );
  context.subscriptions.push(
    vscode.languages.registerDocumentRangeSemanticTokensProvider(
      [{ language: 'openfast' }, { language: 'openfast-output' }],
      {
        provideDocumentRangeSemanticTokens(document, range, token) {
          return build(document, token, range);
        },
      },
      legend,
    ),
  );
}
