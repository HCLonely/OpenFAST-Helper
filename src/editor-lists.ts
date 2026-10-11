import { lex, parseDocument } from './parser';
import { findEntry } from './catalog';
import { t } from './i18n';
import type { DiagnosticIssue } from './types';
export const fileListRules = {
  AFNames: { module: 'AeroDyn', count: 'NumAFfiles' },
  BStCfiles: { module: 'ServoDyn', count: 'NumBStC' },
  TStCfiles: { module: 'ServoDyn', count: 'NumTStC' },
  NStCfiles: { module: 'ServoDyn', count: 'NumNStC' },
  SStCfiles: { module: 'ServoDyn', count: 'NumSStC' },
};
export function fileListRanges(
  text: string,
  parsed = parseDocument(text),
  lines = text.split(/\r?\n/),
) {
  const records = new Set(parsed.records.map((r) => r.line)),
    result = [];
  for (const [name, rule] of Object.entries(fileListRules)) {
    if (parsed.module !== rule.module) continue;
    const source = parsed.parameters.get(rule.count)?.value || '';
    if (!/^\d+$/.test(source) || Number(source) < 1 || Number(source) > 10000) continue;
    const header = lines.findIndex((source) =>
      lex(source).items.some((item, index) => index <= 1 && item.text === name),
    );
    if (header < 0) continue;
    const index = lex(lines[header]).items.findIndex((item) => item.text === name),
      first = header + (index === 0 ? 1 : 0),
      count = Number(source);
    let end = Math.min(lines.length - 1, first + count - 1);
    for (let i = header + 1; i <= end; i++)
      if (records.has(i) || /^\s*(?:!|[-=]{3}|["']?END\b|OutList\b)/i.test(lines[i])) {
        end = i - 1;
        break;
      }
    result.push({ name, module: parsed.module, header, first, end, count });
  }
  return result;
}

/** Share editor boundaries, but only complete quoted physical records are strict references. */
export function strictFileLists(
  text: string,
  parsed = parseDocument(text),
  lines = text.split(/\r?\n/),
) {
  const entries: {
    name: string;
    value: string;
    line: number;
    start: number;
    end: number;
    index: number;
    count: number;
  }[] = [];
  const issues: DiagnosticIssue[] = [];
  const ranges = fileListRanges(text, parsed, lines);
  for (const [name, rule] of Object.entries(fileListRules)) {
    if (parsed.module !== rule.module) continue;
    const countRecord = parsed.parameters.get(rule.count);
    const header = lines.findIndex((source) =>
      lex(source).items.some((item, index) => index <= 1 && item.text === name),
    );
    if (!countRecord && header < 0) continue;
    const source = countRecord?.value || '';
    const count = /^\d+$/.test(source) ? Number(source) : NaN;
    const add = (line: number, reason: string) =>
      issues.push({
        line,
        start: 0,
        end: Math.max(1, lines[line]?.length || 0),
        code: 'file-list',
        severity: 'error',
        message: t('references.invalidList', name, reason),
      });
    if (!Number.isSafeInteger(count) || count < 0) {
      add(countRecord?.line ?? Math.max(0, header), t('references.listCount', rule.count));
      continue;
    }
    if (count > 10000) {
      issues.push({
        line: countRecord.line,
        start: 0,
        end: Math.max(1, lines[countRecord.line]?.length || 0),
        code: 'file-list-limit',
        severity: 'error',
        message: t('references.listLimit', name),
      });
      continue;
    }
    if (!count) continue;
    const range = ranges.find((r) => r.name === name);
    if (!range) {
      add(countRecord.line, t('references.listMissing', count));
      continue;
    }
    for (let index = 0; index < count; index++) {
      const line = range.first + index;
      if (line > range.end) {
        add(Math.min(lines.length - 1, line), t('references.listMissing', count));
        break;
      }
      const scan = lex(lines[line]);
      const label =
        line === range.header ? scan.items.find((item) => item.text === name) : undefined;
      const value = lines[line].slice(0, label?.start ?? scan.commentStart).trim();
      if (!/^(?:"[^"\r\n]+"|'[^'\r\n]+')$/.test(value)) {
        add(line, t('references.listQuoted'));
        continue;
      }
      const start = lines[line].search(/\S/);
      entries.push({ name, value, line, start, end: start + value.length, index, count });
    }
  }
  return { entries, issues };
}
export function fileListContext(
  text: string,
  line: number,
  character: number,
  parsed = parseDocument(text),
  ranges = fileListRanges(text, parsed),
) {
  const lines = text.split(/\r?\n/);
  for (const range of ranges) {
    const { name, header, first, end, count } = range;
    if (line < first || line > end) continue;
    if (line === header) return { name, index: 1, count, header };
    const scan = lex(lines[line] || ''),
      incomplete = /^[\s]*(["'])/.exec(lines[line] || '');
    const unfinished = incomplete && lines[line].split(incomplete[1]).length === 2;
    if (
      (scan.items.length > 1 && !unfinished) ||
      character > scan.commentStart ||
      scan.items.some((i) => findEntry(i.text, parsed.module))
    )
      continue;
    const item = unfinished
      ? {
          text: lines[line].slice(lines[line].search(/\S/), scan.commentStart).trimEnd(),
          start: lines[line].search(/\S/),
          end: lines[line].slice(0, scan.commentStart).trimEnd().length,
        }
      : scan.items[0];
    if (item && character < item.start) continue;
    return {
      name,
      index: line - first + 1,
      count,
      header,
      module: parsed.module,
      value: item?.text || '',
      original: '',
      line,
      start: item?.start ?? character,
      end: item?.end ?? character,
      needsSeparator: false,
      applicability: '',
    };
  }
  return null;
}
