import { textSnapshot } from './editor-snapshot';
import { expandedFields, fieldType } from './table-layout';
import { rowFieldIssues } from './table-rules';
import { shiftedTableIssues } from './editor-fields';

export function selectedMembers(text: string, line: number, column: number) {
  const snapshot = textSnapshot(text),
    table = snapshot.tableByLine.get(line),
    row = table?.rows.find((r) => r.line === line);
  if (snapshot.parsed.module !== 'HydroDyn' || !row || !table.headers.includes('FillMList'))
    return new Set<string>();
  const fields = expandedFields(table.headers, row.cells);
  return new Set(
    row.cells.filter((_, i) => i !== column && fields[i]?.name === 'FillMList').map((c) => c.text),
  );
}
export function tableFeedback(text: string, activeLines = new Set<number>()) {
  const snapshot = textSnapshot(text);
  return [
    ...snapshot.tables.flatMap((table) =>
      table.rows
        .filter((row) => !activeLines.has(row.line))
        .flatMap((row) => rowFieldIssues(table, row, snapshot.parsed.module)),
    ),
    ...shiftedTableIssues(text, activeLines),
  ];
}
