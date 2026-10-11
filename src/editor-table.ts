import { tableColumn } from './editor-context';
import { documentSnapshot } from './editor-snapshot';
import { tableFields, fieldType } from './table-layout';
import { t } from './i18n';
export function signatureView(fields, active: number, compact: boolean) {
  const indexed = fields.map((field, index) => ({ ...field, index }));
  const selected =
    compact && fields.length > 9
      ? indexed.filter(
          (f) => f.index === 0 || f.index === fields.length - 1 || Math.abs(f.index - active) <= 2,
        )
      : indexed;
  return {
    fields: selected,
    active: Math.max(
      0,
      selected.findIndex((f) => f.index === active),
    ),
    summary: fields.some((f) => f.count)
      ? t('editor.signatureList', fields.find((f) => f.count).count, active + 1, fields.length)
      : t('editor.signatureColumn', active + 1, fields.length),
  };
}
/** Definition columns only. Reference columns must never create IDs implicitly. */
export function unusedIds(table, field: string, module: string) {
  const permitted =
    module === 'MoorDyn'
      ? (field === 'ID' && table.headers.includes('Attachment')) ||
        (field === 'Line' && table.headers.includes('NumSegs'))
      : module === 'HydroDyn' || module === 'SubDyn'
        ? ['JointID', 'MemberID', 'PropSetID', 'MPropSetID', 'AxCoefID', 'DpthID'].includes(field)
        : false;
  if (!permitted || table.headers[0] !== field) return [];
  const used = new Set(
    table.rows.map((r) => Number(r.cells[0]?.text)).filter(Number.isSafeInteger),
  );
  const result = [];
  for (let id = 1; result.length < 5 && id <= used.size + 5; id++)
    if (!used.has(id)) result.push({ value: String(id), label: t('editor.unusedId', field) });
  return result;
}
export function registerTableAssistance(vscode, context) {
  context.subscriptions.push(
    vscode.languages.registerSignatureHelpProvider(
      { language: 'openfast' },
      {
        provideSignatureHelp(document, position, token) {
          if (
            token?.isCancellationRequested ||
            !vscode.workspace
              .getConfiguration('openfast', document.uri)
              .get('enableTableHints', true)
          )
            return;
          const snapshot = documentSnapshot(document),
            where = tableColumn(snapshot.text, position.line, position.character);
          if (!where || position.line === where.table.line) return;
          const row = where.table.rows.find((r) => r.line === position.line),
            fields = tableFields(where.table, row?.cells || []);
          const view = signatureView(
            fields,
            Math.min(where.column, fields.length - 1),
            vscode.workspace
              .getConfiguration('openfast', document.uri)
              .get('compactTableSignatures', true),
          );
          const labels = view.fields.map(
            (f) =>
              f.name +
              (f.element ? '[' + f.element + '/' + f.count + ']' : '') +
              ' : ' +
              t(('editor.type.' + fieldType(f.name)) as any) +
              (f.unit ? ' ' + f.unit : ''),
          );
          const signature = new vscode.SignatureInformation(labels.join(' | '));
          signature.documentation = view.summary;
          signature.parameters = labels.map(
            (label, i) =>
              new vscode.ParameterInformation(
                label,
                t(
                  'editor.tableParameter',
                  view.fields[i].index + 1,
                  view.fields[i].name,
                  view.fields[i].unit || t('table.seeHeader'),
                ),
              ),
          );
          const help = new vscode.SignatureHelp();
          help.signatures = [signature];
          help.activeSignature = 0;
          help.activeParameter = view.active;
          return help;
        },
      },
      ' ',
      '\t',
      ',',
    ),
  );
}
