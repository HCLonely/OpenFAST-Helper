import { t } from './i18n';
import * as path from 'node:path';
import * as os from 'node:os';
const ICON_GROUPS = [
  {
    icon: 'openfast_config',
    source: 'openfast',
    extensions: ['fst', 'fstf', 'dat', 'ipt', 'bmi', 'sum', 'out', 'outb', 'lin', 'ech'],
  },
  {
    icon: 'turbsim_config',
    source: 'turbsim',
    extensions: ['inp', 'ctp', 'bts', 'wnd', 'hh', 'u', 'v', 'w', 'cts', 'twr'],
  },
  { icon: 'rosco_config', source: 'rosco', extensions: ['echo', 'dbg', 'dbg2', 'dbg3'] },
  { icon: 'rosco_config', source: 'rosco', extensions: ['discon.in'], filename: true },
];
const TARGETS = new Set(
  ICON_GROUPS.filter((group) => !group.filename).flatMap((group) => group.extensions),
);
const FILENAMES = new Set(['discon.in']);
function mergeAssociations(previous) {
  const result = [];
  for (const entry of previous || []) {
    if (!Array.isArray(entry.extensions)) {
      result.push(entry);
      continue;
    }
    const extensions = entry.extensions.filter((extension) => {
      const name = String(extension).toLowerCase().replace(/^\./, '');
      return (
        !(entry.filename && FILENAMES.has(name)) &&
        !TARGETS.has(entry.filename ? name.split('.').pop() : name)
      );
    });
    if (extensions.length || entry.extensions.length === 0) {
      result.push({ ...entry, extensions });
    }
  }
  result.push(
    ...ICON_GROUPS.map(({ source, ...group }) => ({ ...group, format: 'svg', light: true })),
  );
  return result;
}
async function enableFileIcons(vscode, context, silent = false) {
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
  for (const { icon, source } of ICON_GROUPS.filter((group) => !group.filename)) {
    for (const light of [false, true]) {
      const bytes = await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(
          context.extensionUri,
          'icons',
          `${source}-${light ? 'light' : 'dark'}.svg`,
        ),
      );
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(dir, `file_type_${light ? 'light_' : ''}${icon}.svg`),
        bytes,
      );
    }
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
  if (!silent) void vscode.window.showInformationMessage(t('icons.configured'));
  return true;
}
/** Upgrade workspaces that already opted into our icons, preserving the current theme. */
async function refreshExistingFileIcons(vscode, context) {
  const config = vscode.workspace.getConfiguration();
  if (config.get('workbench.iconTheme') !== 'vscode-icons') return false;
  const previous = config.get('vsicons.associations.files', []);
  if (!previous.some((entry) => entry.icon === 'openfast_config')) return false;
  if (JSON.stringify(previous) === JSON.stringify(mergeAssociations(previous))) return false;
  return enableFileIcons(vscode, context, true);
}
export { mergeAssociations, enableFileIcons, refreshExistingFileIcons };
