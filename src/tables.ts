import { t } from './i18n';
import { rowFieldIssues } from './table-rules';
import { expandedFields } from './table-layout';
import { lex } from './parser';
import { findEntry } from './catalog';
import { tableCells } from './table-cells';
const isNumber = (s) => /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][-+]?\d+)?$/.test(s);
function readTables(text, recoverEmpty = false) {
  const result = [];
  let table = null;
  let section = '';
  let pendingCount;
  const lines = text.split(/\r?\n/);
  for (let line = 0; line < lines.length; line++) {
    const source = lines[line];
    const trim = source.trim();
    const { items, commentStart } = lex(source);
    if (/^[-=]{3}|^![-=]{3}/.test(trim)) {
      section = trim.replace(/^!?[-=\s]+|[-=\s]+$/g, '');
      table = null;
      pendingCount = undefined;
      continue;
    }
    if (!items.length || /^END\b/i.test(trim)) {
      if (recoverEmpty && table && !items.length && source.slice(0, commentStart).includes(','))
        table.rows.push({ line, cells: tableCells(source) });
      if (/^END\b/i.test(trim)) {
        table = null;
      }
      continue;
    }
    if (
      items.length >= 2 &&
      isNumber(items[0].text) &&
      /^N(?:Joints|Members|PropSetsCyl|PropSetsRec|CoefDpthCyl|CoefDpthRec|CoefMembersCyl|CoefMembersRec|AxCoef|BlInpSt|TwrInpSt)$/.test(
        items[1].text,
      )
    ) {
      pendingCount = { name: items[1].text, value: Number(items[0].text), line };
    }
    const headerEnd = source.search(/\[|!/);
    const header = items.filter((x) => headerEnd < 0 || x.start < headerEnd);
    if (header.length >= 2 && header.every((x) => !!findEntry(x.text, 'OpenFAST', 'header'))) {
      table = {
        section,
        line,
        headers: header.map((x) => x.text),
        headerTokens: header,
        units: [],
        rows: [],
        count: pendingCount,
      };
      pendingCount = undefined;
      result.push(table);
      continue;
    }
    if (!table) {
      continue;
    }
    if (trim.startsWith('(')) {
      table.units = items.map((x) => x.text);
      continue;
    }
    if (
      items.some((x) => x.text === '-' || x.text === '–') &&
      items.length === 2 &&
      items[0].text === table.headers[0]
    ) {
      continue;
    }
    // Scalar control records end the table, but a '-' output flag in a row does not.
    if (items.length > 2 && items[2].text === '-' && findEntry(items[1].text, 'OpenFAST')) {
      table = null;
      continue;
    }
    table.rows.push({ line, cells: recoverEmpty ? tableCells(source) : items });
  }
  return result;
}
function tableIssues(tables, module) {
  const issues = [];
  const add = (row, code, message, cell = undefined) =>
    issues.push({
      line: row.line,
      start: cell?.start || 0,
      end: cell?.end || 1,
      severity: 'error',
      code,
      message,
    });
  const idSets = new Map();
  for (const table of tables) {
    if (table.count && table.count.value !== table.rows.length) {
      add(
        table.count,
        'table-count',
        t('diagnostic.tableRowCount', table.count.name, table.count.value, table.rows.length),
      );
    }
    const ids = new Set();
    const idIndex = table.headers.findIndex((x) =>
      /^(?:ID|Line|JointID|MemberID|PropSetID|MPropSetID|AxCoefID|DpthID)$/i.test(x),
    );
    for (const row of table.rows) {
      issues.push(
        ...rowFieldIssues(table, row, module).map((issue) => ({
          ...issue,
          severity: issue.severity === 'information' ? 'information' : 'error',
        })),
      );
      if (idIndex >= 0 && row.cells[idIndex]) {
        const id = row.cells[idIndex].text;
        if (ids.has(id)) {
          add(
            row,
            'table-id',
            t('diagnostic.duplicateTableId', table.headers[idIndex], id),
            row.cells[idIndex],
          );
        }
        ids.add(id);
      }
    }
    if (idIndex >= 0) {
      const key = table.headers[idIndex];
      if (!idSets.has(key)) {
        idSets.set(key, new Set());
      }
      for (const id of ids) {
        idSets.get(key).add(id);
      }
    }
  }
  for (const table of tables) {
    for (const row of table.rows) {
      const fields = expandedFields(table.headers, row.cells, table.units);
      for (let index = 0; index < fields.length; index++) {
        const field = fields[index].name;
        const cell = row.cells[index];
        if (!cell) {
          continue;
        }
        let target;
        if (module === 'MoorDyn' && /^Attach[AB]$/.test(field)) {
          target = 'ID';
        }
        if (/^MJointID[12]$/.test(field)) {
          target = 'JointID';
        }
        if (field === 'JointAxID') {
          target = 'AxCoefID';
        }
        if (/^MPropSetID[12]$/.test(field)) {
          const geometry = row.cells[table.headers.indexOf('MSecGeom')]?.text;
          target = geometry === '2' ? 'MPropSetID' : 'PropSetID';
        }
        if (
          target &&
          idSets.has(target) &&
          !idSets.get(target).has(cell.text) &&
          cell.text !== '0'
        ) {
          add(
            row,
            'table-reference',
            t('diagnostic.missingTableReference', field, cell.text, target),
            cell,
          );
        }
        if (module === 'MoorDyn' && field === 'LineType') {
          const types = tables.find((t) => t.headers[0] === 'Name');
          if (types && !types.rows.some((r) => r.cells[0]?.text === cell.text)) {
            add(row, 'table-reference', t('diagnostic.undefinedLineType', cell.text), cell);
          }
        }
      }
    }
  }
  return issues;
}
export { readTables, tableIssues, isNumber };
