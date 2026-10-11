import { documentSnapshot, textSnapshot } from './editor-snapshot';
import { linkedSymbols } from './editor-intelligence';
import { tableColumn } from './editor-context';
import { definitionField } from './editor-rename';
export function navigationSymbols(text: string, line: number, character: number) {
  let cells = linkedSymbols(text, line, character);
  if (!cells.length) {
    const snapshot = textSnapshot(text),
      where = tableColumn(text, line, character);
    if (
      where?.cell &&
      line !== where.table.line &&
      where.cell.start <= character &&
      character < where.cell.end &&
      definitionField(where.table, snapshot.parsed.module) === where.field
    )
      cells = [{ line, start: where.cell.start, end: where.cell.end, definition: true }];
  }
  const seen = new Set();
  return cells.filter((c) => {
    const key = c.line + ':' + c.start;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function registerNavigationAssistance(vscode, context) {
  const selector = { language: 'openfast' };
  const locations = (document, position, token, definitionsOnly, includeDeclaration = true) => {
    if (token?.isCancellationRequested) return [];
    return navigationSymbols(documentSnapshot(document).text, position.line, position.character)
      .filter((c) => (definitionsOnly ? c.definition : includeDeclaration || !c.definition))
      .map(
        (c) => new vscode.Location(document.uri, new vscode.Range(c.line, c.start, c.line, c.end)),
      );
  };
  if (vscode.languages.registerDefinitionProvider)
    context.subscriptions.push(
      vscode.languages.registerDefinitionProvider(selector, {
        provideDefinition: (d, p, t) => locations(d, p, t, true),
      }),
    );
  if (vscode.languages.registerReferenceProvider)
    context.subscriptions.push(
      vscode.languages.registerReferenceProvider(selector, {
        provideReferences: (d, p, c, t) => locations(d, p, t, false, c.includeDeclaration),
      }),
    );
}
