import { findEntry } from './catalog';
import { dependencyRules, parseDocument } from './parser';
import { number } from './analysis';
import type { DiagnosticIssue } from './types';

/** Lexicographic key for VS Code sortText. Do not convert IDs to floating point. */
export function naturalSortKey(value: string): string {
  return value.toLowerCase().replace(/\d+/g, (raw) => {
    const digits = raw.replace(/^0+(?=\d)/, '');
    return (
      '#' +
      String(digits.length).padStart(10, '0') +
      ':' +
      digits +
      ':' +
      String(raw.length).padStart(10, '0') +
      '#'
    );
  });
}

export function candidateLabel(value: string, summary: string) {
  const text = (summary || '').replace(/\s+/g, ' ').trim();
  return { label: value, description: text.length > 80 ? text.slice(0, 79) + '…' : text };
}

/** Units are displayed only when the offline catalog explicitly labels one. */
export function scalarUnit(name: string, module: string): string {
  const description = findEntry(name, module)?.description || '';
  return description.match(/单位\s+([A-Za-z°][A-Za-z0-9°·/²³^()−-]*)(?=[，。；、\s]|$)/)?.[1] || '';
}

export function outputCategory(
  name: string,
): 'motion' | 'loads' | 'environment' | 'control' | 'other' {
  if (
    /^(?:Ptfm(?:Surge|Sway|Heave|Roll|Pitch|Yaw)|(?:OoPDefl|IPDefl|TwstDefl)\d+|TTDsp(?:FA|SS)|NacYaw|YawBrTD[xy]t|TwHt\d+TP[xy]i|NcIMUTA[xyz]s|Azimuth|RotSpeed)$/i.test(
      name,
    )
  )
    return 'motion';
  if (
    /^(?:Root[FM][xyz]b\d+|TwrBs[FM][xyz]t|LSSGagM[yz]a|LSSTipM[yz]s|LSShftF[yz]s|Hydro[FM][xyz]i|YawBr[FM][xyz]p|RotThrust|RotTorq|FairTen\d+|AnchTen\d+)$/i.test(
      name,
    )
  )
    return 'loads';
  if (/^(?:Wave\d+Elev|Wind\d+Vel[XYZ])$/i.test(name)) return 'environment';
  if (/^(?:Gen(?:Pwr|Tq|Speed)|BldPitch\d*|Yaw(?:Pzn|BrTDxp))$/i.test(name)) return 'control';
  return 'other';
}

/** Preserve unrelated rule classes; suppress only derivative feedback at the same cell. */
export function prioritizeDiagnostics<T extends DiagnosticIssue>(issues: T[]): T[] {
  const cells = new Map<string, Set<string>>();
  for (const issue of issues) {
    if (issue.start === undefined || issue.end === undefined) continue;
    const key = `${issue.line}:${issue.start}:${issue.end}`;
    if (!cells.has(key)) cells.set(key, new Set());
    cells.get(key).add(issue.code);
  }
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const codes = cells.get(`${issue.line}:${issue.start}:${issue.end}`);
    const typed = codes?.has('table-field-type') || codes?.has('table-field-enum');
    if (
      typed &&
      ['undefined-table-reference', 'table-reference', 'table-type'].includes(issue.code)
    )
      return false;
    if (issue.code === 'table-columns' && codes?.has('table-extra-cell')) return false;
    const key = `${issue.line}:${issue.start}:${issue.end}:${issue.code}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function selectedCaseGraph(graphs, uri: string, activeRoot?: string) {
  const candidates = [...graphs].filter(
    (g) => g.nodes.has(uri) || g.edges.some((e) => e.to === uri),
  );
  return (
    candidates.find((g) => g.root === activeRoot) ||
    (candidates.length === 1 ? candidates[0] : undefined)
  );
}

/** Follow only unique, unchanged incoming file roles and confirmed controller records. */
export function controlSources(
  context,
  uri: string,
  readCurrent = (_uri: string): string | undefined => undefined,
) {
  const graph = context.graph;
  if (!graph) return [];
  const result = [];
  const visited = new Set<string>();
  let child = uri;
  for (let depth = 0; depth < 16 && !visited.has(child); depth++) {
    visited.add(child);
    const incoming = graph.edges.filter((edge) => edge.to === child && !edge.cycle);
    if (incoming.length !== 1) break;
    const edge = incoming[0];
    const node = graph.nodes.get(edge.from);
    if (!node) break;
    const parsed = parseDocument(readCurrent(edge.from) ?? node.text);
    const references = parsed.records.filter((r) => r.name === edge.parameter);
    const previous = node.parsed?.records.filter((r) => r.name === edge.parameter) || [];
    if (
      references.length !== 1 ||
      previous.length !== 1 ||
      references[0].value !== previous[0].value
    )
      break;
    for (const [name, choices] of dependencyRules(parsed, edge.parameter)) {
      const records = parsed.records.filter((r) => r.name === name);
      if (records.length !== 1) continue;
      const record = records[0];
      const value = record.value.replace(/^["']|["']$/g, '').toLowerCase();
      if (!/^(?:true|false)$/.test(value) && !Number.isFinite(number(value))) continue;
      result.push({
        uri: edge.from,
        line: record.line,
        name,
        value: record.value,
        role: edge.parameter,
        active: choices
          ? choices.some(
              (choice) =>
                choice === value ||
                (Number.isFinite(number(choice)) && number(choice) === number(value)),
            )
          : number(value) > 0,
      });
    }
    child = edge.from;
  }
  return result;
}
