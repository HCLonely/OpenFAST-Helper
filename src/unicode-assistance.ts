import { lex } from './parser';
import { textSnapshot } from './editor-snapshot';
import { findEntry } from './catalog';
import { t } from './i18n';
export function unicodeIssues(text: string) {
  const snapshot = textSnapshot(text),
    result = [];
  for (let line = 0; line < snapshot.lines.length; line++) {
    const source = snapshot.lines[line],
      scan = lex(source);
    const desc = source.search(/\s[-–]\s/),
      end = Math.min(scan.commentStart, desc < 0 ? source.length : desc);
    const code = source.slice(0, end);
    if (
      !snapshot.tokensByLine.has(line) &&
      !lex(code.replace(/[\u200B-\u200D\uFEFF]/g, '')).items.some((i) =>
        findEntry(i.text, snapshot.parsed.module),
      )
    )
      continue;
    const quoted = [...code.matchAll(/"[^"\r\n]*"|'[^'\r\n]*'/g)].map((m) => [
      m.index,
      m.index + m[0].length,
    ]);
    const wrapper = /^[\s\uFEFF]*([“‘])(.+?)([”’])(?=\s+[A-Za-z]\w*(?:\(\d+\))?\b)/.exec(code);
    if (
      wrapper &&
      ((wrapper[1] === '“' && wrapper[3] === '”') || (wrapper[1] === '‘' && wrapper[3] === '’')) &&
      !/["']/.test(wrapper[2])
    ) {
      const start = code.indexOf(wrapper[1]),
        original = wrapper[1] + wrapper[2] + wrapper[3],
        q = wrapper[1] === '“' ? '"' : "'";
      result.push({
        line,
        start,
        end: start + original.length,
        original,
        replacement: q + wrapper[2] + q,
      });
      quoted.push([start, start + original.length]);
    }
    for (let i = 0; i < code.length; i++) {
      const char = code[i];
      if (
        !/[\u200B-\u200D\uFEFF\u3000\u2212\uFF0D\uFE63\u2018\u2019\u201C\u201D]/.test(char) ||
        (line === 0 && i === 0 && char === '\uFEFF')
      )
        continue;
      const inside = quoted.some(([a, b]) => i >= a && i < b);
      if (inside && !/[\u200B-\u200D\uFEFF]/.test(char)) continue;
      const replacement =
        !inside && char === '\u3000'
          ? ' '
          : !inside &&
              /[\u2212\uFF0D\uFE63]/.test(char) &&
              /\d|\./.test(code[i + 1] || '') &&
              (i === 0 || /\s/.test(code[i - 1]))
            ? '-'
            : undefined;
      result.push({ line, start: i, end: i + 1, original: char, replacement });
    }
  }
  return result;
}
import { currentRevision, replacementPaused } from './editor-input-state';
export function registerUnicodeAssistance(vscode, context) {
  const collection = vscode.languages.createDiagnosticCollection('openfast-unicode');
  context.subscriptions.push(collection);
  const timers = new Map();
  const enabled = (d) =>
    vscode.workspace.getConfiguration('openfast', d.uri).get('enableNumericAssistance', true);
  function schedule(doc) {
    if (doc.languageId !== 'openfast') return;
    const revision = doc.version;
    clearTimeout(timers.get(doc));
    timers.set(
      doc,
      setTimeout(() => {
        timers.delete(doc);
        if (!currentRevision(doc, revision)) return;
        if (replacementPaused(doc)) {
          schedule(doc);
          return;
        }
        if (doc.isClosed || !enabled(doc)) {
          collection.delete(doc.uri);
          return;
        }
        collection.set(
          doc.uri,
          unicodeIssues(doc.getText()).map((i) => {
            const d = new vscode.Diagnostic(
              new vscode.Range(i.line, i.start, i.line, i.end),
              t(
                'editor.unicodeCharacter',
                [...i.original]
                  .map((c) => 'U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'))
                  .join(' '),
              ),
              vscode.DiagnosticSeverity.Warning,
            );
            d.code = 'unicode-character';
            d.source = 'OpenFAST';
            return d;
          }),
        );
      }, 650),
    );
  }
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(schedule),
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
    vscode.workspace.onDidCloseTextDocument((d) => {
      clearTimeout(timers.get(d));
      timers.delete(d);
      collection.delete(d.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('openfast')) vscode.workspace.textDocuments.forEach(schedule);
    }),
    {
      dispose() {
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
      },
    },
  );
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { language: 'openfast' },
      {
        provideCodeActions(doc, selection) {
          if (!enabled(doc) || replacementPaused(doc, Date.now(), selection.start.line)) return [];
          return unicodeIssues(doc.getText())
            .filter(
              (i) =>
                i.replacement !== undefined &&
                i.line >= selection.start.line &&
                i.line <= selection.end.line,
            )
            .map((i) => {
              const a = new vscode.CodeAction(
                t('editor.repairUnicode'),
                vscode.CodeActionKind.QuickFix,
              );
              a.edit = new vscode.WorkspaceEdit();
              a.edit.replace(
                doc.uri,
                new vscode.Range(i.line, i.start, i.line, i.end),
                i.replacement,
              );
              return a;
            });
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );
  vscode.workspace.textDocuments.forEach(schedule);
}
