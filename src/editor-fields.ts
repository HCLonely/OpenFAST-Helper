import { textSnapshot } from './editor-snapshot';
import { tableColumn, tableReferenceChoices, parameterNameContext } from './editor-context';
import { fieldType, expandedFields } from './table-layout';
import { rowFieldIssues, tableValueChoices } from './table-rules';
import { editDistance } from './editor-rules';
import { lex } from './parser';
import { t } from './i18n';

export function fieldGroup(
  name: string,
): 'identity' | 'reference' | 'geometry' | 'coefficient' | undefined {
  if (fieldType(name) === 'reference') return 'reference';
  if (/^(?:ID|Line|Name|JointID|MemberID|PropSetID|MPropSetID|AxCoefID|DpthID)$/.test(name))
    return 'identity';
  if (/^(?:X|Y|Z|Joint[xyz]i|Diam|Prop(?:D|A|B|Thck)|UnstrLen|BlSpn|TwrElev|TwrDiam)$/.test(name))
    return 'geometry';
  if (/^(?:Cd|Ca|CdAx|CaAx|CdA|CA|(?:Simpl|Dpth|Member)(?:Cd|Ca|Cp|AxCa|AxCd).*)$/.test(name))
    return 'coefficient';
}

export function fieldFeedback(text: string, line: number, character: number) {
  const snapshot = textSnapshot(text);
  const where = tableColumn(text, line, character);
  if (!where?.cell || line === where.table.line) return;
  const row = where.table.rows.find((r) => r.line === line);
  if (!row) return;
  const choices = tableValueChoices(snapshot.parsed.module, where.field);
  const reference = tableReferenceChoices(text, line, character);
  const issues = rowFieldIssues(where.table, row, snapshot.parsed.module).filter(
    (i) => i.start === where.cell.start && i.end === where.cell.end,
  );
  const repairs =
    where.cell.text.length <= 128 && issues.some((i) => i.code === 'table-field-enum')
      ? choices
          .filter((c) => editDistance(c.value, where.cell.text) <= 1)
          .map((c) => ({
            line,
            start: where.cell.start,
            end: where.cell.end,
            replacement: c.value,
          }))
      : [];
  const definitions =
    reference?.choices.find((c) => c.value === where.cell.text)?.definitions || [];
  return {
    ...where,
    value: where.cell.text,
    type: fieldType(where.field),
    choices,
    issues,
    repairs,
    definitions,
    referenceKnown: reference?.resolved,
    referenceCount: reference?.choices.length || 0,
  };
}

export function spellingRepairs(text: string, line: number, character: number) {
  const feedback = fieldFeedback(text, line, character);
  if (feedback) return feedback.repairs;
  const name = parameterNameContext(text, line, character);
  return (name?.candidates || [])
    .filter((c) => c.rank <= 1 && c.name !== name.text)
    .slice(0, 3)
    .map((c) => ({ line, start: name.start, end: name.end, replacement: c.name }));
}

/** Infer only missing-one-cell alignments that remove observed type/enum conflicts. */
export function shiftedRow(table, row, module: string) {
  if (
    table.headers.includes('FillMList') ||
    table.headers.includes('NodeLocs') ||
    table.headers.length > 64 ||
    row.cells.length !== table.headers.length - 1
  )
    return;
  const conflicts = (r) =>
    rowFieldIssues(table, r, module).filter(
      (i) => ['table-field-type', 'table-field-enum'].includes(i.code) && i.start !== -1,
    ).length;
  const before = conflicts(row);
  if (!before) return;
  const candidates = table.headers.flatMap((name, index) => {
    const value =
      tableValueChoices(module, name)[0]?.value ||
      (['number', 'integer', 'reference'].includes(fieldType(name)) && name !== 'LineType'
        ? '0'
        : '_missing_');
    const cells = [...row.cells];
    cells.splice(index, 0, { text: value, start: -1, end: -1 });
    return conflicts({ ...row, cells }) === 0 ? [name] : [];
  });
  return candidates.length ? { candidates, conflicts: before } : undefined;
}

export function shiftedTableIssues(text: string, activeLines = new Set<number>()) {
  const snapshot = textSnapshot(text);
  return snapshot.tables.flatMap((table) =>
    table.rows.flatMap((row) => {
      if (activeLines.has(row.line)) return [];
      const evidence = shiftedRow(table, row, snapshot.parsed.module);
      return evidence
        ? [
            {
              line: row.line,
              start: row.cells[0]?.start || 0,
              end: row.cells.at(-1)?.end || 1,
              code: 'table-suspected-shift',
              severity: 'information' as const,
              message: t(
                'editor.suspectedShift',
                evidence.candidates.join('/'),
                evidence.conflicts,
              ),
            },
          ]
        : [];
    }),
  );
}

export function nextIncompleteField(text: string, line: number, character: number) {
  const snapshot = textSnapshot(text);
  const targets = snapshot.tables
    .flatMap((table) =>
      table.rows.flatMap((row) => {
        const fields = expandedFields(table.headers, row.cells, table.units);
        // An unknown variable count maps only the verified prefix, never the following cells.
        return fields.flatMap((field, index) => {
          const cell = row.cells[index];
          if (cell?.text && cell.text !== field.name) return [];
          const end = snapshot.lines[row.line]
            .slice(0, lex(snapshot.lines[row.line]).commentStart)
            .trimEnd().length;
          return [
            { line: row.line, start: cell?.start ?? end, end: cell?.end ?? end, field: field.name },
          ];
        });
      }),
    )
    .sort((a, b) => a.line - b.line || a.start - b.start);
  return (
    targets.find(
      (c) => c.line > line || (c.line === line && (c.start > character || c.end > character)),
    ) || targets[0]
  );
}
