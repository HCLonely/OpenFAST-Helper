import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseDocument, lex } from './parser';
import { analyze, number, inactiveEntries } from './analysis';
import { fileReferences, crossIssues } from './references';
import { optionsFor } from './value-options';
import { findEntry } from './catalog';
import { descriptionFor, t } from './i18n';

export interface SweepParameter {
  id: string;
  uri: string;
  line: number;
  name: string;
  module: string;
  value: string;
  description: string;
}
export interface SweepDimension {
  id: string;
  values: string[];
}
export interface SweepPlan {
  root: string;
  dimensions: { parameter: SweepParameter; values: string[] }[];
  cases: { name: string; values: string[]; files: Map<string, string>; main: string }[];
  shared: string[];
}

export function sweepParameters(graph): SweepParameter[] {
  const result: SweepParameter[] = [];
  for (const node of graph.nodes.values()) {
    const lines = node.text.split(/\r?\n/);
    const inactive = new Set(inactiveEntries(node.parsed).map((record) => record.name));
    const names = new Map<string, number>();
    for (const record of node.parsed.records)
      names.set(record.name, (names.get(record.name) || 0) + 1);
    for (const record of node.parsed.records) {
      if (
        names.get(record.name) !== 1 ||
        inactive.has(record.name) ||
        !Number.isFinite(number(record.value)) ||
        /^(Num|Comp)/.test(record.name) ||
        /(?:_n|Count)$/i.test(record.name) ||
        /File|AFNames/i.test(record.name) ||
        optionsFor({ ...record, module: node.parsed.module, profile: node.profile }).length
      )
        continue;
      const items = lex(lines[record.line]).items;
      if (items[0]?.text !== record.value) continue;
      result.push({
        id: `${node.uri}#${record.line}`,
        uri: node.uri,
        line: record.line,
        name: record.name,
        module: node.parsed.module,
        value: record.value,
        description: descriptionFor(
          findEntry(record.name, node.parsed.module) || {
            name: record.name,
            description: record.original || '',
          },
        ),
      });
    }
  }
  return result;
}

