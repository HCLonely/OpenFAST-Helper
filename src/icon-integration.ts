import { t } from './i18n';
import * as path from 'node:path';
import * as os from 'node:os';
const TARGETS = new Set(['fst', 'dat']);
const ICON = 'openfast_config';
function mergeAssociations(previous) {
  const result = [];
  for (const entry of previous || []) {
    if (!Array.isArray(entry.extensions)) {
      result.push(entry);
      continue;
    }
    const extensions = entry.extensions.filter((extension) => {
      const name = String(extension).toLowerCase().replace(/^\./, '');
      return !TARGETS.has(entry.filename ? name.split('.').pop() : name);
    });
    if (extensions.length || entry.extensions.length === 0) {
      result.push({ ...entry, extensions });
    }
  }
  result.push({ icon: ICON, extensions: ['fst', 'dat'], format: 'svg', light: true });
  return result;
}
async function enableFileIcons(vscode, context) {
  const config = vscode.workspace.getConfiguration();
  if (config.get('workbench.iconTheme') !== 'vscode-icons') {
    void vscode.window.showInformationMessage(t('icons.unsupportedTheme'));
    return false;
  }
  const dependency = vscode.extensions.getExtension('vscode-icons-team.vscode-icons');
  if (!dependency) {
    throw new Error(t('icons.extensionMissing'));
  }
  await dependency.activate();
  const scope = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  const configured = config.get('vsicons.customIconFolderPath', '');
  let base = configured;
  if (!base) {
    base = path.join(context.globalStorageUri.fsPath, 'file-icons');
    if (
      process.platform === 'win32' &&
      path.parse(base).root.toLowerCase() !==
        path.parse(dependency.extensionPath).root.toLowerCase()
    ) {
      base = path.join(
        path.parse(dependency.extensionPath).root,
        'OpenFAST-VSCode-Icons',
        os.userInfo().username,
      );
    }
  } else if (!path.isAbsolute(base)) {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error(t('icons.relativePathWithoutWorkspace'));
    }
    base = path.resolve(folder.uri.fsPath, base);
  }
  if (
    process.platform === 'win32' &&
    path.parse(base).root.toLowerCase() !== path.parse(dependency.extensionPath).root.toLowerCase()
  ) {
    throw new Error(t('icons.differentDrives'));
  }
  const dir = vscode.Uri.file(path.join(base, 'vsicons-custom-icons'));
  await vscode.workspace.fs.createDirectory(dir);
  for (const [source, dest] of [
    ['openfast-dark.svg', `file_type_${ICON}.svg`],
    ['openfast-light.svg', `file_type_light_${ICON}.svg`],
  ]) {
    const bytes = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(context.extensionUri, 'icons', source),
    );
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, dest), bytes);
  }
  if (!configured) {
    await config.update('vsicons.customIconFolderPath', base, scope);
  }
  await config.update(
    'vsicons.associations.files',
    mergeAssociations(config.get('vsicons.associations.files', [])),
    scope,
  );
  await vscode.commands.executeCommand('vscode-icons.regenerateIcons');
  void vscode.window.showInformationMessage(t('icons.configured'));
  return true;
}
export { mergeAssociations, enableFileIcons };
