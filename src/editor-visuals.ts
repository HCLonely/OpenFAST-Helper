import { textSnapshot } from './editor-snapshot';
import { symbolRelations } from './editor-intelligence';
import { definitionField } from './editor-rename';

export function numericParts(value: string, start = 0) {
  const match = /^([-+]?)(\d+(?:\.\d*)?|\.\d+)([eEdD][-+]?\d+)?$/.exec(value);
  if (!match) return [];
  let offset = start;
  return [match[1], match[2], match[3]].flatMap((part, i) => {
    if (!part) return [];
    const result = {
      start: offset,
      end: offset + part.length,
      type: ['openfastNumericSign', 'number', 'openfastNumericExponent'][i],
    };
    offset += part.length;
    return [result];
  });
}
export function symbolRoles(text: string) {
  const snapshot = textSnapshot(text),
    relations = symbolRelations(text),
    result = [];
  for (const table of snapshot.tables) {
    if (!definitionField(table, snapshot.parsed.module)) continue;
    for (const row of table.rows)
      if (row.cells[0])
        result.push({ ...row.cells[0], line: row.line, type: 'openfastDefinition' });
  }
  for (const group of relations.groups)
    for (const cell of group)
      if (!cell.definition) result.push({ ...cell, type: 'openfastReference' });
  result.push(...relations.missing.map((cell) => ({ ...cell, type: 'openfastUnresolved' })));
  return result;
}
