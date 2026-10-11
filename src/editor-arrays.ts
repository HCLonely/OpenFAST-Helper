import rules from '../data/array-rules.json';
import { textSnapshot } from './editor-snapshot';
import { lex } from './parser';
import { number } from './analysis';
import { t } from './i18n';

export function countedArrayContext(text: string, line: number, character?: number, profile?) {
  const snapshot = textSnapshot(text);
  if (snapshot.tableByLine.has(line)) return;
  const source = snapshot.lines[line] || '';
  const scan = lex(source);
  const rule = rules.rules.find(
    (r) => r.module === snapshot.parsed.module && scan.items.some((c) => c.text === r.name),
  );
  const name =
    rule?.name ||
    (snapshot.parsed.module === 'OpenFAST' && scan.items.some((c) => c.text === 'LinTimes')
      ? 'LinTimes'
      : undefined);
  if (!name || (rule && profile?.known && !rule.versions.includes(profile.version))) return;
  const label = scan.items.find((c) => c.text === name);
  if (character !== undefined && (character > label.start || character > scan.commentStart)) return;
  const countKey = rule?.count || 'NLinTimes';
  const counts = snapshot.parsed.records.filter((r) => r.name === countKey);
  if (counts.length !== 1) return;
  const count = number(counts[0].value);
  if (!Number.isSafeInteger(count) || count < 0 || count > (rule?.maxCount || 1000)) return;
  // AeroDyn additionally accepts semicolons. Replace with same-width spaces only for scanning.
  const values = lex(source.slice(0, label.start).replace(/;/g, ' ')).items;
  const cursor = character ?? values[0]?.start ?? 0;
  const cell = values.find((c) => c.start <= cursor && cursor <= c.end);
  const index = cell ? values.indexOf(cell) : values.filter((c) => c.end < cursor).length;
  const nodeRecords = snapshot.parsed.records.filter(
    (r) => rule?.nodeCount && r.name === rule.nodeCount,
  );
  const nodes = nodeRecords.length === 1 ? number(nodeRecords[0].value) : NaN;
  return {
    name,
    count,
    actual: values.length,
    values,
    label,
    cell,
    index: index + 1,
    start: cell?.start ?? cursor,
    end: cell?.end ?? cursor,
    nodes: Number.isSafeInteger(nodes) && nodes > 0 && nodes <= 1000000 ? nodes : undefined,
    selected: new Set(values.filter((c) => c !== cell).map((c) => c.text)),
    source: rule?.source,
    versions: rule?.versions || [],
    placeholder: name === 'LinTimes' ? 'time' : 'node',
    needsSeparator: !cell && cursor === label.start,
  };
}
export function nodeChoices(where, prefix = '') {
  if (!where?.nodes || where.count === 0 || where.index > where.count) return [];
  // Match before capping, so a typed high node index remains reachable.
  const choices = [];
  if (prefix && !/^[1-9]\d*$/.test(prefix)) return choices;
  const first = prefix ? Number(prefix) : 1;
  for (let scale = 1; first * scale <= where.nodes && choices.length < 500; scale *= 10) {
    const start = prefix ? first * scale : 1;
    const end = prefix ? Math.min(where.nodes, (first + 1) * scale - 1) : where.nodes;
    for (let id = start; id <= end && choices.length < 500; id++)
      choices.push({ value: String(id), selected: where.selected.has(String(id)) });
    if (!prefix) break;
  }
  return choices;
}

/** Editing feedback only. Zero-count lines may contain an ignored dummy value. */
export function arrayFeedback(text: string, profile?, activeLines = new Set<number>()) {
  const snapshot = textSnapshot(text),
    issues = [];
  for (const record of snapshot.parsed.records) {
    if (
      !rules.rules.some(
        (rule) => rule.module === snapshot.parsed.module && rule.name === record.name,
      ) ||
      activeLines.has(record.line)
    )
      continue;
    const where = countedArrayContext(text, record.line, undefined, profile);
    if (!where || where.count === 0) continue;
    const add = (cell, code, message) =>
      issues.push({
        line: record.line,
        start: cell.start,
        end: Math.max(cell.start + 1, cell.end),
        code,
        message,
        severity: 'warning' as const,
      });
    if (where.actual !== where.count)
      add(
        where.values[where.count] || where.label,
        'array-elements',
        t('editor.arrayElements', where.name, where.count, where.actual),
      );
    for (const cell of where.values) {
      if (!/^[+-]?\d+$/.test(cell.text) || !Number.isSafeInteger(Number(cell.text)))
        add(cell, 'array-node-type', t('editor.arrayNodeInteger', where.name));
      else if (Number(cell.text) < 1 || (where.nodes && Number(cell.text) > where.nodes))
        add(cell, 'array-node-range', t('editor.arrayNodeRange', where.name, where.nodes || '?'));
    }
  }
  return issues;
}
