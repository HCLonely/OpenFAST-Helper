import { expandedFields } from './table-layout';
import { outputBlocks } from './output-blocks';
import { findEntry } from './catalog';
import type { Lexeme, ParameterRecord, ParsedDocument, ConfigToken, TokenKind } from './types';
const VALUE =
  /^(?:["']|[-+]?(?:\d|\.\d)|true$|false$|default$|ranlux$|none$|unused$|fixed$|vessel$|n\/a$|es\d|a\d)/i;
const NAME = /^[A-Za-z][\w/-]*(?:\(\d+\))?$/;
const AXES = ['纵荡/X', '横荡/Y', '垂荡/Z', '横摇/X', '纵摇/Y', '艏摇/Z'];
// Index-preserving lexical scan. A quoted ! is part of the value, not a comment.
function lex(line: string) {
  const items: Lexeme[] = [];
  const commentStart =
    [...line.matchAll(/"[^"\r\n]*"|'[^'\r\n]*'|!/g)].find((match) => match[0] === '!')?.index ??
    line.length;
  const regex = /"[^"\r\n]*"|'[^'\r\n]*'|[^\s,]+/g;
  for (const match of line.slice(0, commentStart).matchAll(regex)) {
    const value = match[0];
    items.push({ text: value, start: match.index, end: match.index + value.length });
  }
  const comment = commentStart < line.length ? line.slice(commentStart + 1).trim() : '';
  return { items, comment, commentStart };
}
function detectModule(text: string): string | null {
  const header = text.split(/\r?\n/).slice(0, 15).join('\n');
  if (
    /Controller parameter input file|^\s*!?[^\n]*\bROSCO\b[^\n]*(?:input|parameter|controller)/im.test(
      header,
    )
  ) {
    return 'ROSCO';
  }
  for (const name of [
    'ElastoDyn',
    'InflowWind',
    'ServoDyn',
    'SeaState',
    'HydroDyn',
    'MoorDyn',
    'AeroDyn',
    'BeamDyn',
    'SubDyn',
    'TurbSim',
    'OLAF',
    'ExtPtfm',
    'SimpleElastoDyn',
  ]) {
    if (
      new RegExp(`(?:^|[-!\\s])${name}(?:[^\\n]*(?:INPUT|FILE|PROPERT)|\\s+v[\\d.])`, 'im').test(
        header,
      )
    ) {
      return name;
    }
  }
  if (/OpenFAST[^\n]*INPUT FILE|FAST[^\n]*INPUT FILE|FAST\.Farm[^\n]*INPUT/i.test(header)) {
    return 'OpenFAST';
  }
  // Signature requires multiple genuine value-before-label records, not a word in prose.
  const labels = new Set();
  const keyFirstLabels = new Set<string>();
  const roscoLabels = new Set<string>();
  for (const line of text.split(/\r?\n/).slice(0, 150)) {
    const { items, comment } = lex(line);
    if (items.length && items.every((item) => VALUE.test(item.text))) {
      const name = /^([A-Za-z]\w*)\s*(?:[-–].*)?$/.exec(comment)?.[1];
      if (name) roscoLabels.add(name.toLowerCase());
    }
    if (items.length >= 2 && VALUE.test(items[0].text) && NAME.test(items[1].text)) {
      labels.add(items[1].text.toLowerCase());
    }
    if (items.length >= 2 && NAME.test(items[0].text) && VALUE.test(items[1].text)) {
      keyFirstLabels.add(items[0].text.toLowerCase());
    }
  }
  if (['logginglevel', 'pc_controlmode', 'vs_controlmode'].every((x) => roscoLabels.has(x))) {
    return 'ROSCO';
  }
  for (const [module, signature] of [
    ['OpenFAST', ['tmax', 'compelast', 'compaero']],
    ['InflowWind', ['windtype', 'propagationdir', 'nwindvel']],
    ['ElastoDyn', ['flapdof1', 'gendof', 'numbl']],
    ['SeaState', ['wavemod', 'wavehs', 'wavetp']],
    ['HydroDyn', ['potmod', 'rdtnmod', 'nbody']],
    ['ServoDyn', ['pcmode', 'vscontrl', 'genmodel']],
    ['TurbSim', ['numgrid_z', 'numgrid_y', 'timestep']],
    ['TurbSim', ['ncomp', 'npoints', 'refptid']],
    ['TurbSim', ['numusrf', 'specscale1', 'specscale2', 'specscale3']],
    ['TurbSim', ['numusrz', 'stdscale1', 'stdscale2', 'stdscale3']],
  ] as [string, string[]][]) {
    if (signature.every((x) => labels.has(x))) {
      return module;
    }
  }
  // Official-format additions follow every existing header/signature rule.
  for (const [module, signature] of [
    ['InflowWind', ['windtype', 'propagationdir', 'nwindvel']],
    ['HydroDyn', ['potmod', 'rdtnmod', 'nbody']],
    ['ServoDyn', ['pcmode', 'vscontrl', 'genmodel']],
  ] as [string, string[]][]) {
    if (signature.every((name) => labels.has(name) || keyFirstLabels.has(name))) return module;
  }
  for (const [module, title] of [
    ['AeroDisk', 'Aero\\s*Disk'],
    ['AeroAcoustics', 'AeroAcoustics'],
    ['StC', '(?:STRUCTURAL CONTROL(?:\\s*\\(StC\\))?|StC)'],
  ]) {
    if (new RegExp(`(?:^|[-!\\s])${title}[^\\n]*(?:INPUT FILE|PROPERT)`, 'im').test(header))
      return module;
  }
  if (['pc_gs_n', 'pc_gs_kp', 'pc_gs_ki'].every((name) => roscoLabels.has(name))) return 'ROSCO';
  return null;
}
function parseDocument(text: string): ParsedDocument {
  const module = detectModule(text) || 'OpenFAST';
  const tokens: ConfigToken[] = [];
  const sections: ParsedDocument['sections'] = [];
  const parameters = new Map<string, ParameterRecord>();
  const records: ParameterRecord[] = [];
  let table = null;
  let matrix = null;
  let output = false;
  const lines = text.split(/\r?\n/);
  const blocks = outputBlocks(text);
  let comments: string[] = [];
  const put = (
    item: {
      start: number;
      end: number;
    },
    line: number,
    kind: TokenKind,
    name: string,
    extra: Partial<ConfigToken> = {},
  ) => tokens.push({ line, start: item.start, end: item.end, kind, name, comments, ...extra });
  for (let line = 0; line < lines.length; line++) {
    const source = lines[line];
    const trimmed = source.trim();
    const scanned = lex(source);
    const { items } = scanned;
    comments = scanned.comment ? [scanned.comment] : [];
    if (/^[-=]{3}/.test(trimmed) || /^![-=]{3}/.test(trimmed)) {
      sections.push({ name: trimmed.replace(/^!?[-=\s]+|[-=\s]+$/g, ''), line });
      table = null;
      matrix = null;
      output =
        /OUTPUT CHANNELS/i.test(trimmed) || (module === 'MoorDyn' && /OUTPUTS/i.test(trimmed));
      continue;
    }
    if (/^["']?END\b/i.test(trimmed)) {
      const start = source.search(/END/i);
      put({ start, end: start + 3 }, line, 'end', 'END');
      output = false;
      table = null;
      matrix = null;
      continue;
    }
    if (!items.length || /^\(/.test(trimmed)) {
      continue;
    }
    if (
      module === 'ROSCO' &&
      items.every(
        (item) =>
          VALUE.test(item.text) ||
          /[/\\]/.test(item.text) ||
          /^[\w.-]+\.[A-Za-z0-9]+$/.test(item.text),
      ) &&
      scanned.comment
    ) {
      const match = /^([A-Za-z]\w*(?:\(\d+\))?)\s*(?:[-–]\s*(.*))?$/.exec(scanned.comment);
      if (match) {
        const start = source.indexOf(match[1], scanned.commentStart + 1);
        const entry = {
          name: match[1],
          value: source.slice(0, scanned.commentStart).trim(),
          original: match[2] || '',
          comments,
          line,
        };
        parameters.set(entry.name, entry);
        records.push(entry);
        put({ start, end: start + entry.name.length }, line, 'parameter', entry.name, entry);
        for (const item of items) {
          put(item, line, 'value', entry.name, entry);
        }
        continue;
      }
    }
    if (output) {
      const dash = items.find((x) => x.text === '-' || x.text === '–');
      const original = dash ? source.slice(dash.end, scanned.commentStart).trim() : '';
      // Enumerate individual channels inside a quoted comma-separated group.
      for (const item of items) {
        if (item.text === '-' || item.text === '–' || item.text.startsWith('!')) {
          break;
        }
        const value = item.text.replace(/^["']|["']$/g, '');
        for (const match of value.matchAll(/[A-Za-z][A-Za-z0-9_]*/g)) {
          const start = item.start + match.index + (/^["']/.test(item.text) ? 1 : 0);
          put({ start, end: start + match[0].length }, line, 'output', match[0], {
            original,
            outputBlock: blocks.find((b) => line > b.start && line <= b.end)?.id,
            outputKind: blocks.find((b) => line > b.start && line <= b.end)?.kind || 'regular',
            comments: [original, ...comments].filter(Boolean),
          });
        }
      }
      continue;
    }
    if (/^(?:BldNd_OutList|OutList)\b/i.test(trimmed)) {
      put(items[0], line, 'parameter', 'OutList');
      output = true;
      table = null;
      matrix = null;
      continue;
    }
    const headerLimit = source.indexOf('[');
    const header = items.filter(
      (x) => x.text !== '-' && (headerLimit < 0 || x.start < headerLimit),
    );
    if (header.length >= 2 && header.every((x) => findEntry(x.text, module, 'header'))) {
      table = header.map((x) => x.text);
      matrix = null;
      for (const item of header) {
        put(item, line, 'header', item.text);
      }
      continue;
    }
    // Find a label after one or more input values. Unquoted file paths remain values.
    const label = items.findIndex(
      (x, index) =>
        index > 0 &&
        NAME.test(x.text) &&
        (findEntry(x.text, module) ||
          items[index + 1]?.text === '-' ||
          items[index + 1]?.text === '–' ||
          (index === items.length - 1 && scanned.commentStart < source.length)),
    );
    if (
      label > 0 &&
      !table &&
      (VALUE.test(items[0].text) ||
        /[/\\]/.test(items[0].text) ||
        items.slice(0, label).every((item) => /^[A-Za-z][\w.+:/\\-]*$/.test(item.text)))
    ) {
      const name = items[label].text;
      const value = source.slice(0, items[label].start).trim();
      const original = source
        .slice(items[label].end, scanned.commentStart)
        .replace(/^\s*[-–]?\s*/, '')
        .trim();
      const inline = /中文说明[:：]\s*(.*)/.exec(scanned.comment)?.[1];
      const entry = {
        name,
        value,
        original,
        line,
        inline,
        comment: inline ? undefined : scanned.comment,
        comments: [original, ...comments].filter(Boolean),
      };
      parameters.set(name, entry);
      records.push(entry);
      put(items[label], line, 'parameter', name, entry);
      if (/^Add(?:F0|CLin|BLin|BQuad)$/.test(name)) {
        matrix = { name, row: 1 };
        matrixTokens(items.slice(0, label), line, matrix, put, { comments: entry.comments });
      } else {
        matrix = null;
        const valueItems =
          module === 'AeroDyn' && ['BlOutNd', 'TwOutNd'].includes(name)
            ? lex(source.slice(0, items[label].start).replace(/;/g, ' ')).items
            : items.slice(0, label);
        for (const item of valueItems) {
          put(item, line, 'value', name, entry);
        }
      }
      continue;
    }
    if (matrix && VALUE.test(items[0].text)) {
      matrix.row++;
      if (matrix.row <= 6) {
        matrixTokens(items, line, matrix, put);
      } else {
        matrix = null;
      }
      continue;
    }
    if (table && items.length) {
      const fields = expandedFields(table, items);
      for (let column = 0; column < Math.min(items.length, fields.length); column++) {
        put(items[column], line, 'cell', fields[column].name, {
          value: items[column].text,
          column: column + 1,
        });
      }
    }
  }
  return { module, tokens, sections, parameters, records, lineCount: lines.length };
}
function matrixTokens(items, line, matrix, put, extra: Partial<ConfigToken> = {}) {
  const expected = matrix.name === 'AddF0' ? 1 : 6;
  for (let column = 0; column < Math.min(items.length, expected); column++) {
    put(items[column], line, 'matrix', matrix.name, {
      ...extra,
      value: items[column].text,
      row: matrix.row,
      column: column + 1,
    });
  }
}
function tokenAt(parsed: ParsedDocument, line: number, character: number): ConfigToken | undefined {
  return parsed.tokens.find((x) => x.line === line && x.start <= character && character < x.end);
}
function dependencyRules(parsed: ParsedDocument, name: string) {
  name = findEntry(name, parsed.module)?.name || name;
  const rules = [];
  const wind = {
    '1': ['HWindSpeed', 'RefHt', 'PLexp'],
    '2': ['Filename_Uni', 'RefHt_Uni', 'RefLength'],
    '3': ['FileName_BTS'],
    '4': ['FilenameRoot', 'TowerFile'],
    '5': [
      'FileName_u',
      'FileName_v',
      'FileName_w',
      'nx',
      'ny',
      'nz',
      'dx',
      'dy',
      'dz',
      'RefHt_Hawc',
      'URef',
      'WindProfile',
      'PLExp_Hawc',
      'Z0',
      'XOffset',
      'ScaleMethod',
      'SFx',
      'SFy',
      'SFz',
      'SigmaFx',
      'SigmaFy',
      'SigmaFz',
    ],
  };
  if (parsed.module === 'InflowWind') {
    for (const [choice, keys] of Object.entries(wind)) {
      if (keys.includes(name)) {
        rules.push(['WindType', [choice]]);
      }
    }
    if (/^(?:NumPulseGate|PulseSpacing)$/.test(name)) {
      rules.push(['SensorType', ['3']]);
    }
    if (name === 'NumBeam') {
      rules.push(['SensorType', ['1']]);
    }
  }
  if (parsed.module === 'ServoDyn') {
    if (/^VS_/.test(name)) {
      rules.push(['VSContrl', ['1']]);
    }
    if (/^SIG_/.test(name)) {
      rules.push(['VSContrl', ['0']], ['GenModel', ['1']]);
    }
    if (/^TEC_/.test(name)) {
      rules.push(['VSContrl', ['0']], ['GenModel', ['2']]);
    }
    if (/^(?:[BNTS]StCfiles)$/.test(name)) {
      rules.push([`Num${name[0]}StC`, null]);
    }
    if (name === 'SpdGenOn') {
      rules.push(['GenTiStr', ['false']]);
    }
    if (name === 'TimGenOn') {
      rules.push(['GenTiStr', ['true']]);
    }
    if (name === 'TimGenOf') {
      rules.push(['GenTiStp', ['true']]);
    }
    if (name === 'TPCOn') {
      rules.push(['PCMode', ['3', '4', '5']]);
    }
    if (name === 'TYCOn') {
      rules.push(['YCMode', ['3', '4', '5']]);
    }
  }
  if (parsed.module === 'SeaState') {
    if (name === 'WavePkShp') {
      rules.push(['WaveMod', ['2']]);
    }
    if (name === 'WaveHs') {
      rules.push(['WaveMod', ['1', '2', '3']]);
    }
    if (name === 'WaveTp') {
      rules.push(['WaveMod', ['1', '2']]);
    }
    if (/^Curr(?!Mod)/.test(name)) {
      rules.push(['CurrMod', ['1']]);
    }
    if (/^Crest/.test(name)) {
      rules.push(['ConstWaveMod', ['1', '2']]);
    }
    if (name === 'WvKinFile') {
      rules.push(['WaveMod', ['5', '6']]);
    }
    if (name === 'WaveDirMod') {
      rules.push(['WaveMod', ['2', '3', '4']]);
    }
    if (/^(WvLowCOff|WvHiCOff)[DS]$/.test(name)) {
      rules.push([name.endsWith('D') ? 'WvDiffQTF' : 'WvSumQTF', ['true', '1']]);
    }
  }
  if (parsed.module === 'HydroDyn') {
    if (name === 'ExctnCutOff') {
      rules.push(['ExctnDisp', ['2']]);
    }
    if (['NExctnHdg', 'PtfmYCutOff'].includes(name)) {
      rules.push(['PtfmYMod', ['1']]);
    }
    if (
      [
        'PotFile',
        'ExctnMod',
        'RdtnMod',
        'MnDrift',
        'NewmanApp',
        'DiffQTF',
        'SumQTF',
        'NBody',
        'NBodyMod',
      ].includes(name)
    ) {
      rules.push(['PotMod', ['1']]);
    }
  }
  if (parsed.module === 'OpenFAST') {
    if (/^BDBldFile/.test(name)) {
      rules.push(['CompElast', ['2']]);
    }
    if (/^(?:NLinTimes|LinTimes|LinInputs|LinOutputs|LinOutJac|LinOutMod|CalcSteady)$/.test(name)) {
      rules.push(['Linearize', ['true']]);
    }
    if (/^(?:TrimCase|TrimTol|TrimGain|Twr_Kdmp|Bld_Kdmp)$/.test(name)) {
      rules.push(['Linearize', ['true']], ['CalcSteady', ['true']]);
    }
    const files = {
      EDFile: ['CompElast', ['1', '2', '3']],
      AeroFile: ['CompAero', ['1', '2', '3']],
      InflowFile: ['CompInflow', ['1']],
      ServoFile: ['CompServo', ['1']],
      HydroFile: ['CompHydro', ['1']],
      SeaStFile: ['CompSeaSt', ['1']],
      SubFile: ['CompSub', ['1', '2']],
      MooringFile: ['CompMooring', ['1', '2', '3', '4']],
      IceFile: ['CompIce', ['1', '2']],
      SoilFile: ['CompSoil', ['1']],
    };
    if (files[name]) {
      rules.push(files[name]);
    }
  }
  return rules;
}
function applicability(parsed: ParsedDocument, name: string): string {
  name = findEntry(name, parsed.module)?.name || name;
  const get = (k) => {
    let value = (
      parsed.parameters.get(k) ||
      [...parsed.parameters.values()].find((x) => x.name.toLowerCase() === k.toLowerCase())
    )?.value
      .replace(/["']/g, '')
      .toLowerCase();
    if (value === 't') {
      value = 'true';
    }
    if (value === 'f') {
      value = 'false';
    }
    if (['Linearize', 'CalcSteady', 'GenTiStr', 'GenTiStp'].includes(k)) {
      if (value === '1') {
        value = 'true';
      }
      if (value === '0') {
        value = 'false';
      }
    }
    return value;
  };
  const rules = dependencyRules(parsed, name);
  if (!rules.length) {
    return '';
  }
  const status = rules.map(([key, choices]) => {
    const value = get(key);
    const active =
      value === undefined ? undefined : choices ? choices.includes(value) : Number(value) > 0;
    return { key, value, active, choices };
  });
  const values = status.map((x) => `${x.key}=${x.value ?? '未找到'}`).join('，');
  if (status.some((x) => x.active === false)) {
    return `当前文件 ${values}：此参数所属选项未启用；保留值不会自动启用该模型。`;
  }
  if (status.some((x) => x.active === undefined)) {
    return `适用条件：${status.map((x) => `${x.key} ${x.choices ? '取 ' + x.choices.join('/') : '大于 0'}`).join(' 且 ')}；文档缺少部分控制字段，无法判断。`;
  }
  return `当前文件 ${values}：符合本条适用条件；完整生效条件请同时核对原文件说明和版本。`;
}
function explainToken(
  parsed: ParsedDocument,
  token: Partial<ConfigToken> & {
    name: string;
    kind: TokenKind;
  },
) {
  const entry = findEntry(
    token.name,
    parsed.module,
    token.kind === 'value' || token.kind === 'matrix' ? 'parameter' : token.kind,
  );
  let description =
    entry?.description || '中文参数库尚未收录此项；请参考本行原始说明及所用 OpenFAST 版本文档。';
  if (token.kind === 'matrix') {
    if (token.name === 'AddF0') {
      description = `附加恒定预载荷向量第 ${token.row} 项：${AXES[token.row - 1]}；单位 ${token.row <= 3 ? 'N' : 'N·m'}。`;
    } else {
      const force = token.row <= 3 ? 'N' : 'N·m';
      const input = token.column <= 3 ? 'm' : 'rad';
      const unit =
        token.name === 'AddCLin'
          ? `${force}/${input}`
          : token.name === 'AddBLin'
            ? `${force}/(${input}/s)`
            : `${force}/(${input}/s)²`;
      description = `${entry?.description || token.name}\n第 ${token.row} 行（${AXES[token.row - 1]}载荷）、第 ${token.column} 列（${AXES[token.column - 1]}运动），单位 ${unit}。`;
    }
  }
  return {
    name: token.name,
    module: parsed.module,
    kind: token.kind,
    description,
    value: token.value,
    row: token.row,
    column: token.column,
    original: token.original,
    applicability: applicability(parsed, token.name),
    inline: token.inline,
    comment: token.comment,
    comments: token.comments,
  };
}
export { lex, detectModule, parseDocument, tokenAt, explainToken, applicability, dependencyRules };
