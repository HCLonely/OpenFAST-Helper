import { fileListContext } from './editor-lists';
import { countedArrayContext } from './editor-arrays';
import { expandedFields, tableFields } from './table-layout';
import { findEntry } from './catalog';
import { lex, applicability } from './parser';
import {
  textSnapshot,
  parseForEditor as parseDocument,
  tablesForEditor as readTables,
} from './editor-snapshot';
import { correctedNames } from './editor-rules';

import { outputChoices, number } from './analysis';
import type { ConfigToken } from './types';

export const SPECIAL_VALUE = /^(?:true|false|default|mcf|ranlux|none|unused|fixed|vessel|n\/a)$/i;
export function isPathParameter(name: string): boolean {
  return (
    !/^(?:Num|OutFile|DLL_ProcName)/i.test(name) &&
    /(?:File|AFNames|FilenameRoot|PotFile|BldFile|TwrFile)/i.test(name)
  );
}

export function tokenType(token: ConfigToken, source: string): string {
  if (token.kind === 'parameter') return token.name === 'OutList' ? 'keyword' : 'parameter';
  if (token.kind === 'header') return 'property';
  if (token.kind === 'output') return 'enumMember';
  if (token.kind === 'end') return 'keyword';
  // Scalar tokens carry the whole record value; classify the actual lexeme instead.
  const value = source.slice(token.start, token.end).replace(/^["']|["']$/g, '');
  if (SPECIAL_VALUE.test(value)) return 'keyword';
  if (
    /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][-+]?\d*)?$/.test(value) ||
    (token.kind === 'value' && !isPathParameter(token.name) && /^[-+.]$/.test(value))
  )
    return 'number';
  if (token.kind === 'value' && isPathParameter(token.name)) return 'openfastPath';
  return 'string';
}

