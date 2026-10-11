import { lex } from './parser';
import { tableFields } from './table-layout';

/** Editor-only comma holes. Quotes and comments keep their original UTF-16 spans. */
export function tableCells(source: string) {
  const scan = lex(source);
  const cells = [];
  let previousEnd = 0;
  for (const cell of [
    ...scan.items,
    { text: '', start: scan.commentStart, end: scan.commentStart },
  ]) {
    const commas = [...source.slice(previousEnd, cell.start).matchAll(/,/g)];
    const holes = previousEnd === 0 && cells.length === 0 ? commas : commas.slice(1);
    for (const comma of holes) {
      const position = previousEnd + comma.index;
      cells.push({ text: '', start: position, end: position });
    }
    if (cell.text) cells.push(cell);
    else if (commas.length) {
      const end = source.slice(0, scan.commentStart).trimEnd().length;
      cells.push({ text: '', start: end, end });
    }
    previousEnd = cell.end;
  }
  return cells;
}

/** Infer only the next separator. Existing cells and whitespace are never rewritten. */
export function tableContinuation(
  lines: string[],
  table,
  line: number,
  column: number,
  value: string,
  start: number,
  align = true,
) {
  const own = table.rows.find((r) => r.line === line);
  const expected = tableFields(table, own?.cells || [])[column];
  const neighbors = table.rows
    .filter((r) => {
      if (r.line === line || Math.abs(r.line - line) > 20) return false;
      const field = tableFields(table, r.cells)[column];
      return field?.name === expected?.name && field?.element === expected?.element;
    })
    .sort((a, b) => Math.abs(a.line - line) - Math.abs(b.line - line))
    .slice(0, 8);
  const sources = [...neighbors, ...(own ? [own] : [])];
  for (const row of sources) {
    const left = row.cells[column],
      right = row.cells[column + 1];
    if (!left || !right || !left.text || !right.text) continue;
    const gap = lines[row.line].slice(left.end, right.start);
    if (/^\s*,\s*$/.test(gap)) return gap;
    if (/^[ \t]+$/.test(gap)) {
      if (gap.includes('\t')) return '\t';
      // Align only when the next column is consistently positioned in nearby rows.
      const positions = neighbors
        .map((r) => r.cells[column + 1]?.start)
        .filter((p) => p !== undefined);
      if (align && positions.length >= 2 && positions.every((p) => p === right.start))
        return ' '.repeat(Math.max(1, Math.min(80, right.start - start - value.length)));
      return gap.slice(0, 80);
    }
  }
  // A partial row may still establish its delimiter through earlier columns.
  if (own)
    for (let i = 1; i < own.cells.length; i++) {
      const gap = lines[line].slice(own.cells[i - 1].end, own.cells[i].start);
      if (/^\s*,\s*$/.test(gap)) return gap;
      if (/^[ \t]+$/.test(gap)) return gap.includes('\t') ? '\t' : gap.slice(0, 80);
    }
  return '\t';
}
