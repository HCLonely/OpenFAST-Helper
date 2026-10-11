import { fileListRanges } from './editor-lists';
import { lex, parseDocument } from './parser';
import { readTables } from './tables';
import { findEntry } from './catalog';
import { timed } from './editor-performance';
import { tableFields } from './table-layout';

/** Shared by editor providers. Original text is never normalized: offsets are UTF-16. */
const snapshots = new Map<string, ReturnType<typeof createSnapshot>>();
// No text keys or strong references: evicted snapshots can still be shared while a
// document/provider owns them, without extending the parsed-memory cache budget.
const recentSnapshots: WeakRef<ReturnType<typeof createSnapshot>>[] = [];
const documents = new WeakMap<
  object,
  { version: number; snapshot: ReturnType<typeof createSnapshot> }
>();
const MAX_TEXT = 4_000_000;
const MAX_ESTIMATED_BYTES = 32_000_000;
const weights = new Map<string, number>();
let estimatedBytes = 0;
let retained = 0;
let builds = 0;
let detailBuilds = 0;
let textHits = 0,
  documentHits = 0;
let weakHits = 0;
function rememberSnapshot(snapshot: ReturnType<typeof createSnapshot>) {
  if (recentSnapshots[0]?.deref() === snapshot) return;
  for (let index = recentSnapshots.length - 1; index >= 0; index--) {
    const previous = recentSnapshots[index].deref();
    if (!previous || previous === snapshot) recentSnapshots.splice(index, 1);
  }
  recentSnapshots.unshift(new WeakRef(snapshot));
  if (recentSnapshots.length > 8) recentSnapshots.length = 8;
}
function buildDetails(text: string, lines: string[]) {
  detailBuilds++;
  const parsed = parseDocument(text);
  const tables = readTables(text, true);
  // Editor providers share the recovered physical cells; the strict parser stays independent.
  const rows = new Map<number, { table: any; row: any }>();
  for (const table of tables) for (const row of table.rows) rows.set(row.line, { table, row });
  parsed.tokens = parsed.tokens.filter((token) => !rows.has(token.line));
  for (const [line, { table, row }] of rows) {
    const fields = tableFields(table, row.cells);
    row.cells.forEach((cell, index) => {
      if (fields[index] && cell.end > cell.start)
        parsed.tokens.push({
          line,
          start: cell.start,
          end: cell.end,
          kind: 'cell',
          name: fields[index].name,
          value: cell.text,
          column: index + 1,
        });
    });
  }
  const tokensByLine = new Map<number, typeof parsed.tokens>();
  const tableByLine = new Map<number, (typeof tables)[number]>();
  for (const token of parsed.tokens) {
    if (!tokensByLine.has(token.line)) tokensByLine.set(token.line, []);
    tokensByLine.get(token.line).push(token);
  }
  for (const table of tables) {
    tableByLine.set(table.line, table);
    for (const row of table.rows) tableByLine.set(row.line, table);
    const end = (table.rows.at(-1)?.line ?? table.line + (table.units.length ? 1 : 0)) + 1;
    if (!lines[end]?.trim()) tableByLine.set(end, table);
  }
  // Editor-only recovery. Strict parseDocument and solver validation remain unchanged.
  for (let line = 0; line < lines.length; line++) {
    if (
      tableByLine.has(line) ||
      tokensByLine.get(line)?.some((t) => ['output', 'end', 'parameter'].includes(t.kind))
    )
      continue;
    const source = lines[line];
    for (const match of source.matchAll(/\b([A-Za-z]\w*(?:\(\d+\))?)\s+[-–]\s/g)) {
      if (!findEntry(match[1], parsed.module)) continue;
      const prefix = source.slice(0, match.index).trim();
      if (
        !/^[-+.]$/.test(prefix) &&
        !(/^["']/.test(prefix) && prefix.split(prefix[0]).length === 2)
      )
        continue;
      const name = match[1];
      const recovered = [
        {
          line,
          start: source.search(/\S/),
          end: source.slice(0, match.index).trimEnd().length,
          kind: 'value' as const,
          name,
          value: prefix,
        },
        {
          line,
          start: match.index,
          end: match.index + name.length,
          kind: 'parameter' as const,
          name,
        },
      ];
      parsed.tokens.push(...recovered);
      tokensByLine.set(line, recovered);
      break;
    }
  }
  const fileLists = fileListRanges(text, parsed);
  for (const list of fileLists)
    for (let line = Math.max(list.first, list.header + 1); line <= list.end; line++) {
      if (tokensByLine.has(line)) continue;
      const scan = lex(lines[line]);
      if (!scan.items.length) continue;
      const start = scan.items[0].start,
        end = lines[line].slice(0, scan.commentStart).trimEnd().length;
      const tokens = [
        {
          line,
          start,
          end,
          kind: 'value' as const,
          name: list.name,
          value: lines[line].slice(start, end),
        },
      ];
      parsed.tokens.push(...tokens);
      tokensByLine.set(line, tokens);
    }
  parsed.tokens.sort((a, b) => a.line - b.line || a.start - b.start);
  return { text, lines, parsed, tables, tokensByLine, tableByLine, fileLists };
}
function trimSnapshots() {
  while (snapshots.size > 8 || retained > MAX_TEXT || estimatedBytes > MAX_ESTIMATED_BYTES) {
    const key = snapshots.keys().next().value!;
    retained -= key.length;
    estimatedBytes -= weights.get(key) || 0;
    snapshots.delete(key);
    weights.delete(key);
  }
}
function createSnapshot(text: string) {
  builds++;
  const lines = text.split(/\r?\n/);
  let built: ReturnType<typeof buildDetails> | undefined;
  const details = () => {
    if (!built) {
      built = timed('snapshot.build', () => buildDetails(text, lines));
      if (snapshots.get(text) === snapshot) {
        const cells = built.tables.reduce(
          (total, table) => total + table.rows.reduce((sum, row) => sum + row.cells.length, 0),
          0,
        );
        const weight =
          (weights.get(text) || 0) +
          built.parsed.tokens.length * 160 +
          cells * 128 +
          (built.tokensByLine.size + built.tableByLine.size) * 64;
        estimatedBytes += weight - (weights.get(text) || 0);
        weights.set(text, weight);
        trimSnapshots();
      }
    }
    return built;
  };
  const snapshot = {
    text,
    lines,
    get parsed() {
      return details().parsed;
    },
    get tables() {
      return details().tables;
    },
    get tokensByLine() {
      return details().tokensByLine;
    },
    get tableByLine() {
      return details().tableByLine;
    },
    get fileLists() {
      return details().fileLists;
    },
  };
  return snapshot;
}
export function textSnapshot(text: string) {
  const previous = snapshots.get(text);
  if (previous) {
    textHits++;
    snapshots.delete(text);
    snapshots.set(text, previous);
    rememberSnapshot(previous);
    return previous;
  }
  for (const reference of recentSnapshots) {
    const previous = reference.deref();
    if (previous?.text === text) {
      textHits++;
      weakHits++;
      rememberSnapshot(previous);
      return previous;
    }
  }
  const snapshot = timed('snapshot.text', () => createSnapshot(text));
  rememberSnapshot(snapshot);
  if (text.length <= MAX_TEXT) {
    snapshots.set(text, snapshot);
    retained += text.length;
    const weight = text.length * 2 + snapshot.lines.length * 64;
    weights.set(text, weight);
    estimatedBytes += weight;
    trimSnapshots();
  }
  return snapshot;
}
export function documentSnapshot(document: { version: number; getText(): string }) {
  const previous = documents.get(document);
  if (previous?.version === document.version) {
    documentHits++;
    rememberSnapshot(previous.snapshot);
    return previous.snapshot;
  }
  const snapshot = textSnapshot(document.getText());
  documents.set(document, { version: document.version, snapshot });
  return snapshot;
}
export const parseForEditor = (text: string) => textSnapshot(text).parsed;
export const tablesForEditor = (text: string) => textSnapshot(text).tables;
export const snapshotMetrics = () => ({
  builds,
  detailBuilds,
  retained,
  estimatedBytes,
  maxEstimatedBytes: MAX_ESTIMATED_BYTES,
  entries: snapshots.size,
  textHits,
  documentHits,
  weakHits,
  weakEntries: recentSnapshots.length,
});
