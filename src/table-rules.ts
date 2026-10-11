import { t } from './i18n';
import { expandedFields, fieldType } from './table-layout';
export function tableEnums(module: string, field: string) {
  const source = 'https://openfast.readthedocs.io/en/main/source/user/hydrodyn/input_files.html';
  if (module === 'HydroDyn' && field === 'PropPot')
    return [
      { value: 'True', label: t('editor.propPotTrue'), source },
      { value: 'False', label: t('editor.propPotFalse'), source },
    ];
  if (module === 'HydroDyn' && field === 'MSecGeom')
    return [
      { value: '1', label: t('editor.circular'), source },
      { value: '2', label: t('editor.rectangular'), source },
    ];
  if (module === 'MoorDyn' && field === 'Attachment')
    return ['Fixed', 'Coupled', 'Free', 'Vessel'].map((value) => ({
      value,
      label: t(('editor.attachment.' + value.toLowerCase()) as any),
      source: 'https://moordyn.readthedocs.io/en/latest/structure.html',
    }));
  return [];
}

export function tableValueChoices(module: string, field: string) {
  const choices = tableEnums(module, field);
  const source = 'https://openfast.readthedocs.io/en/v4.0.5/source/user/hydrodyn/input_files.html';
  if (module === 'HydroDyn' && field === 'FillDens')
    choices.push({ value: 'DEFAULT', label: t('editor.fillDefault'), source });
  if (module === 'HydroDyn' && /^(?:SimplCp(?:MG)?|DpthCp(?:MG)?|MemberCp(?:MG)?[12])$/.test(field))
    choices.push({ value: 'MCF', label: t('editor.mcfValue'), source });
  return choices;
}
const numeric = (v: string) =>
  /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][-+]?\d+)?$/.test(v) &&
  Number.isFinite(Number(v.replace(/[dD]/, 'e')));
export function rowFieldIssues(table, row, module: string) {
  const result = [];
  const add = (cell, code, message, severity = 'warning') =>
    result.push({
      line: row.line,
      start: cell?.start ?? 0,
      end: cell?.end ?? 1,
      code,
      message,
      severity,
    });
  const fields = expandedFields(table.headers, row.cells, table.units);
  const variable = table.headers.includes('FillMList') || table.headers.includes('NodeLocs');
  const unknown =
    variable &&
    fields.length < table.headers.length &&
    !fields.some((f) => f.element) &&
    !/^\d+$/.test(
      row.cells[table.headers.indexOf(table.headers.includes('FillMList') ? 'FillNumM' : 'NOutLoc')]
        ?.text || '',
    );
  // Over-limit counts also leave the list unmapped.
  const countIndex = table.headers.indexOf(
    table.headers.includes('FillMList') ? 'FillNumM' : 'NOutLoc',
  );
  const uncertain = unknown || (variable && Number(row.cells[countIndex]?.text) > 10000);
  if (!uncertain && row.cells.length !== fields.length)
    add(
      row.cells[Math.min(row.cells.length, fields.length)] || row.cells.at(-1),
      'table-columns',
      t('diagnostic.tableColumnCount', fields.length, row.cells.length),
    );
  row.cells.forEach((cell, i) => {
    const field = fields[i];
    if (!field) {
      if (!uncertain) add(cell, 'table-extra-cell', t('editor.tableExtra', fields.length, i + 1));
      return;
    }
    const value = cell.text,
      enums = tableEnums(module, field.name),
      choices = tableValueChoices(module, field.name);
    const special = choices.some(
      (c) => /^(?:DEFAULT|MCF)$/.test(c.value) && c.value.toLowerCase() === value.toLowerCase(),
    );
    if (special) return;
    if (enums.length) {
      const accepted =
        enums.some((e) => e.value.toLowerCase() === value.toLowerCase()) ||
        (module === 'MoorDyn' &&
          field.name === 'Attachment' &&
          /^(?:Body|Coupled|Vessel)\d+$/i.test(value)) ||
        (module === 'HydroDyn' &&
          field.name === 'PropPot' &&
          /^(?:t|f|\.true\.|\.false\.)$/i.test(value));
      if (!accepted)
        add(
          cell,
          'table-field-enum',
          t('editor.tableEnum', field.name, enums.map((e) => e.value).join('/')),
        );
      return;
    }
    const type = fieldType(field.name),
      integer = type === 'integer' || (type === 'reference' && field.name !== 'LineType');
    const known =
      field.unit ||
      /^(?:X|Y|Z|M|V|CdA|CA|Diam|MassDen|EA|EI|Cd|Ca|CdAx|CaAx|UnstrLen|FillFSLoc|FillDens|NodeLocs)$/.test(
        field.name,
      );
    if (
      (integer && (!numeric(value) || !Number.isSafeInteger(Number(value.replace(/[dD]/, 'e'))))) ||
      (type === 'number' && known && !numeric(value))
    )
      add(
        cell,
        'table-field-type',
        t(
          'editor.tableType',
          field.name,
          t(integer ? 'editor.type.integer' : 'editor.type.number'),
        ),
      );
  });
  if (module === 'HydroDyn') {
    const seen = new Set();
    row.cells.forEach((cell, i) => {
      if (fields[i]?.name !== 'FillMList' || !/^\d+$/.test(cell.text)) return;
      if (seen.has(cell.text))
        add(cell, 'table-list-repeat', t('editor.memberRepeated', cell.text), 'information');
      seen.add(cell.text);
    });
  }
  return result;
}
