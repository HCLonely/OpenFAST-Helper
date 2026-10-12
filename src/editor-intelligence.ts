import { documentSnapshot, textSnapshot } from './editor-snapshot';
import { tableReferenceChoices } from './editor-context';
import { findEntry, catalog } from './catalog';
import { correctedNames } from './editor-rules';
import { applicability, dependencyRules } from './parser';
import { expandedFields } from './table-layout';
import { versionIssues } from './versions';
import { t, localizeApplicability } from './i18n';
import { currentRevision } from './editor-input-state';

const pending = new WeakMap<object, () => any>();
// A module with no dedicated dictionary cannot support meaningful spelling feedback.
const documentedModules = new Set(catalog.parameters.map((entry) => entry.module));
export function deferDocumentation(item, build, document?) {
  const revision = document?.version;
  pending.set(item, () => (!document || currentRevision(document, revision) ? build() : undefined));
  return item;
}
export function resolveDocumentation(item, token?) {
  if (token?.isCancellationRequested) return item;
  const build = pending.get(item);
  if (build) {
    item.documentation = build();
    pending.delete(item);
  }
  return item;
}
export function candidateState(parsed, name: string, profile?) {
  const condition = applicability(parsed, name);
  const inactive = /此参数所属选项未启用/.test(condition);
  const warnings = versionIssues(
    { module: parsed.module, parameters: new Map(), records: [{ name, line: 0 }] },
    profile,
  ).filter((i) => i.code === 'version-field');
  return {
    inactive,
    rank: (inactive ? 1 : 0) + (warnings.length ? 2 : 0),
    detail: [inactive ? localizeApplicability(condition) : '', ...warnings.map((w) => w.message)]
      .filter(Boolean)
      .join(' · '),
    deprecated: warnings.some((w) => profile?.major >= 5 && w.code === 'version-field'),
  };
}
/** Local spelling only, no numeric conversion or whole-document formatting. */
export function localStyle(text: string, line: number) {
  const { parsed, lines } = textSnapshot(text);
  const nearest = [...parsed.records].sort(
    (a, b) => Math.abs(a.line - line) - Math.abs(b.line - line),
  );
  const bool = nearest.find((r) => /^(true|false)$/i.test(r.value))?.value;
  const quoteLines = new Set([
    ...parsed.records.map((r) => r.line),
    ...parsed.tokens.filter((t) => t.kind === 'output').map((t) => t.line),
  ]);
  const quote =
    [...quoteLines]
      .sort((a, b) => Math.abs(a - line) - Math.abs(b - line))
      .map((i) => /^\s*(["'])/.exec(lines[i])?.[1])
      .find(Boolean) || '"';
  const path =
    nearest.find((r) => /File|Names|Root/i.test(r.name) && /[\\/]/.test(r.value))?.value || '';
  return {
    boolCase: !bool
      ? 'title'
      : bool === bool?.toUpperCase()
        ? 'upper'
        : bool === bool?.toLowerCase()
          ? 'lower'
          : 'title',
    quote,
    separator: path.includes('\\') ? '\\' : path.includes('/') ? '/' : undefined,
  };
}
export function styledValue(value: string, style) {
  if (!/^(true|false)$/i.test(value)) return value;
  return style.boolCase === 'upper'
    ? value.toUpperCase()
    : style.boolCase === 'lower'
      ? value.toLowerCase()
      : value[0].toUpperCase() + value.slice(1).toLowerCase();
}
export { normalizedOutput } from './output-names';

const relations = new WeakMap<object, ReturnType<typeof buildRelations>>();
function buildRelations(snapshot: ReturnType<typeof textSnapshot>) {
  const groups = new Map<
    string,
    { line: number; start: number; end: number; definition: boolean }[]
  >();
  const missing = [];
  // Resolve each field/geometry once per table rather than rebuilding definition sets per row.
  for (const table of snapshot.tables) {
    const cache = new Map();
    for (const row of table.rows) {
      const fields = expandedFields(table.headers, row.cells, table.units);
      for (let col = 0; col < Math.min(row.cells.length, fields.length); col++) {
        const cell = row.cells[col];
        if (!cell) continue;
        const geometry = row.cells[table.headers.indexOf('MSecGeom')]?.text || '';
        const cacheKey = fields[col].name + ':' + geometry;
        if (!cache.has(cacheKey))
          cache.set(cacheKey, tableReferenceChoices(snapshot.text, row.line, cell.start));
        const where = cache.get(cacheKey);
        if (!where?.resolved) continue;
        const choice = where.choices.find((c) => c.value === cell.text);
        if (!choice) {
          if (cell.text !== '0' || where.field === 'LineType')
            missing.push({
              line: row.line,
              start: cell.start,
              end: cell.end,
              name: cell.text,
              field: where.field,
            });
          continue;
        }
        const key = choice.definitions
          .map((d) => d.line + ':' + d.start)
          .sort()
          .join('|');
        if (!groups.has(key))
          groups.set(
            key,
            choice.definitions.map((d) => ({ ...d, definition: true })),
          );
        groups
          .get(key)
          .push({ line: row.line, start: cell.start, end: cell.end, definition: false });
      }
    }
  }
  // HydroDyn's scalar joint-output list refers to the structural joint table.
  if (snapshot.parsed.module === 'HydroDyn') {
    const definitions = snapshot.tables.filter(
      (table) =>
        table.headers[0] === 'JointID' && table.headers.some((f) => /^Joint[xyz]i$/i.test(f)),
    );
    for (const cell of snapshot.parsed.tokens.filter(
      (c) => c.kind === 'value' && c.name === 'JOutLst',
    )) {
      const value = snapshot.lines[cell.line].slice(cell.start, cell.end);
      const matching = definitions.flatMap((table) =>
        table.rows
          .filter((r) => r.cells[0]?.text === value)
          .map((r) => ({
            line: r.line,
            start: r.cells[0].start,
            end: r.cells[0].end,
            definition: true,
          })),
      );
      if (!matching.length) {
        if (definitions.length && value !== '0')
          missing.push({
            line: cell.line,
            start: cell.start,
            end: cell.end,
            name: value,
            field: 'JOutLst',
          });
        continue;
      }
      const key = matching
        .map((d) => d.line + ':' + d.start)
        .sort()
        .join('|');
      if (!groups.has(key)) groups.set(key, matching);
      groups
        .get(key)
        .push({ line: cell.line, start: cell.start, end: cell.end, definition: false });
    }
  }
  return { groups: [...groups.values()], missing };
}
export function symbolRelations(text: string) {
  const snapshot = textSnapshot(text);
  if (!relations.has(snapshot)) relations.set(snapshot, buildRelations(snapshot));
  return relations.get(snapshot);
}
export function linkedSymbols(text: string, line: number, character: number) {
  return (
    symbolRelations(text).groups.find((group) =>
      group.some((c) => c.line === line && c.start <= character && character < c.end),
    ) || []
  );
}
export function tokenFeedback(text: string) {
  const snapshot = textSnapshot(text);
  const issues = symbolRelations(text).missing.map((c) => ({
    ...c,
    severity: 'warning',
    code: 'undefined-table-reference',
    message: t('editor.undefinedReference', c.field, c.name),
  }));
  for (const token of snapshot.parsed.tokens) {
    if (
      token.kind !== 'parameter' ||
      !documentedModules.has(snapshot.parsed.module) ||
      token.name === 'OutList' ||
      findEntry(token.name, snapshot.parsed.module)
    )
      continue;
    const correction = correctedNames(snapshot.parsed.module, token.name).find((c) => c.rank <= 4);
    issues.push({
      ...token,
      severity: 'information',
      code: 'unknown-parameter',
      message: correction
        ? t('editor.unknownCorrection', token.name, correction.name)
        : t('editor.unknownParameter', token.name),
    } as any);
  }
  return issues;
}
export function registerSymbolAssistance(vscode, context) {
  context.subscriptions.push(
    vscode.languages.registerDocumentHighlightProvider(
      { language: 'openfast' },
      {
        provideDocumentHighlights(document, position, token) {
          if (token?.isCancellationRequested) return [];
          const snapshot = documentSnapshot(document);
          const control = snapshot.parsed.tokens.find(
            (t) =>
              t.kind === 'parameter' &&
              t.line === position.line &&
              t.start <= position.character &&
              position.character < t.end,
          );
          const dependents = control
            ? snapshot.parsed.tokens.filter(
                (t) =>
                  t.kind === 'parameter' &&
                  dependencyRules(snapshot.parsed, t.name).some(
                    (r) => r[0].toLowerCase() === control.name.toLowerCase(),
                  ),
              )
            : [];
          const linked = dependents.length
            ? [
                { ...control, definition: true },
                ...dependents.map((t) => ({ ...t, definition: false })),
              ]
            : linkedSymbols(documentSnapshot(document).text, position.line, position.character);
          return linked.map(
            (cell) =>
              new vscode.DocumentHighlight(
                new vscode.Range(cell.line, cell.start, cell.line, cell.end),
                cell.definition
                  ? vscode.DocumentHighlightKind.Write
                  : vscode.DocumentHighlightKind.Read,
              ),
          );
        },
      },
    ),
  );
}
