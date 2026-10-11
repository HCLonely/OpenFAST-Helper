export function expandedFields(
  headers: string[],
  cells: { text: string }[] = [],
  units: string[] = [],
) {
  const list = headers.includes('FillMList')
      ? headers.indexOf('FillMList')
      : headers.indexOf('NodeLocs'),
    countIndex = headers.indexOf(headers.includes('FillMList') ? 'FillNumM' : 'NOutLoc');
  const basic = headers.map((name, index) => ({
    name,
    index,
    unit: units[index] || '',
    element: 0,
    count: 0,
  }));
  if (list < 0 || countIndex < 0) return basic;
  const source = cells[countIndex]?.text || '';
  if (!/^\d+$/.test(source) || Number(source) > 10000) return basic.slice(0, list);
  const count = Number(source);
  return [
    ...basic.slice(0, list),
    ...Array.from({ length: count }, (_, i) => ({ ...basic[list], element: i + 1, count })),
    ...basic.slice(list + 1),
  ];
}
export function fieldType(name: string) {
  if (/^(?:Attach[AB]|LineType|MJointID[12]|MPropSetID[12]|JointAxID|FillMList)$/.test(name))
    return 'reference';
  if (/^(?:ID|Line|.*ID\d*|FillNumM|NOutLoc|NumSegs)$/.test(name)) return 'integer';
  if (['Attachment', 'PropPot', 'MSecGeom'].includes(name)) return 'enum';
  if (['Name', 'Outputs'].includes(name)) return 'text';
  return 'number';
}

export function tableFields(table, cells = [], header = false) {
  return header
    ? table.headers.map((name, index) => ({
        name,
        index,
        unit: table.units[index] || '',
        element: 0,
        count: 0,
      }))
    : expandedFields(table.headers, cells, table.units);
}