/** A tolerant single-line edit context; never creates or reorders records. */
export function scalarContext(text: string, line: number, character: number) {
  const source = textSnapshot(text).lines[line] || '';
  if (/^\s*(?:[-=]{3}|!|END\b|OutList\b)/i.test(source)) return null;
  const parsed = parseDocument(text);
  if (parsed.tokens.some((token) => token.line === line && ['output', 'end'].includes(token.kind)))
    return null;
  const scan = lex(source);
  const quotedAtCursor = /^(?:[^"']|"[^"]*"|'[^']*')*["'][^"']*$/.test(source.slice(0, character));
  if (character > scan.commentStart && !quotedAtCursor) return null;
  if (readTables(text).some((t) => t.line === line || t.rows.some((r) => r.line === line)))
    return null;
  let label = scan.items.find(
    (item) =>
      findEntry(item.text, parsed.module) &&
      (source.slice(item.end).match(/^\s*(?:[-–]|$)/) ||
        parsed.parameters.get(item.text)?.line === line),
  );
  let commentLabel = false;
  if (parsed.module === 'ROSCO') {
    const match = /^\s*([A-Za-z]\w*(?:\(\d+\))?)\b/.exec(scan.comment);
    if (!match || !findEntry(match[1], parsed.module)) return null;
    const start = source.indexOf(match[1], scan.commentStart + 1);
    label = { text: match[1], start, end: start + match[1].length };
    commentLabel = true;
  }
  // An unfinished quoted path can swallow the label in lex(); recover only a known
  // path label immediately preceding the standard description separator.
  if (!label) {
    for (const match of source.matchAll(/\b([A-Za-z][\w]*(?:\(\d+\))?)\s+[-–]\s/g)) {
      if (isPathParameter(match[1]) && findEntry(match[1], parsed.module)) {
        label = { text: match[1], start: match.index, end: match.index + match[1].length };
      }
    }
  }
  if (!label || character > (commentLabel ? scan.commentStart : label.start)) return null;
  const limit = commentLabel ? scan.commentStart : label.start;
  const before = source.slice(0, limit);
  const start = before.search(/\S/);
  const end = before.trimEnd().length;
  if (start >= 0 && character < start) return null;
  const value = before.trim();
  return {
    module: parsed.module,
    name: label.text,
    value,
    original: source.slice(label.end).replace(/^\s*[-–]?\s*/, ''),
    line,
    start: start < 0 ? character : start,
    end: start < 0 ? character : end,
    needsSeparator: start < 0 && character === limit,
    applicability: applicability(parsed, label.text),
  };
}

export function pathContext(text: string, line: number, character: number) {
  let context = scalarContext(text, line, character);
  const list = fileListContext(
    text,
    line,
    character,
    parseDocument(text),
    textSnapshot(text).fileLists,
  );
  if (!context && list?.module) context = list as any;
  if (context && list)
    context = { ...context, listIndex: list.index, listCount: list.count } as any;
  if (!context || !isPathParameter(context.name)) return null;
  if (!/^["']/.test(context.value) && /\s/.test(context.value)) return null;
  const quote = /^["']/.exec(context.value)?.[0] || '"';
  const value = context.value.replace(/^["']|["']$/g, '');
  const offset = Math.max(0, character - context.start - (/^["']/.test(context.value) ? 1 : 0));
  const prefix = value.slice(0, offset);
  return {
    ...context,
    listIndex: list?.index,
    listCount: list?.count,
    quote,
    path: value,
    prefix,
    separator: /\\/.test(prefix) ? '\\' : '/',
  };
}

export function pathRank(parameter: string, filename: string): number {
  if (/DLL_(?:FileName|File)$/i.test(parameter))
    return /\.(?:dll|so|dylib)$/i.test(filename) ? 0 : 2;
  if (parameter === 'PotFile') return /\.(?:hst|1)$/i.test(filename) ? 0 : 2;
  if (/BTS/i.test(parameter)) return /\.bts$/i.test(filename) ? 0 : 2;
  if (/DLL_InFile/i.test(parameter)) return /DISCON|\.in$/i.test(filename) ? 0 : 1;
  const stems: Record<string, RegExp> = {
    EDFile: /elasto|elastodyn/i,
    HydroFile: /hydro/i,
    AeroFile: /aero/i,
    InflowFile: /inflow/i,
    ServoFile: /servo/i,
    MooringFile: /moor/i,
    SeaStFile: /sea/i,
    BldFile: /blade|bld/i,
    TwrFile: /tower|twr/i,
  };
  if (stems[parameter.replace(/\d+$/, '')]?.test(filename)) return 0;
  return /\.(?:dat|in|txt|fst|fstf)$/i.test(filename) ? 1 : 2;
}

export function sectionFolds(text: string) {
  const parsed = parseDocument(text);
  const lines = textSnapshot(text).lines;
  return parsed.sections
    .map((s, index) => {
      let end = (parsed.sections[index + 1]?.line ?? lines.length) - 1;
      const terminator = lines.findIndex(
        (line, i) => i > s.line && i <= end && /^\s*END\b/i.test(line),
      );
      if (terminator >= 0) end = terminator;
      while (end > s.line && !lines[end].trim()) end--;
      return { start: s.line, end };
    })
    .filter((fold) => fold.end > fold.start);
}

export function tableAt(text: string, line: number) {
  return textSnapshot(text).tableByLine.get(line);
}

export function tableColumn(text: string, line: number, character: number) {
  const table = tableAt(text, line);
  if (!table) return null;
  const scan = lex(textSnapshot(text).lines[line] || '');
  if (character > scan.commentStart) return null;
  const cells =
    line === table.line
      ? table.headerTokens
      : table.rows.find((row) => row.line === line)?.cells || scan.items;
  let column = cells.findIndex((c) => character >= c.start && character <= c.end);
  if (column < 0) column = cells.filter((c) => c.end < character).length;
  const fields = tableFields(table, cells, line === table.line);
  if (column >= fields.length) return null;
  return { table, column, cell: cells[column], field: fields[column].name, ...fields[column] };
}

export function tableReferenceChoices(text: string, line: number, character: number) {
  const where = tableColumn(text, line, character);
  if (!where || line === where.table.line) return null;
  const module = textSnapshot(text).parsed.module;
  const tables = textSnapshot(text).tables;
  let definitions = [];
  if (module === 'MoorDyn' && /^Attach[AB]$/.test(where.field)) {
    definitions = tables.filter(
      (t) => t.headers.includes('ID') && t.headers.includes('Attachment'),
    );
  } else if (module === 'MoorDyn' && where.field === 'LineType') {
    definitions = tables.filter((t) => t.headers[0] === 'Name' && t.headers.includes('Diam'));
  } else {
    let key =
      where.field === 'FillMList' ||
      (where.field === 'MemberID' && !where.table.headers.includes('MJointID1'))
        ? 'MemberID'
        : /^MJointID[12]$/.test(where.field)
          ? 'JointID'
          : where.field === 'JointAxID'
            ? 'AxCoefID'
            : undefined;
    if (/^MPropSetID[12]$/.test(where.field)) {
      const row = where.table.rows.find((r) => r.line === line);
      const geometry = row?.cells[where.table.headers.indexOf('MSecGeom')]?.text;
      if (!['1', '2'].includes(geometry)) return null;
      key = geometry === '2' ? 'MPropSetID' : 'PropSetID';
    }
    if (key)
      definitions = tables.filter(
        (t) =>
          t.headers.includes(key) &&
          (key === 'MemberID' ? t.headers.includes('MJointID1') : !t.headers.includes('MJointID1')),
      );
    if (!key) return null;
    definitions = definitions.map((t) => ({ ...t, referenceKey: key }));
  }
  const choices = new Map<
    string,
    {
      value: string;
      section: string;
      summary: string;
      definitions: { line: number; start: number; end: number }[];
    }
  >();
  for (const table of definitions) {
    const index = table.referenceKey
      ? table.headers.indexOf(table.referenceKey)
      : table.headers.indexOf(
          module === 'MoorDyn' && /^Attach[AB]$/.test(where.field) ? 'ID' : 'Name',
        );
    for (const row of table.rows)
      if (row.cells[index]) {
        const value = row.cells[index].text;
        const previous = choices.get(value);
        const summary = table.headers
          .map((field, i) =>
            i !== index && row.cells[i]
              ? `${field}=${row.cells[i].text}${table.units[i] ? ' ' + table.units[i] : ''}`
              : '',
          )
          .filter(Boolean)
          .slice(0, 5)
          .join(' · ');
        choices.set(value, {
          value: row.cells[index].text,
          section: table.section,
          summary,
          definitions: [
            ...(previous?.definitions || []),
            { line: row.line, start: row.cells[index].start, end: row.cells[index].end },
          ],
        });
      }
  }
  return { ...where, resolved: definitions.length > 0, choices: [...choices.values()] };
}

export function arrayContext(text: string, line: number, profile?) {
  const array = countedArrayContext(text, line, undefined, profile);
  return array ? { ...array, applicability: applicability(parseDocument(text), array.name) } : null;
}

export function jointListContext(text: string, line: number, character: number) {
  const snapshot = textSnapshot(text),
    scalar = scalarContext(text, line, character);
  if (!scalar || scalar.name !== 'JOutLst' || scalar.module !== 'HydroDyn') return null;
  const source = snapshot.lines[line],
    label = lex(source).items.find((c) => c.text === 'JOutLst');
  const values = lex(source.slice(0, label.start)).items;
  const cell = values.find((c) => c.start <= character && character <= c.end);
  const index = cell ? values.indexOf(cell) : values.filter((c) => c.end < character).length;
  const count = number(snapshot.parsed.parameters.get('NJOutputs')?.value);
  if (Number.isInteger(count) && (count === 0 || index >= count)) return null;
  const tables = snapshot.tables.filter(
    (table) =>
      table.headers[0] === 'JointID' && table.headers.some((f) => /^Joint[xyz]i$/i.test(f)),
  );
  const selected = new Set(values.filter((c) => c !== cell).map((c) => c.text));
  const choices = tables.flatMap((table) =>
    table.rows
      .filter((row) => row.cells[0])
      .map((row) => ({
        value: row.cells[0].text,
        section: table.section,
        summary: table.headers
          .slice(1, 5)
          .map((name, i) => name + '=' + (row.cells[i + 1]?.text || '?'))
          .join(' · '),
        definitions: [{ line: row.line, start: row.cells[0].start, end: row.cells[0].end }],
      })),
  );
  return {
    ...scalar,
    cell,
    index: index + 1,
    count: Number.isInteger(count) ? count : undefined,
    selected,
    start: cell?.start ?? character,
    end: cell?.end ?? character,
    choices,
  };
}

export function countEdits(text: string) {
  const edits = [];
  for (const table of readTables(text)) {
    if (
      !table.count ||
      table.count.value === table.rows.length ||
      table.headers.includes('FillMList') ||
      table.rows.some(
        (r) =>
          r.cells.length !== table.headers.length ||
          r.cells.some((cell, i) => cell.text === table.headers[i]),
      )
    )
      continue;
    const cell = lex(text.split(/\r?\n/)[table.count.line]).items[0];
    edits.push({
      line: table.count.line,
      start: cell.start,
      end: cell.end,
      name: table.count.name,
      old: cell.text,
      value: String(table.rows.length),
    });
  }
  return edits;
}

export function outputGroups(module: string) {
  const groups = [
    { id: 'platform', pattern: /^Ptfm(?:Surge|Sway|Heave|Roll|Pitch|Yaw)$/ },
    { id: 'blade', pattern: /^Root[FM][xyz]b[123]$/ },
    { id: 'tower', pattern: /^TwrBs[FM]/ },
    { id: 'generator', pattern: /^Gen(?:Pwr|Tq)$/ },
    { id: 'wave', pattern: /^Wave\d+Elev$/ },
    { id: 'wind', pattern: /^Wind\d+Vel[XYZ]$/ },
  ];
  return groups
    .map((g) => ({
      id: g.id,
      channels: outputChoices(module).filter((c) => g.pattern.test(c.name)),
    }))
    .filter((g) => g.channels.length);
}

/** Only offer spelling corrections in an existing value-before-label record. */
export function parameterNameContext(text: string, line: number, character: number) {
  const parsed = parseDocument(text);
  const source = textSnapshot(text).lines[line] || '';
  if (
    readTables(text).some((t) => t.line === line || t.rows.some((r) => r.line === line)) ||
    parsed.tokens.some((t) => t.line === line && ['output', 'end'].includes(t.kind))
  )
    return null;
  const scan = lex(source);
  const item = scan.items.find(
    (x, i) =>
      i > 0 &&
      character >= x.start &&
      character <= x.end &&
      /^[A-Za-z]\w*(?:\(\d+\))?$/.test(x.text) &&
      (/^[-–]$/.test(scan.items[i + 1]?.text) || i === scan.items.length - 1),
  );
  if (!item || !/^(?:["']|[-+]?\d|true$|false$|default$|unused$|none$)/i.test(scan.items[0]?.text))
    return null;
  return {
    ...item,
    module: parsed.module,
    candidates: correctedNames(parsed.module, item.text),
  };
}
