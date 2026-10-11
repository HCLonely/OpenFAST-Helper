import { t, descriptionFor } from './i18n';
import type { ParsedDocument, VersionProfile, DiagnosticIssue } from './types';
import { parseDocument, lex, applicability } from './parser';
import { findEntry, catalog } from './catalog';
import { optionsFor } from './value-options';
import { versionIssues } from './versions';
import { readTables, tableIssues, isNumber } from './tables';
import { normalizedOutput } from './output-names';
import { strictFileLists } from './editor-lists';
const number = (value: unknown): number =>
  isNumber(String(value)) ? Number(String(value).replace(/[dD]/, 'e')) : NaN;
function scalarRecords(
  text: string,
  parsed: ParsedDocument = parseDocument(text),
  tables = readTables(text),
  lines = text.split(/\r?\n/),
) {
  const records = [...parsed.records];
  const used = new Set(records.map((x) => x.line));
  const tableLines = new Set(tables.flatMap((t) => [t.line, ...t.rows.map((r) => r.line)]));
  lines.forEach((source, line) => {
    if (
      used.has(line) ||
      tableLines.has(line) ||
      /^\s*[!(=-]/.test(source) ||
      /^\s*(OutList|END)\b/i.test(source)
    ) {
      return;
    }
    const { items, commentStart } = lex(source);
    const index = items.findIndex(
      (item, i) =>
        i <= 2 &&
        findEntry(item.text, parsed.module) &&
        (['-', '–'].includes(items[i + 1]?.text) || items.length === i + 1),
    );
    if (index < 0) {
      return;
    }
    records.push({
      name: items[index].text,
      value: source.slice(0, items[index].start).trim(),
      line,
      original: source
        .slice(items[index].end, commentStart)
        .replace(/^\s*[-–]?\s*/, '')
        .trim(),
    });
  });
  return records.sort((a, b) => a.line - b.line);
}
function inactiveEntries(parsed: ParsedDocument) {
  return [...parsed.parameters.values()].filter(
    (x) =>
      /此参数所属选项未启用/.test(applicability(parsed, x.name)) ||
      /currently unused|not implemented yet/i.test(x.original || ''),
  );
}
function outputModule(name) {
  if (/^(FairTen|AnchTen)\d+$/i.test(name)) {
    return 'MoorDyn';
  }
  if (/^Wave\d+Elev$/i.test(name)) {
    return 'SeaState';
  }
  if (/^Wind\d+Vel[XYZ]$/i.test(name)) {
    return 'InflowWind';
  }
  if (/^Hydro[FM]/i.test(name)) {
    return 'HydroDyn';
  }
  if (/^Gen(?:Pwr|Tq)$/i.test(name)) {
    return 'ServoDyn';
  }
  return 'ElastoDyn';
}
function outputChoices(module) {
  return catalog.outputs
    .filter((x) => outputModule(x.name) === module)
    .map((x) => ({
      ...x,
      description: descriptionFor({ ...x, kind: 'output' }),
      module,
      unit:
        x.description
          .match(/(?:，|单位\s*)(kN·m|N·m|kN|kW|rpm|rad|deg|m\/s²|m\/s|m|N|度)(?:[。；，]|$)/)?.[1]
          ?.replace('度', 'deg') || t('common.seeDescription'),
    }));
}
function analyze(
  text: string,
  profile?: VersionProfile,
  parsed = parseDocument(text),
  tables = readTables(text),
): DiagnosticIssue[] {
  const lines = text.split(/\r?\n/);
  const records = scalarRecords(text, parsed, tables, lines);
  const issues: DiagnosticIssue[] = [];
  const seen = new Map();
  const inactive = new Set(inactiveEntries(parsed).map((x) => x.line));
  const add = (
    entry,
    code: string,
    message: string,
    severity: DiagnosticIssue['severity'] = 'error',
  ) => {
    const line = lines[entry.line] || '';
    const cells = lex(line).items;
    issues.push({
      ...entry,
      start: entry.start ?? cells[0]?.start ?? 0,
      end: entry.end ?? cells[0]?.end ?? Math.max(1, line.length),
      code,
      message,
      severity,
    });
  };
  for (const entry of records) {
    const repeatedRotor =
      parsed.module === 'OpenFAST' &&
      number(parsed.parameters.get('NRotors')?.value) > 1 &&
      /^(EDFile|BDBldFile\(|ServoFile|MirrorRotor)/.test(entry.name);
    if (seen.has(entry.name.toLowerCase()) && !repeatedRotor) {
      add(
        entry,
        'duplicate-parameter',
        t('diagnostic.duplicateParameter', entry.name, seen.get(entry.name.toLowerCase()) + 1),
        'warning',
      );
    }
    seen.set(entry.name.toLowerCase(), entry.line);
    if (inactive.has(entry.line)) {
      continue;
    }
    if (!entry.value) {
      add(entry, 'missing-value', t('diagnostic.missingValue', entry.name));
      continue;
    }
    const original = entry.original || '';
    const value = entry.value.replace(/^["']|["']$/g, '');
    const options = optionsFor({ ...entry, module: parsed.module, profile });
    if (options.length && !/1P[-+]?\d+(?:\.\d+)?$/i.test(value)) {
      const bool = options.every((x) => /^(true|false)$/i.test(x.value));
      const normal = bool
        ? /^(true|t|1)$/i.test(value)
          ? 'true'
          : /^(false|f|0)$/i.test(value)
            ? 'false'
            : value.toLowerCase()
        : value.toLowerCase();
      if (!options.some((x) => x.value.replace(/^["']|["']$/g, '').toLowerCase() === normal)) {
        add(
          entry,
          'enum-value',
          t(
            'diagnostic.invalidOption',
            entry.name,
            value,
            options.map((x) => x.value).join('/'),
            options[0].source,
          ),
        );
      }
    } else if (/\bflag\b/i.test(original) && !/^(true|false|t|f|0|1)$/i.test(value)) {
      add(entry, 'boolean', t('diagnostic.booleanRequired', entry.name));
    } else if (
      !/^(default|ranlux|rnsnlw)$/i.test(value) &&
      !/(?:File|Names|ProcName|AbortLevel|OutFmt)/i.test(entry.name) &&
      !/(?:quoted|string)/i.test(original) &&
      /\b(integer|int)\b|\(s\)|\(m\)|\(kg\)|\(rpm\)|\(-\)/i.test(original)
    ) {
      const parts = entry.value.split(/[\s,]+/);
      if (parts.some((x) => !isNumber(x)) && !/^WaveMod$/i.test(entry.name)) {
        add(entry, 'numeric', t('diagnostic.numericValueRequired', entry.name, entry.value));
      }
      if (
        /\binteger\b|\bNumber of\b/i.test(original) &&
        parts.some((x) => isNumber(x) && !Number.isInteger(number(x)))
      ) {
        add(entry, 'integer', t('diagnostic.integerRequired', entry.name));
      }
    }
    if (
      /^(?:DT|DT_Out|WaveDT|TMax|WaveTMax|RefHt|RefHt_Uni|RefLength|WaveTp)$/.test(entry.name) &&
      !/^default$/i.test(value) &&
      Number.isFinite(number(value)) &&
      number(value) <= 0
    ) {
      add(entry, 'positive', t('diagnostic.positiveRequired', entry.name));
    }
    if (/^WaveHs$/.test(entry.name) && number(value) < 0) {
      add(entry, 'nonnegative', t('diagnostic.negativeWaveHeight'));
    }
    if (
      /^(?:Num|N)(?:\w)/.test(entry.name) &&
      !/^(Nac|Newman|NBodyMod|NExctnHdg)/.test(entry.name) &&
      Number.isFinite(number(value)) &&
      (!Number.isInteger(number(value)) || number(value) < 0)
    ) {
      add(entry, 'count', t('diagnostic.nonnegativeIntegerRequired', entry.name));
    }
  }
  const outputs = parsed.tokens.filter((x) => x.kind === 'output');
  const outputSeen = new Set();
  for (const token of outputs) {
    const key =
      String(token.outputBlock ?? 0) +
      ':' +
      (token.outputKind === 'regular'
        ? normalizedOutput(token.name, parsed.module)
        : token.name.toLowerCase());
    if (outputSeen.has(key)) {
      add(token, 'duplicate-output', t('diagnostic.duplicateOutput', token.name), 'warning');
    }
    outputSeen.add(key);
    // Unknown channels are valid in versions beyond the small offline catalog.
    if (
      (!token.outputKind || token.outputKind === 'regular') &&
      findEntry(token.name, parsed.module, 'output') &&
      outputModule(token.name) !== parsed.module &&
      parsed.module !== 'OpenFAST'
    ) {
      add(
        token,
        'output-module',
        t('diagnostic.outputWrongModule', token.name, outputModule(token.name)),
        'warning',
      );
    }
  }
  return [
    ...issues,
    ...tableIssues(tables, parsed.module),
    ...strictFileLists(text, parsed, lines).issues,
    ...versionIssues({ ...parsed, records }, profile),
  ];
}
export { analyze, inactiveEntries, outputChoices, outputModule, scalarRecords, number };
