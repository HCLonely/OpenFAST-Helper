import { numericRepairs } from './editor-rules';
import { t } from './i18n';
import { currentRevision, replacementPaused } from './editor-input-state';

/** Delayed editing feedback; solver preflight continues to use strict validation. */
export function registerNumericAssistance(vscode, context) {
  const register = (value) => context.subscriptions.push(value);
  const diagnostics = vscode.languages.createDiagnosticCollection('openfast-numeric-format');
  const timers = new Map();
  register(diagnostics);
  const enabled = (document) =>
    vscode.workspace
      .getConfiguration('openfast', document.uri)
      .get('enableNumericAssistance', true);
  function schedule(document) {
    if (document?.languageId !== 'openfast') return;
    const key = document.uri.toString();
    const revision = document.version;
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        if (!currentRevision(document, revision)) return;
        if (replacementPaused(document)) {
          schedule(document);
          return;
        }
        if (document.isClosed || !enabled(document)) {
          diagnostics.delete(document.uri);
          return;
        }
        const active = new Set<number>();
        for (const editor of vscode.window.visibleTextEditors)
          if (editor.document === document) {
            for (const selection of editor.selections || [editor.selection])
              active.add(selection.active.line);
          }
        diagnostics.set(
          document.uri,
          numericRepairs(document.getText(), active).map((repair) => {
            const diagnostic = new vscode.Diagnostic(
              new vscode.Range(repair.line, repair.start, repair.line, repair.end),
              repair.replacement
                ? t('editor.numericComma')
                : t('editor.numericInvalid', repair.original),
              vscode.DiagnosticSeverity.Warning,
            );
            diagnostic.source = 'OpenFAST';
            diagnostic.code = 'numeric-format';
            return diagnostic;
          }),
        );
      }, 650),
    );
  }
  register(vscode.workspace.onDidChangeTextDocument((event) => schedule(event.document)));
  register(vscode.workspace.onDidOpenTextDocument(schedule));
  register(
    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = document.uri.toString();
      clearTimeout(timers.get(key));
      timers.delete(key);
      diagnostics.delete(document.uri);
    }),
  );
  register(
    vscode.window.onDidChangeTextEditorSelection((event) => schedule(event.textEditor.document)),
  );
  register(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('openfast')) vscode.workspace.textDocuments.forEach(schedule);
    }),
  );
  register(
    vscode.languages.registerCodeActionsProvider(
      { language: 'openfast' },
      {
        provideCodeActions(document, selection) {
          if (!enabled(document) || replacementPaused(document, Date.now(), selection.start.line))
            return [];
          return numericRepairs(document.getText())
            .filter(
              (repair) =>
                repair.replacement !== undefined &&
                repair.line >= selection.start.line &&
                repair.line <= selection.end.line,
            )
            .map((repair) => {
              const action = new vscode.CodeAction(
                t('editor.repairComma'),
                vscode.CodeActionKind.QuickFix,
              );
              action.diagnostics = diagnostics
                .get?.(document.uri)
                ?.filter(
                  (d) =>
                    d.code === 'numeric-format' &&
                    d.range.start.line === repair.line &&
                    d.range.start.character === repair.start,
                );
              action.edit = new vscode.WorkspaceEdit();
              action.edit.replace(
                document.uri,
                new vscode.Range(repair.line, repair.start, repair.line, repair.end),
                repair.replacement,
              );
              return action;
            });
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );
  register({
    dispose() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  });
  vscode.workspace.textDocuments.forEach(schedule);
}
