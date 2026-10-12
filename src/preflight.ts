import { t } from './i18n';

function graphKeys(graph): string[] {
  if (!graph) return [];
  return [
    ...graph.nodes.keys(),
    ...graph.edges.filter((edge) => edge.active).map((edge) => edge.to),
  ];
}

/** Follow fresh references and document revisions throughout asynchronous validation. */
export async function prepareCase(vscode, workbench, uri): Promise<boolean> {
  const strict =
    vscode.workspace.getConfiguration?.('openfast', uri)?.get('strictPreflight', false) ?? false;
  if (strict && (!workbench?.graphFor || !workbench?.checkRoot)) {
    throw Error(t('runChecks.validatorMissing'));
  }
  const root = await vscode.workspace.openTextDocument(uri);
  // Explicitly opting out of strict validation retains the legacy integration contract.
  if (!workbench) {
    if (root.isDirty && !(await root.save())) throw Error(t('runner.saveFailed'));
    return true;
  }
  for (let pass = 0; pass < 8; pass++) {
    // Capture all open documents so references discovered by validation also have a baseline.
    const before = new Map<string, { document: any; version: number }>(
      vscode.workspace.textDocuments.map((document) => [
        document.uri.toString(),
        { document, version: document.version },
      ]),
    );
    const graph = await workbench.graphFor(uri, true);
    if (!graph) continue;
    const related = new Set([uri.toString(), ...graphKeys(graph)]);
    const changed = () => {
      const current = new Map<string, any>(
        vscode.workspace.textDocuments.map((document) => [document.uri.toString(), document]),
      );
      for (const key of related) {
        const old = before.get(key);
        const document = current.get(key);
        if (old?.document !== document || old?.version !== document?.version) return true;
      }
      return false;
    };
    const dirtyDocuments = () =>
      vscode.workspace.textDocuments.filter(
        (document) => document.isDirty && related.has(document.uri.toString()),
      );
    if (changed()) continue;
    const dirty = dirtyDocuments();
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
    const result = await workbench.checkRoot(uri, true, true);
    if (!result) continue;
    let discovered = false;
    for (const key of graphKeys(result.graph)) {
      if (!related.has(key)) discovered = true;
      related.add(key);
    }
    if (discovered || changed() || dirtyDocuments().length) continue;
    const incomplete = result.issues.some((issue) =>
      ['read-file', 'graph-limit'].includes(issue.code),
    );
    const errors = result.issues.filter((issue) => issue.severity === 'error');
    const warnings = result.issues.filter((issue) => issue.severity === 'warning');
    if (incomplete || errors.length || (strict && warnings.length)) {
      await vscode.commands.executeCommand('workbench.actions.view.problems');
      throw Error(
        strict
          ? t('runChecks.strictBlocked', errors.length, warnings.length)
          : t('runChecks.blocked', errors.length),
      );
    }
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
    if (changed() || dirtyDocuments().length) continue;
    return true;
  }
  throw Error(t('runChecks.changed'));
}
