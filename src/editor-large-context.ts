import { catalog, findEntry } from './catalog';
import { lex, detectModule } from './parser';
const cache = new WeakMap<
  object,
  {
    version: number;
    lines: string[];
    anchors: { line: number; seeds: number[]; table?: string[] }[];
  }
>();
export const LARGE_CONTEXT_LIMIT = 12_000_000;
const headers = new Set(catalog.tables.map((c) => c.name.toLowerCase()));
/** One versioned lexical pass; no full-document semantic parse or per-row objects. */
function index(document, token) {
  const old = cache.get(document);
  if (old?.version === document.version) return old;
  const revision = document.version,
    text = document.getText();
  if (text.length > LARGE_CONTEXT_LIMIT) return;
  const lines = text.split(/\r?\n/);
  const module = detectModule(lines.slice(0, 30).join('\n'));
  if (lines.length > 250000) return;
  const anchors = [];
  let section: number[] = [];
  let controls: number[] = [];
  let table;
  for (let line = 0; line < lines.length; line++) {
    if (line % 128 === 0 && token?.isCancellationRequested) return;
    const source = lines[line].trim();
    const scalar = /\b([A-Za-z]\w*(?:\(\d+\))?)\s+[-–]\s/.exec(source);
    if (table && scalar && findEntry(scalar[1], module)) {
      table = undefined;
      anchors.push({ line, seeds: [] });
    }
    if (/^!?[-=]{3}/.test(source)) {
      section = [line];
      controls = [];
      table = undefined;
      anchors.push({ line, seeds: [line] });
    } else if (/^["']?END\b/i.test(source)) {
      table = undefined;
      controls = [];
      section = [];
      anchors.push({ line, seeds: [] });
    } else if (/\bBldNd_(?:BladesOut|BlOutNd(?:_Str)?)\b/.test(source)) {
      controls.push(line);
      controls = controls.slice(-4);
    } else if (/^(?:BldNd_OutList|OutList)\b/i.test(source)) {
      table = undefined;
      anchors.push({ line, seeds: [...section, ...controls, line] });
    } else if (source && /^[A-Za-z]/.test(source)) {
      const items = lex(lines[line]).items.filter(
        (c) =>
          c.start <
          (lines[line].search(/\[|!/) < 0 ? lines[line].length : lines[line].search(/\[|!/)),
      );
      if (items.length >= 2 && items.every((c) => headers.has(c.text.toLowerCase()))) {
        table = { line, seeds: [...section, line], table: items.map((c) => c.text) };
        anchors.push(table);
      } else if (table && items.length > 2 && items[2].text === '-') {
        table = undefined;
        anchors.push({ line, seeds: [] });
      }
    } else if (table && source.startsWith('(')) {
      table = { ...table, line, seeds: [...table.seeds, line] };
      anchors.push(table);
    }
    if (anchors.length > 4096) return;
  }
  if (token?.isCancellationRequested || document.version !== revision) return;
  const result = { version: revision, lines, anchors };
  cache.set(document, result);
  return result;
}
export function largeContext(document, from: number, to: number, token, definitions = false) {
  if (token?.isCancellationRequested) return;
  const indexed = index(document, token);
  if (!indexed) return;
  const { lines, anchors } = indexed;
  from = Math.max(0, from);
  to = Math.min(lines.length - 1, to, from + 799);
  let low = 0,
    high = anchors.length - 1,
    nearest;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (anchors[middle].line <= from) {
      nearest = anchors[middle];
      low = middle + 1;
    } else high = middle - 1;
  }
  const selected: number[] = [];
  if (definitions) {
    for (let a = 0; a < anchors.length && selected.length < 2048; a++) {
      const anchor = anchors[a],
        h = anchor.table;
      if (
        !h ||
        !(
          (h[0] === 'JointID' && h.some((f) => /^Joint[xyz]i$/i.test(f))) ||
          (h[0] === 'MemberID' && h.includes('MJointID1')) ||
          (h[0] === 'ID' && h.includes('Attachment')) ||
          (h[0] === 'Name' && h.includes('Diam')) ||
          ['PropSetID', 'MPropSetID', 'AxCoefID'].includes(h[0])
        )
      )
        continue;
      const end = Math.min((anchors[a + 1]?.line ?? lines.length) - 1, anchor.line + 256);
      selected.push(...anchor.seeds);
      for (let line = anchor.line + 1; line <= end && selected.length < 2048; line++)
        selected.push(line);
    }
  }
  const body = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
  const seeds = [
    ...new Set([...Array.from({ length: Math.min(15, lines.length) }, (_, i) => i), ...selected]),
  ].filter((i) => i < from);
  const map = [...seeds, -1, ...(nearest?.seeds || []).filter((i) => i < from), ...body];
  if (token?.isCancellationRequested || document.version !== indexed.version) return;
  return { lines: map.map((i) => (i < 0 ? '--- LOCAL CONTEXT ---' : lines[i])), map, from, to };
}
export function scopedTableProvider(provider, vscode) {
  return {
    ...provider,
    provideCompletionItems(document, position, token, ...rest) {
      const last = document.lineCount - 1;
      if (
        last < 0 ||
        !document.offsetAt ||
        document.offsetAt(new vscode.Position(last, document.lineAt(last).text.length)) <= 2_000_000
      )
        return provider.provideCompletionItems(document, position, token, ...rest);
      const context = largeContext(
        document,
        Math.max(0, position.line - 5),
        position.line + 5,
        token,
        true,
      );
      if (!context) return [];
      const revision = document.version;
      if (
        vscode.window.activeTextEditor?.document === document &&
        vscode.window.activeTextEditor.selections?.length > 1
      )
        return [];
      const text = context.lines.join('\n'),
        line = context.map.lastIndexOf(position.line);
      const proxy = {
        uri: document.uri,
        get version() {
          return document.version;
        },
        get isClosed() {
          return document.isClosed;
        },
        languageId: document.languageId,
        openfastPartial: true,
        openfastLineMap: context.map,
        getText: () => text,
        lineAt: (i) => ({ text: context.lines[i] }),
        lineCount: context.lines.length,
      };
      const result = provider.provideCompletionItems(
        proxy,
        { line, character: position.character },
        token,
        ...rest,
      );
      const restore = (items) =>
        document.version !== revision || document.isClosed || token?.isCancellationRequested
          ? []
          : items?.map((item) => {
              const convert = (r) =>
                r
                  ? new vscode.Range(
                      context.map[r.start.line],
                      r.start.character,
                      context.map[r.end.line],
                      r.end.character,
                    )
                  : r;
              item.range = item.range?.inserting
                ? {
                    inserting: convert(item.range.inserting),
                    replacing: convert(item.range.replacing),
                  }
                : convert(item.range);
              return item;
            });
      return result?.then ? result.then(restore) : restore(result);
    },
  };
}
