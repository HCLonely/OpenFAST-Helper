import { catalog } from './catalog';
import { countedArrayContext } from './editor-arrays';
import { lex } from './parser';
import { textSnapshot } from './editor-snapshot';
import { outputChoices, number } from './analysis';
import { t } from './i18n';
import type { ParameterExplanation } from './types';

export function editDistance(left: string, right: string): number {
  left = left.toLowerCase();
  right = right.toLowerCase();
  const rows = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i++) rows[i][0] = i;
  for (let j = 0; j <= right.length; j++) rows[0][j] = j;
  for (let i = 1; i <= left.length; i++)
    for (let j = 1; j <= right.length; j++) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + Number(left[i - 1] !== right[j - 1]),
      );
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1])
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  return rows[left.length][right.length];
}
export function correctedNames(module: string, name: string) {
  const candidates = new Map<
    string,
    { name: string; description: string; module?: string; rank: number }
  >();
  for (const entry of catalog.parameters) {
    if (entry.module !== module && entry.module !== '通用') continue;
    const rank =
      entry.name.toLowerCase() === name.toLowerCase()
        ? 0
        : entry.name.toLowerCase().startsWith(name.toLowerCase())
          ? 1
          : 2 + editDistance(name, entry.name);
    if (rank > (name.length >= 6 ? 4 : 3)) continue;
    const key = entry.name.toLowerCase();
    if (!candidates.has(key) || entry.module === module) candidates.set(key, { ...entry, rank });
  }
  return [...candidates.values()]
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .slice(0, 40);
}

export { specialValueChoices } from './value-options';

export { tableEnums } from './table-rules';

export function numberedOutputs(text: string, relatedTexts: string[] = []) {
  const own = textSnapshot(text);
  const module = own.parsed.module;
  const related = relatedTexts.map((t) => textSnapshot(t));
  const model = (name: string) => {
    if (own.parsed.parameters.has(name)) return number(own.parsed.parameters.get(name).value);
    const values = related
      .filter((s) => s.parsed.module === module || s.parsed.module === 'ElastoDyn')
      .map((s) => number(s.parsed.parameters.get(name)?.value))
      .filter(Number.isFinite);
    return values.length && values.every((v) => v === values[0]) ? values[0] : NaN;
  };
  let result = outputChoices(module);
  const validCount = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;
  if (module === 'ElastoDyn') {
    const blades = model('NumBl');
    if (validCount(blades, 3))
      result = result.filter(
        (c) =>
          !/(?:BldPitch|IPDefl|OoPDefl|TwstDefl)[1-3]$/.test(c.name) ||
          Number(c.name.at(-1)) <= blades,
      );
    if (validCount(blades, 3)) {
      const gages = model('NBlGages');
      for (let blade = 1; blade <= blades; blade++)
        for (const kind of ['F', 'M'])
          for (const axis of ['x', 'y', 'z']) {
            result.push({
              name: `Root${kind}${axis}b${blade}`,
              module,
              unit: kind === 'F' ? 'kN' : 'kN·m',
              description: t('editor.rootLoad', blade, kind + axis),
            });
            if (validCount(gages, 9))
              for (let gage = 1; gage <= gages; gage++)
                result.push({
                  name: `Spn${gage}${kind}L${axis}b${blade}`,
                  module,
                  unit: kind === 'F' ? 'kN' : 'kN·m',
                  description: t('editor.bladeGage', blade, gage, kind + axis),
                });
          }
    }
    const gages = model('NTwGages');
    if (validCount(gages, 9)) {
      const template = result.filter((c) => /^TwHt1/.test(c.name));
      result = result.filter((c) => !/^TwHt\d/.test(c.name));
      for (let i = 1; i <= gages; i++)
        for (const c of template)
          result.push({
            ...c,
            name: c.name.replace('TwHt1', 'TwHt' + i),
            description: t('editor.towerGage', i) + ' · ' + c.description,
          });
    }
  }
  if (module === 'InflowWind' || module === 'SeaState') {
    const wind = module === 'InflowWind';
    const count = model(wind ? 'NWindVel' : 'NWaveElev');
    if (validCount(count, 9))
      result = result.filter((c) => {
        const match = (wind ? /^Wind(\d+)Vel/ : /^Wave(\d+)Elev/).exec(c.name);
        return !match || Number(match[1]) <= count;
      });
  }
  if (module === 'MoorDyn') {
    const lineTables = own.tables.filter(
      (t) => t.headers.includes('Line') && t.headers.includes('NumSegs'),
    );
    if (lineTables.length) {
      result = [];
      for (const table of lineTables)
        for (const row of table.rows) {
          const id = row.cells[table.headers.indexOf('Line')]?.text;
          if (!/^[1-9]\d*$/.test(id || '')) continue;
          for (const prefix of ['FairTen', 'AnchTen'])
            result.push({
              name: prefix + id,
              module,
              unit: 'N',
              description: t(
                prefix === 'FairTen' ? 'editor.fairTension' : 'editor.anchorTension',
                id,
              ),
            });
        }
    }
  }
  return [...new Map(result.map((c) => [c.name.toLowerCase(), c])).values()];
}