export function planSweep(graph, dimensions: SweepDimension[]): SweepPlan {
  if (
    !graph?.nodes.has(graph.root) ||
    graph.issues.length ||
    !dimensions.length ||
    dimensions.length > 8
  )
    throw Error(t('sweep.invalidPlan'));
  const parameters = new Map(sweepParameters(graph).map((p) => [p.id, p]));
  const seen = new Set<string>();
  let count = 1;
  const selected = dimensions.map((d) => {
    const parameter = parameters.get(d.id);
    if (
      !parameter ||
      seen.has(d.id) ||
      !Array.isArray(d.values) ||
      !d.values.length ||
      d.values.length > 200
    )
      throw Error(t('sweep.invalidPlan'));
    seen.add(d.id);
    const values = d.values.map((v) => String(v).trim());
    if (
      values.some((v) => !Number.isFinite(number(v))) ||
      new Set(values.map((v) => number(v))).size !== values.length
    )
      throw Error(t('sweep.numericValues'));
    count *= values.length;
    if (count > 200) throw Error(t('sweep.limit'));
    return { parameter, values };
  });
  const paths = new Map<string, string>();
  let index = 0;
  for (const uri of graph.nodes.keys())
    paths.set(
      uri,
      uri === graph.root
        ? path.basename(fileURLToPath(uri))
        : `inputs/${String(++index).padStart(4, '0')}-${path.basename(fileURLToPath(uri))}`,
    );
  const shared = new Set<string>();
  let combinations: string[][] = [[]];
  for (const d of selected)
    combinations = combinations.flatMap((c) => d.values.map((v) => [...c, v]));
  const unchanged = new Map<string, string>();
  const referencesByNode = new Map<string, Map<number, any[]>>();
  for (const edge of graph.edges) {
    if (!referencesByNode.has(edge.from)) referencesByNode.set(edge.from, new Map());
    const lines = referencesByNode.get(edge.from);
    if (!lines.has(edge.line)) lines.set(edge.line, []);
    lines.get(edge.line).push(edge);
  }
  const prepared = [...graph.nodes.values()].map((node) => ({
    node,
    lines: node.text.split(/(\r?\n)/),
    dimensions: selected
      .map((dimension, index) => ({ ...dimension, index }))
      .filter((dimension) => dimension.parameter.uri === node.uri),
    references: fileReferences(node.parsed, node.text),
    referenceLines: referencesByNode.get(node.uri) || new Map<number, any[]>(),
  }));
  const cases = combinations.map((values, caseIndex) => {
    const files = new Map<string, string>();
    const variant = { ...graph, nodes: new Map() };
    for (const input of prepared) {
      const { node, dimensions, referenceLines } = input;
      if (unchanged.has(node.uri)) {
        files.set(paths.get(node.uri), unchanged.get(node.uri));
        variant.nodes.set(node.uri, node);
        continue;
      }
      const lines = input.lines.slice();
      dimensions.forEach((d) => {
        const at = d.parameter.line * 2;
        const token = lex(lines[at]).items[0];
        lines[at] = lines[at].slice(0, token.start) + values[d.index] + lines[at].slice(token.end);
      });
      const changed = lines.join('');
      const parsed = parseDocument(changed);
      if (analyze(changed, node.profile, parsed).some((i) => i.severity === 'error'))
        throw Error(t('sweep.invalidCase', caseIndex + 1, fileURLToPath(node.uri)));
      const before = input.references;
      const after = fileReferences(parsed, changed);
      if (
        before.length !== after.length ||
        after.some(
          (reference, index) =>
            reference.role !== before[index].role ||
            reference.path !== before[index].path ||
            reference.active !== before[index].active,
        )
      )
        throw Error(t('sweep.activationChange'));
      variant.nodes.set(node.uri, { ...node, text: changed, parsed });
      // Rewrite only recognized reference tokens, preserving every other byte of text.
      for (const [lineNumber, edges] of referenceLines) {
        const at = lineNumber * 2;
        let line = lines[at];
        for (const token of lex(line).items.reverse()) {
          const value = token.text.replace(/^['"]|['"]$/g, '');
          const edge = edges.find(
            (e) =>
              e.path === value ||
              ((e.parameter === 'PotFile' || e.parameter === 'FilenameRoot') &&
                e.path.startsWith(value + '.')),
          );
          if (!edge) continue;
          const suffix = edge.path.slice(value.length);
          let replacement: string;
          if (paths.has(edge.to)) {
            replacement = path.posix.relative(
              path.posix.dirname(paths.get(node.uri)),
              paths.get(edge.to),
            );
          } else {
            replacement = fileURLToPath(edge.to);
            if (suffix) replacement = replacement.slice(0, -suffix.length);
            shared.add(replacement);
          }
          if (replacement.includes('"') || /[\r\n]/.test(replacement))
            throw Error(t('sweep.invalidPlan'));
          line =
            line.slice(0, token.start) +
            '"' +
            replacement.replace(/\\/g, '/') +
            '"' +
            line.slice(token.end);
        }
        lines[at] = line;
      }
      const rewritten = lines.join('');
      files.set(paths.get(node.uri), rewritten);
      if (!dimensions.length) unchanged.set(node.uri, rewritten);
    }
    if (crossIssues(variant).some((i) => i.severity === 'error'))
      throw Error(t('sweep.invalidCase', caseIndex + 1, fileURLToPath(graph.root)));
    return {
      name: `case-${String(caseIndex + 1).padStart(4, '0')}`,
      values,
      files,
      main: paths.get(graph.root),
    };
  });
  return { root: graph.root, dimensions: selected, cases, shared: [...shared] };
}

/** Atomically reserve a new destination. On failure leave a marked partial folder for inspection. */
export async function writeSweep(plan: SweepPlan, destination: string): Promise<string[]> {
  if (!path.isAbsolute(destination)) throw Error(t('sweep.destination'));
  if (
    !plan.cases.length ||
    plan.cases.length > 200 ||
    plan.cases.some((entry) => !/^case-\d{4}$/.test(entry.name) || !entry.files.has(entry.main))
  )
    throw Error(t('sweep.invalidPlan'));
  await fs.mkdir(destination); // EEXIST: no overwrite, including empty folders.
  const marker = path.join(destination, '.incomplete.json');
  await fs.writeFile(marker, JSON.stringify({ id: randomUUID(), status: 'incomplete' }), {
    flag: 'wx',
  });
  const roots: string[] = [];
  for (const entry of plan.cases) {
    const directory = path.join(destination, entry.name);
    await fs.mkdir(directory);
    for (const [relative, text] of entry.files) {
      const target = path.resolve(directory, relative);
      if (!target.startsWith(path.resolve(directory) + path.sep))
        throw Error(t('sweep.destination'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, text, { encoding: 'utf8', flag: 'wx' });
    }
    roots.push(path.join(directory, entry.main));
  }
  await fs.writeFile(
    path.join(destination, 'sweep-manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        baseline: plan.root,
        createdAt: new Date().toISOString(),
        dimensions: plan.dimensions,
        sharedResources: plan.shared,
        cases: plan.cases.map((entry, i) => ({
          name: entry.name,
          values: entry.values,
          main: path.relative(destination, roots[i]),
        })),
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  await fs.unlink(marker);
  return roots;
}
