import { t, descriptionFor } from './i18n';
import { lex } from './parser';
import { findEntry } from './catalog';
import { number } from './analysis';
function canonical(value) {
  return lex(String(value))
    .items.map((x) => {
      const s = x.text.replace(/^['"]|['"]$/g, '');
      if (/^(?:true|t)$/i.test(s)) {
        return 'true';
      }
      if (/^(?:false|f)$/i.test(s)) {
        return 'false';
      }
      const n = number(s);
      return Number.isFinite(n) ? String(n) : s.replace(/\\/g, '/');
    })
    .join(' ');
}
function byRole(graph) {
  const map = new Map();
  const queue = [{ uri: graph.root, role: t('tree.mainInput'), ancestors: new Set([graph.root]) }];
  let visits = 0;
  while (queue.length && visits++ < 1000) {
    const { uri, role, ancestors } = queue.shift();
    const node = graph.nodes.get(uri);
    if (!node) {
      continue;
    }
    map.set(role, node);
    for (const edge of graph.edges.filter(
      (e) => e.from === uri && e.active && e.isConfig && e.exists,
    )) {
      if (ancestors.has(edge.to)) {
        continue;
      }
      const next = new Set(ancestors);
      next.add(edge.to);
      queue.push({ uri: edge.to, role: role + '/' + edge.role, ancestors: next });
    }
  }
  return map;
}
function nodeValues(node) {
  const map = new Map();
  const counts = new Map();
  if (!node) {
    return map;
  }
  for (const e of node.parsed.records) {
    const index = (counts.get(e.name) || 0) + 1;
    counts.set(e.name, index);
    map.set('parameter:' + e.name + (index > 1 ? '#' + index : ''), {
      name: e.name,
      value: e.value,
      line: e.line,
      kind: 'parameter',
      description:
        descriptionFor({
          name: e.name,
          module: node.parsed.module,
          description: findEntry(e.name, node.parsed.module)?.description,
        }) ||
        e.original ||
        '',
    });
  }
  const outputs = node.parsed.tokens
    .filter((t) => t.kind === 'output')
    .map((t) => t.name)
    .sort((a, b) => a.localeCompare(b));
  if (outputs.length) {
    map.set('output:OutList', {
      name: 'OutList',
      value: outputs.join(', '),
      kind: 'output',
      description: t('report.outputDescription'),
    });
  }
  node.tables.forEach((table, index) =>
    map.set('table:' + index, {
      name: table.section || t('table.numberedTitle', index + 1),
      kind: 'table',
      value:
        table.headers.join(' ') +
        '\n' +
        table.rows.map((row) => row.cells.map((c) => canonical(c.text)).join(' ')).join('\n'),
      description: t('report.tableDescription'),
    }),
  );
  return map;
}
function compareGraphs(left, right) {
  const rows = [];
  const a = byRole(left);
  const b = byRole(right);
  for (const role of new Set([...a.keys(), ...b.keys()])) {
    const na = a.get(role);
    const nb = b.get(role);
    const va = nodeValues(na);
    const vb = nodeValues(nb);
    for (const key of new Set([...va.keys(), ...vb.keys()])) {
      const x = va.get(key);
      const y = vb.get(key);
      const normalized = (e) =>
        e.kind === 'table' ? e.value.split('\n').map(canonical).join('\n') : canonical(e.value);
      if (x && y && normalized(x) === normalized(y)) {
        continue;
      }
      const entry = x || y;
      rows.push({
        role,
        module: (na || nb).parsed.module,
        name: entry.name,
        kind: entry.kind,
        description: entry.description,
        left: x?.value,
        right: y?.value,
        leftUri: na?.uri,
        rightUri: nb?.uri,
        leftLine: x?.line,
        rightLine: y?.line,
      });
    }
  }
  return rows;
}
const escape = (s) =>
  String(s ?? t('common.missing'))
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
function comparisonMarkdown(rows, left = '', right = '') {
  const header = t('report.comparisonHeader', escape(left), escape(right), rows.length);
  if (!rows.length) {
    return header + t('report.noDifferences');
  }
  return (
    header +
    t('report.comparisonColumns') +
    rows
      .map(
        (r) =>
          `| ${escape(r.role)} | ${escape(r.name)} | ${escape(r.left)} | ${escape(r.right)} | ${escape(r.description)} |`,
      )
      .join('\n') +
    '\n'
  );
}
export { canonical, byRole, nodeValues, compareGraphs, comparisonMarkdown };