export function arrayFocus(text: string, line: number, character: number) {
  const array = countedArrayContext(text, line, character);
  if (array?.cell && array.count > 0)
    return { token: array.cell, index: array.index, count: array.count };
  const snapshot = textSnapshot(text);
  const record = snapshot.parsed.records.find((r) => r.line === line);
  const countKey = {
    JOutLst: 'NJOutputs',
  }[record?.name];
  if (!countKey) return null;
  const values = (snapshot.tokensByLine.get(line) || []).filter((t) => t.kind === 'value');
  const index = values.findIndex((t) => t.start <= character && character <= t.end);
  const count = number(snapshot.parsed.parameters.get(countKey)?.value);
  return index < 0
    ? null
    : {
        token: values[index],
        index: index + 1,
        count: Number.isInteger(count) ? count : values.length,
      };
}

export function numericRepairs(text: string, activeLines = new Set<number>()) {
  const snapshot = textSnapshot(text);
  const result: {
    line: number;
    start: number;
    end: number;
    original: string;
    replacement?: string;
  }[] = [];
  const sources = new Map<string, { line: number; start: number; end: number; value: string }>();
  for (const token of snapshot.parsed.tokens)
    if (['value', 'cell', 'matrix'].includes(token.kind)) {
      if (/File|Names|ProcName|OutFmt/i.test(token.name)) continue;
      const source = snapshot.lines[token.line].slice(token.start, token.end);
      if (/^["']/.test(source)) continue;
      sources.set(token.line + ':' + token.start, { ...token, value: source });
    }
  // Tolerate malformed scalar values that the normal parser intentionally rejects.
  for (let line = 0; line < snapshot.lines.length; line++) {
    const scan = lex(snapshot.lines[line]);
    if (
      scan.items.length < 2 ||
      snapshot.tableByLine.has(line) ||
      snapshot.tokensByLine.get(line)?.some((t) => ['output', 'end'].includes(t.kind))
    )
      continue;
    const [value, label] = scan.items;
    if (
      !snapshot.parsed.parameters.has(label.text) &&
      !catalog.parameters.some(
        (e) =>
          e.name === label.text && (e.module === snapshot.parsed.module || e.module === '通用'),
      )
    )
      continue;
    if (!/File|Names|ProcName|OutFmt/i.test(label.text))
      sources.set(line + ':' + value.start, { ...value, line, value: value.text });
  }
  for (const token of sources.values()) {
    if (!/^[-+]?(?:\d|\.\d)/.test(token.value)) continue;
    const repaired = token.value.replace(/[，、]/g, ',');
    if (
      repaired !== token.value &&
      repaired.split(',').every((v) => /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][-+]?\d+)?$/.test(v))
    ) {
      result.push({ ...token, original: token.value, replacement: repaired });
    } else if (/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)[eEdD][-+]?$/.test(token.value)) {
      if (!activeLines.has(token.line)) result.push({ ...token, original: token.value });
    } else if (
      /^[-+]?\d[\d.]*\.{2}[\d.]*$/.test(token.value) ||
      /^[-+]?\d+\.\d+\.\d+$/.test(token.value)
    ) {
      result.push({ ...token, original: token.value });
    }
  }
  return result;
}

/** Two ranges let VS Code honor editor.suggest.insertMode without consuming neighbours. */
export function completionRanges(vscode, line: number, start: number, end: number, cursor: number) {
  return {
    inserting: new vscode.Range(line, start, line, Math.max(start, Math.min(cursor, end))),
    replacing: new vscode.Range(line, start, line, end),
  };
}

export function compatibleSelections(vscode, document, describe) {
  const editor = vscode.window.activeTextEditor;
  if (editor?.document !== document || !editor.selections || editor.selections.length < 2)
    return true;
  let signature;
  for (const selection of editor.selections) {
    if (selection.start.line !== selection.end.line) return false;
    const value = describe(selection.active);
    if (!value || selection.start.character < value.start || selection.end.character > value.end)
      return false;
    if (signature === undefined) signature = value.signature;
    else if (signature !== value.signature) return false;
  }
  return true;
}
