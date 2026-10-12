import { t } from './i18n';
import { parseDocument, lex, applicability } from './parser';
import { errorMessage } from './errors';
import { readTables } from './tables';
import { number } from './analysis';
import { fileListRules, strictFileLists } from './editor-lists';
import { isPathParameter, turbSimFileActive } from './parameter-paths';
function fileReferences(parsed, text) {
  const result = [];
  const lines = text.split(/\r?\n/);
  const listNames = new Set(
    Object.entries(fileListRules)
      .filter(([, rule]) => rule.module === parsed.module)
      .map(([name]) => name),
  );
  const entries = [
    ...(parsed.records || [...parsed.parameters.values()]).filter(
      (entry) => !listNames.has(entry.name),
    ),
    ...strictFileLists(text, parsed, lines).entries.map((entry) => ({ ...entry, list: true })),
  ];
  const counts = new Map();
  const controls = {
    EDFile: ['CompElast', [1, 2, 3]],
    AeroFile: ['CompAero', [1, 2, 3]],
    ServoFile: ['CompServo', [1]],
    SeaStFile: ['CompSeaSt', [1]],
    HydroFile: ['CompHydro', [1]],
    SubFile: ['CompSub', [1, 2]],
    MooringFile: ['CompMooring', [1, 2, 3, 4]],
    IceFile: ['CompIce', [1, 2]],
    InflowFile: ['CompInflow', [1]],
    SoilFile: ['CompSoil', [1]],
  };
  for (const entry of entries) {
    if (/^Num/.test(entry.name)) {
      continue;
    }
    if (
      !isPathParameter(entry.name, parsed.module) ||
      (/ProcName|FileFmt|OutFile|TowerFile$/i.test(entry.name) &&
        /^(true|false|0|1)$/i.test(entry.value))
    ) {
      continue;
    }
    if (/^(OutFile|OutFileFmt)$/i.test(entry.name)) {
      continue;
    }
    const occurrence = entry.list ? 1 : (counts.get(entry.name) || 0) + 1;
    counts.set(entry.name, occurrence);
    let active = !/此参数所属选项未启用/.test(applicability(parsed, entry.name));
    if (parsed.module === 'TurbSim') active &&= turbSimFileActive(parsed, entry.name);
    const control = controls[entry.name];
    if (control && parsed.parameters.has(control[0])) {
      active &&= control[1].includes(number(parsed.parameters.get(control[0]).value));
    }
    if (/^BDBldFile/.test(entry.name) && parsed.parameters.has('CompElast')) {
      active &&= number(parsed.parameters.get('CompElast').value) === 2;
    }
    if (entry.name === 'PotFile' && parsed.parameters.has('PotMod')) {
      active &&= number(parsed.parameters.get('PotMod').value) === 1;
    }
    if (entry.name === 'WvKinFile' && parsed.parameters.has('WaveMod')) {
      active &&= [5, 6].includes(number(parsed.parameters.get('WaveMod').value));
    }
    const values = [...entry.value.matchAll(/"([^"]+)"|'([^']+)'/g)].map((x) => x[1] || x[2]);
    if (
      !values.length &&
      entry.value.replace(/^["']|["']$/g, '').trim() &&
      !/^(true|false|0|1)$/i.test(entry.value)
    ) {
      values.push(entry.value.trim());
    }
    values.forEach((value, index) => {
      if (/^(unused|none|default|n\/a)$/i.test(value)) {
        return;
      }
      let suffixes = [''];
      if (entry.name === 'PotFile') {
        suffixes = ['.hst', '.1'];
        if (number(parsed.parameters.get('ExctnMod')?.value) > 0) {
          suffixes.push('.3');
        }
        for (const [key, end] of [
          ['DiffQTF', 'd'],
          ['SumQTF', 's'],
        ]) {
          const n = number(parsed.parameters.get(key)?.value);
          if (n > 0) {
            suffixes.push(`.${n}${end}`);
          }
        }
        if (number(parsed.parameters.get('RdtnMod')?.value) === 2) {
          suffixes.push('.ss');
        }
        if (number(parsed.parameters.get('ExctnMod')?.value) === 2) {
          suffixes.push('.ssexctn');
        }
      }
      if (entry.name === 'FilenameRoot') {
        suffixes = ['.wnd'];
      }
      const line = entry.line;
      const token = lex(lines[line] || '').items[0];
      for (const suffix of suffixes) {
        result.push({
          parameter: entry.name,
          line,
          start: entry.start ?? token?.start ?? 0,
          end: entry.end ?? token?.end ?? 1,
          path: value + suffix,
          active,
          role: `${entry.name}${occurrence > 1 ? '#' + occurrence : ''}${entry.list && entry.count > 1 ? '[' + entry.index + ']' : values.length > 1 ? '[' + index + ']' : ''}${suffix}`,
        });
      }
    });
  }
  return result;
}
async function buildGraph(root, io, limit = 300, signal?: AbortSignal) {
  const graph = { root, nodes: new Map(), edges: [], issues: [] };
  const queue = [root];
  const scheduled = new Set(queue);
  const existence = new Map<string, Promise<boolean>>();
  let nextNode = 0;
  while (nextNode < queue.length && graph.nodes.size < limit) {
    if (signal?.aborted) return undefined;
    const uri = queue[nextNode++];
    let text;
    try {
      text = await io.read(uri);
      if (signal?.aborted) return undefined;
    } catch (error) {
      graph.issues.push({
        uri,
        line: 0,
        severity: 'warning',
        code: 'read-file',
        message: t('references.readFailed', errorMessage(error)),
      });
      continue;
    }
    const parsed = parseDocument(text);
    graph.nodes.set(uri, { uri, text, parsed, tables: readTables(text) });
    // Resolve all dependencies before any checks await I/O, so invalidation sees them.
    const references = fileReferences(parsed, text).map((reference) => ({
      reference,
      to: io.resolve(uri, reference.path),
    }));
    const found: boolean[] = new Array(references.length);
    let nextReference = 0;
    let checkFailed = false;
    await Promise.all(
      Array.from({ length: Math.min(4, references.length) }, async () => {
        while (nextReference < references.length && !signal?.aborted && !checkFailed) {
          const index = nextReference++;
          const { to } = references[index];
          if (!existence.has(to))
            existence.set(
              to,
              Promise.resolve().then(() =>
                signal?.aborted || checkFailed ? false : io.exists(to),
              ),
            );
          try {
            found[index] = await existence.get(to);
          } catch (error) {
            checkFailed = true;
            throw error;
          }
        }
      }),
    );
    if (signal?.aborted) return undefined;
    for (const [index, { reference, to }] of references.entries()) {
      const exists = found[index];
      if (signal?.aborted) return undefined;
      const isConfig =
        /\.(fst|fstf|dat|in|txt)$/i.test(reference.path) &&
        !/^DLL_(?:FileName|File)$/i.test(reference.parameter);
      const edge = { ...reference, from: uri, to, exists, isConfig, cycle: false };
      graph.edges.push(edge);
      if (reference.active && !exists) {
        graph.issues.push({
          ...reference,
          uri,
          severity: 'error',
          code: 'missing-file',
          message: t('diagnostic.missingReference', reference.parameter, reference.path),
        });
      }
      if (reference.active && exists && isConfig && !scheduled.has(to)) {
        scheduled.add(to);
        queue.push(to);
      }
    }
  }
  if (nextNode < queue.length) {
    graph.issues.push({
      uri: root,
      line: 0,
      severity: 'warning',
      code: 'graph-limit',
      message: t('references.fileLimitReached', limit),
    });
  }
  const colors = new Map();
  const outgoing = new Map<string, typeof graph.edges>();
  for (const edge of graph.edges) {
    if (!edge.active || !edge.isConfig || !edge.exists) continue;
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push(edge);
  }
  function visit(uri) {
    colors.set(uri, 'gray');
    for (const edge of outgoing.get(uri) || []) {
      if (colors.get(edge.to) === 'gray') {
        edge.cycle = true;
        continue;
      }
      if (!colors.has(edge.to) && graph.nodes.has(edge.to)) {
        visit(edge.to);
      }
    }
    colors.set(uri, 'black');
  }
  visit(root);
  return graph;
}
function crossIssues(graph) {
  const issues = [];
  const nodes = [...graph.nodes.values()];
  const root = graph.nodes.get(graph.root);
  if (!root) {
    return issues;
  }
  const sea = nodes.find((n) => n.parsed.module === 'SeaState');
  const get = (node, key) => node?.parsed.parameters.get(key);
  const val = (node, key) => number(get(node, key)?.value);
  const add = (node, key, code, message, severity = 'error') =>
    issues.push({ uri: node.uri, ...(get(node, key) || { line: 0 }), severity, code, message });
  for (const hydro of nodes.filter((n) => n.parsed.module === 'HydroDyn')) {
    const enabled = ['MnDrift', 'NewmanApp', 'DiffQTF'].filter((k) => val(hydro, k) > 0);
    if (enabled.length > 1) {
      for (const key of enabled) {
        add(hydro, key, 'qtf-exclusive', t('diagnostic.mutuallyExclusive', enabled.join('、')));
      }
    }
    if (
      sea &&
      val(hydro, 'NewmanApp') > 0 &&
      val(sea, 'WaveDirMod') !== 0 &&
      Number.isFinite(val(sea, 'WaveDirMod'))
    ) {
      add(hydro, 'NewmanApp', 'newman-direction', t('diagnostic.newmanDirectionalSpreading'));
    }
    if (
      sea &&
      val(sea, 'WaveMod') === 6 &&
      val(hydro, 'PotMod') !== 0 &&
      Number.isFinite(val(hydro, 'PotMod'))
    ) {
      add(hydro, 'PotMod', 'external-wave', t('diagnostic.externalWavesWithPotentialFlow'));
    }
  }
  if (
    sea &&
    val(sea, 'WaveMod') === 6 &&
    Number.isFinite(val(sea, 'WaveDT')) &&
    Number.isFinite(val(root, 'DT')) &&
    Math.abs(val(sea, 'WaveDT') - val(root, 'DT')) > 1e-9
  ) {
    add(sea, 'WaveDT', 'external-wave-step', t('diagnostic.externalWaveTimeStep'));
  }
  if (
    Number.isFinite(val(root, 'TStart')) &&
    Number.isFinite(val(root, 'TMax')) &&
    val(root, 'TStart') >= val(root, 'TMax')
  ) {
    add(root, 'TStart', 'output-time', t('diagnostic.outputStartTime'));
  }
  if (val(root, 'DT_Out') > 0 && val(root, 'DT') > 0) {
    const ratio = val(root, 'DT_Out') / val(root, 'DT');
    if (ratio < 1 || Math.abs(ratio - Math.round(ratio)) > 1e-6) {
      add(root, 'DT_Out', 'output-sampling', t('diagnostic.outputSampling'), 'warning');
    }
  }
  for (const node of nodes) {
    for (const key of ['WtrDpth', 'WtrDens', 'AirDens', 'Gravity']) {
      const a = val(root, key);
      const b = val(node, key);
      if (node !== root && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 1e-6) {
        add(
          node,
          key,
          'environment-mismatch',
          t('diagnostic.environmentOverride', key, b, a),
          'warning',
        );
      }
    }
  }
  return issues;
}
export { fileReferences, buildGraph, crossIssues };
