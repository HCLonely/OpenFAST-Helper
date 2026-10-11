import { textSnapshot, documentSnapshot } from './editor-snapshot';
import { linkedSymbols, symbolRelations } from './editor-intelligence';
import { tableColumn } from './editor-context';
import { replacementPaused, currentRevision } from './editor-input-state';
import { t } from './i18n';

/** Only structural definition tables, never coefficient/output tables with the same ID header. */
export function definitionField(table, module: string): string | undefined {
  const h = table.headers;
  if (module === 'MoorDyn') {
    if (h[0] === 'Name' && h.includes('Diam')) return 'Name';
    if (h[0] === 'ID' && h.includes('Attachment')) return 'ID';
    if (h[0] === 'Line' && h.includes('NumSegs')) return 'Line';
  }
  if (['HydroDyn', 'SubDyn'].includes(module)) {
    if (h[0] === 'JointID' && h.some((v) => /^Joint[xyz]i$/i.test(v))) return 'JointID';
    if (h[0] === 'MemberID' && h.includes('MJointID1')) return 'MemberID';
    if (
      ['PropSetID', 'MPropSetID', 'AxCoefID', 'DpthID'].includes(h[0]) &&
      !h.includes('MJointID1')
    )
      return h[0];
  }
}
export function renameEdits(text: string, line: number, character: number, name?: string) {
  const snapshot = textSnapshot(text),
    where = tableColumn(text, line, character);
  let linked = linkedSymbols(text, line, character);
  if (
    !linked.length &&
    (!where?.cell ||
      line === where.table.line ||
      character < where.cell.start ||
      character >= where.cell.end)
  )
    throw new Error(t('editor.renameUnsupported'));
  let definitions = linked.filter((c) => c.definition);
  if (
    !definitions.length &&
    where &&
    definitionField(where.table, snapshot.parsed.module) === where.field
  ) {
    definitions = [{ line, start: where.cell.start, end: where.cell.end, definition: true }];
    linked = definitions;
  }
  if (definitions.length !== 1) throw new Error(t('editor.renameAmbiguous'));
  const definition = definitions[0],
    table = snapshot.tableByLine.get(definition.line);
  const field = table && definitionField(table, snapshot.parsed.module);
  if (!field) throw new Error(t('editor.renameUnsupported'));
  const original = snapshot.lines[definition.line].slice(definition.start, definition.end);
  if (field === 'Name' ? !/^[A-Za-z][\w.-]*$/.test(original) : !/^[1-9]\d*$/.test(original))
    throw new Error(t('editor.renameUnsupported'));
  const family = snapshot.tables.filter(
    (candidate) => definitionField(candidate, snapshot.parsed.module) === field,
  );
  const cells = family.flatMap((candidate) =>
    candidate.rows.map((r) => r.cells[0]).filter(Boolean),
  );
  const equal = (left, right) =>
    field === 'Name' ? left.toLowerCase() === right.toLowerCase() : Number(left) === Number(right);
  if (cells.filter((c) => equal(c.text, original)).length !== 1)
    throw new Error(t('editor.renameAmbiguous'));
  if (
    symbolRelations(text).missing.some(
      (c) => (field !== 'Name' || c.field === 'LineType') && equal(c.name, original),
    )
  )
    throw new Error(t('editor.renameAmbiguous'));
  if (name !== undefined) {
    if (
      field === 'Name'
        ? !/^[A-Za-z][\w.-]*$/.test(name)
        : !/^[1-9]\d*$/.test(name) || !Number.isSafeInteger(Number(name))
    )
      throw new Error(t('editor.renameInvalid'));
    if (name !== original && cells.some((c) => equal(c.text, name)))
      throw new Error(t('editor.renameCollision', name));
  }
  const seen = new Set();
  return linked
    .filter((c) => {
      const key = c.line + ':' + c.start;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((c) => ({ ...c, value: name ?? original }))
    .sort((a, b) => a.line - b.line || a.start - b.start);
}
export function registerRenameAssistance(vscode, context) {
  if (!vscode.languages.registerRenameProvider) return;
  const range = (c) => new vscode.Range(c.line, c.start, c.line, c.end);
  context.subscriptions.push(
    vscode.languages.registerRenameProvider(
      { language: 'openfast' },
      {
        prepareRename(document, position, token) {
          if (
            token?.isCancellationRequested ||
            replacementPaused(document, Date.now(), position.line)
          )
            return;
          const edits = renameEdits(
            documentSnapshot(document).text,
            position.line,
            position.character,
          );
          const cell = edits.find(
            (c) =>
              c.line === position.line &&
              c.start <= position.character &&
              position.character < c.end,
          );
          return { range: range(cell), placeholder: cell.value };
        },
        provideRenameEdits(document, position, name, token) {
          if (
            token?.isCancellationRequested ||
            replacementPaused(document, Date.now(), position.line)
          )
            return;
          const revision = document.version;
          const edits = renameEdits(
            documentSnapshot(document).text,
            position.line,
            position.character,
            name,
          );
          if (!currentRevision(document, revision) || token?.isCancellationRequested) return;
          const edit = new vscode.WorkspaceEdit();
          for (const cell of edits)
            edit.replace(document.uri, range(cell), cell.value, {
              needsConfirmation: edits.length > 1,
              label: t('editor.renamePreview'),
            });
          return edit;
        },
      },
    ),
  );
}
