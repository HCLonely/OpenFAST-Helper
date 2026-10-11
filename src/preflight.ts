import { t } from './i18n';

/** Follow fresh references after each save: saving can trigger formatters and change paths. */
export async function prepareCase(vscode, workbench, uri): Promise<boolean> {
  const root = await vscode.workspace.openTextDocument(uri);
  // Older integrations without a workbench retain the original single-file contract.
  if (!workbench) {
    if (root.isDirty && !(await root.save())) throw Error(t('runner.saveFailed'));
    return true;
  }
  for (let pass = 0; pass < 8; pass++) {
    const graph = await workbench.graphFor(uri, true);
    if (!graph) throw Error(t('runChecks.changed'));
    const related = new Set([
      uri.toString(),
      ...graph.nodes.keys(),
      ...graph.edges.filter((edge) => edge.active).map((edge) => edge.to),
    ]);
    const dirty = vscode.workspace.textDocuments.filter(
      (doc) => doc.isDirty && related.has(doc.uri.toString()),
    );
    if (dirty.length) {
      const action = await vscode.window.showWarningMessage(
        t('runChecks.dirty', dirty.map((doc) => doc.uri.fsPath).join('\n')),
        { modal: true },
        t('runChecks.save'),
      );
      if (action !== t('runChecks.save')) return false;
      for (const doc of dirty) {
        if (!(await doc.save())) throw Error(t('runner.saveFailed'));
      }
      continue;
    }
    const result = await workbench.checkRoot(uri, true);
    if (!result) throw Error(t('runChecks.changed'));
    const incomplete = result.issues.some((issue) =>
      ['read-file', 'graph-limit'].includes(issue.code),
    );
    const errors = result.issues.filter((issue) => issue.severity === 'error');
    if (incomplete || errors.length) {
      await vscode.commands.executeCommand('workbench.actions.view.problems');
      throw Error(t('runChecks.blocked', errors.length));
    }
    const warnings = result.issues.filter((issue) => issue.severity === 'warning');
    if (warnings.length) {
      const action = await vscode.window.showWarningMessage(
        t('runChecks.warnings', warnings.length),
        { modal: true },
        t('runChecks.continue'),
      );
      if (action !== t('runChecks.continue')) {
        await vscode.commands.executeCommand('workbench.actions.view.problems');
        return false;
      }
    }
    // Detect edits made during asynchronous checks or the warning dialog.
    if (
      vscode.workspace.textDocuments.some((doc) => doc.isDirty && related.has(doc.uri.toString()))
    )
      continue;
    return true;
  }
  throw Error(t('runChecks.changed'));
}
