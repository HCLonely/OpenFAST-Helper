import { findEntry } from './catalog';
import { detectModule, lex } from './parser';
import { outputBlockAt } from './output-blocks';
import { t } from './i18n';
export type Supplement = {
  name: string;
  module: string;
  kind: 'parameter' | 'output';
  description: string;
  unit?: string;
  versions?: string[];
  valueType?: 'number' | 'integer' | 'boolean' | 'string';
  options?: string[];
  specialValues?: string[];
};
function matchesType(value: string, type?: string) {
  if (!type || type === 'string') return true;
  if (type === 'boolean') return /^(?:true|false|t|f|\.true\.|\.false\.)$/i.test(value);
  if (type === 'integer') return /^[+-]?\d+$/.test(value) && Number.isSafeInteger(Number(value));
  return (
    /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][+-]?\d+)?$/.test(value) &&
    Number.isFinite(Number(value.replace(/[dD]/, 'e')))
  );
}
export function dictionaryEntries(raw: unknown, module: string, profile?): Supplement[] {
  if (!Array.isArray(raw)) return [];
  const found = new Map<string, Supplement>();
  for (const entry of raw.slice(0, 500)) {
    if (
      !entry ||
      entry.module !== module ||
      !['parameter', 'output'].includes(entry.kind) ||
      typeof entry.name !== 'string' ||
      !/^[A-Za-z]\w*(?:\(\d+\))?$/.test(entry.name) ||
      typeof entry.description !== 'string' ||
      entry.description.length > 4000
    )
      continue;
    if (
      entry.versions !== undefined &&
      (!Array.isArray(entry.versions) ||
        entry.versions.some((v) => typeof v !== 'string' || v.length > 20))
    )
      continue;
    if (profile?.known && entry.versions?.length && !entry.versions.includes(profile.version))
      continue;
    if (findEntry(entry.name, module, entry.kind)) continue;
    if (
      entry.valueType !== undefined &&
      !['number', 'integer', 'boolean', 'string'].includes(entry.valueType)
    )
      continue;
    if (
      ['options', 'specialValues'].some(
        (key) =>
          entry[key] !== undefined &&
          (!Array.isArray(entry[key]) ||
            entry[key].length > (key === 'options' ? 50 : 20) ||
            entry[key].some(
              (value) =>
                typeof value !== 'string' ||
                value.length > 80 ||
                !/^[A-Za-z0-9_+./-]+$/.test(value),
            )),
      )
    )
      continue;
    if (entry.options?.some((value) => !matchesType(value, entry.valueType))) continue;
    if (entry.kind === 'output' && (entry.valueType || entry.options || entry.specialValues))
      continue;
    const key = entry.kind + ':' + entry.name.toLowerCase();
    if (!found.has(key))
      found.set(key, {
        name: entry.name,
        module,
        kind: entry.kind,
        description: entry.description,
        unit: typeof entry.unit === 'string' ? entry.unit.slice(0, 80) : '',
        versions: entry.versions,
        valueType: entry.valueType,
        options: entry.options,
        specialValues: entry.specialValues,
      });
  }
  return [...found.values()];
}
/** Only explicit scalar labels qualify; never infer custom table columns or output channels. */
export function customScalarContext(
  text: string,
  line: number,
  character: number,
  entries: Supplement[],
) {
  const source = text.split(/\r?\n/)[line] || '',
    parsed = lex(source);
  if (character > parsed.commentStart) return null;
  const items = parsed.items;
  const nameIndex = items.findIndex(
    (cell, i) =>
      i <= 1 &&
      entries.some(
        (e) =>
          e.kind === 'parameter' &&
          e.module === detectModule(text) &&
          e.name.toLowerCase() === cell.text.toLowerCase(),
      ),
  );
  if (nameIndex < 0 || (items[nameIndex + 1] && !/^[-–]$/.test(items[nameIndex + 1].text)))
    return null;
  if (outputBlockAt(text, line)) return null;
  const entry = entries.find(
    (e) => e.kind === 'parameter' && e.name.toLowerCase() === items[nameIndex].text.toLowerCase(),
  );
  const cell = nameIndex === 1 ? items[0] : undefined;
  const start = cell?.start ?? items[nameIndex].start,
    end = cell?.end ?? start;
  if (character < start || character > end) return null;
  const values = entry.options?.length
    ? entry.options
    : entry.valueType === 'boolean'
      ? ['True', 'False']
      : [];
  const options = [...new Set([...values, ...(entry.specialValues || [])])].map((value) => ({
    value,
  }));
  return { entry, start, end, value: cell?.text || '', options, needsSeparator: !cell };
}
export function customValueIssues(
  text: string,
  entries: Supplement[],
  activeLines = new Set<number>(),
) {
  const issues = [];
  if (!entries.some((e) => e.kind === 'parameter' && (e.valueType || e.options?.length)))
    return issues;
  const names = new Set(
    entries.filter((e) => e.kind === 'parameter').map((e) => e.name.toLowerCase()),
  );
  for (const [line, source] of text.split(/\r?\n/).entries()) {
    if (activeLines.has(line)) continue;
    const items = lex(source).items;
    if (!items.slice(0, 2).some((c) => names.has(c.text.toLowerCase()))) continue;
    const first = items[0];
    if (!first) continue;
    const where = customScalarContext(text, line, first.start, entries);
    if (!where || !where.value) continue;
    const { entry, value } = where;
    if (entry.specialValues?.some((v) => v.toLowerCase() === value.toLowerCase())) continue;
    if (
      !matchesType(value, entry.valueType) ||
      (entry.options?.length && !entry.options.some((v) => v.toLowerCase() === value.toLowerCase()))
    )
      issues.push({
        line,
        start: where.start,
        end: where.end,
        severity: 'warning',
        code: 'custom-value',
        message: t('editor.customInvalid', entry.name, value),
      });
  }
  return issues;
}
export function supplements(vscode, document, module, profile?) {
  return dictionaryEntries(
    vscode.workspace.getConfiguration('openfast', document.uri).get('dictionary', []),
    module,
    profile,
  );
}
