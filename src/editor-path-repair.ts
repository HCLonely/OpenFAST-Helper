import * as path from 'node:path';
import { pathContext, pathRank } from './editor-context';
import { editDistance } from './editor-rules';
import { detectModule } from './parser';
import { t } from './i18n';
import { naturalSortKey } from './editor-presentation';
import { canReadReference } from './reference-access';
import { currentRevision, replacementPaused } from './editor-input-state';

export const pathModules = {
  EDFile: 'ElastoDyn',
  HydroFile: 'HydroDyn',
  AeroFile: 'AeroDyn',
  ServoFile: 'ServoDyn',
  SeaStFile: 'SeaState',
  MooringFile: 'MoorDyn',
  InflowFile: 'InflowWind',
  BDBldFile: 'BeamDyn',
};
export function alternativeNameScore(original: string, candidate: string) {
  const base = path.posix.basename(original.replace(/\\/g, '/')).toLowerCase();
  const name = path.posix.basename(candidate.replace(/\\/g, '/')).toLowerCase();
  if (base === name) return 0;
  if (path.posix.extname(base) !== path.posix.extname(name)) return undefined;
  if (base.length > 1024 || name.length > 1024 || Math.abs(base.length - name.length) > 3)
    return undefined;
  const distance = editDistance(base, name);
  return distance <= Math.min(3, Math.max(1, Math.floor(base.length / 4)))
    ? distance + 1
    : undefined;
}

/** Search the current directory and two levels below it, plus already known case references. */
export async function pathAlternatives(vscode, document, where, caseContext, token?) {
  const revision = document.version;
  const fresh = () => currentRevision(document, revision) && !token?.isCancellationRequested;
  const base = vscode.Uri.joinPath(document.uri, '..');
  const files = new Map<string, { uri: any; referenced: boolean }>();
  let limited = false,
    directories = 0,
    entries = 0;
  for (const ref of (caseContext.references || []).slice(0, 300)) {
    const uri = vscode.Uri.parse(ref);
    if (uri.scheme === document.uri.scheme && uri.authority === document.uri.authority)
      files.set(uri.toString(), { uri, referenced: true });
  }
  const queue = [{ uri: base, depth: 0 }];
  while (queue.length && directories < 24 && entries < 600 && fresh()) {
    const folder = queue.shift();
    if (!canReadReference(vscode.workspace, folder.uri)) continue;
    directories++;
    let children;
    try {
      children = await vscode.workspace.fs.readDirectory(folder.uri);
    } catch {
      continue;
    }
    for (const [name, type] of children) {
      if (++entries > 600) {
        limited = true;
        break;
      }
      if (type & vscode.FileType.SymbolicLink || name.startsWith('.')) continue;
      const uri = vscode.Uri.joinPath(folder.uri, name);
      if (type & vscode.FileType.Directory) {
        if (folder.depth < 2) queue.push({ uri, depth: folder.depth + 1 });
      } else if (type & vscode.FileType.File)
        files.set(uri.toString(), {
          uri,
          referenced: files.get(uri.toString())?.referenced || false,
        });
    }
  }
  limited ||= queue.length > 0 || entries >= 600;
  if (!fresh()) return { candidates: [], limited, directories, entries };
  const expected = pathModules[where.name.replace(/\(\d+\)|\d+$/g, '')];
  const rootName = ['PotFile', 'FilenameRoot'].includes(where.name);
  const ranked = [...files.values()]
    .flatMap((item) => {
      const uriPath = item.uri.path;
      if (
        where.name === 'FilenameRoot' ? !/\.wnd$/i.test(uriPath) : pathRank(where.name, uriPath) > 1
      )
        return [];
      const clean = rootName
        ? uriPath.replace(where.name === 'PotFile' ? /\.(?:hst|1)$/i : /\.wnd$/i, '')
        : uriPath;
      const score = alternativeNameScore(where.path, clean);
      return score === undefined ? [] : [{ ...item, clean, score }];
    })
    .sort(
      (a, b) =>
        a.score - b.score ||
        Number(b.referenced) - Number(a.referenced) ||
        naturalSortKey(a.clean).localeCompare(naturalSortKey(b.clean), 'en'),
    )
    .slice(0, 24);
  const seen = new Set<string>(),
    candidates = [];
  for (const item of ranked) {
    if (!canReadReference(vscode.workspace, item.uri)) continue;
    if (!fresh()) return { candidates: [], limited, directories, entries };
    let stat;
    try {
      stat = await vscode.workspace.fs.stat(item.uri);
    } catch {
      continue;
    }
    if (!(stat.type & vscode.FileType.File)) continue;
    let module = '';
    if (expected && stat.size <= 131072) {
      try {
        const open = vscode.workspace.textDocuments.find(
          (d) => !d.isClosed && d.uri.toString() === item.uri.toString(),
        );
        module =
          detectModule(
            open
              ? open.getText()
              : Buffer.from(await vscode.workspace.fs.readFile(item.uri)).toString('utf8'),
          ) || '';
      } catch {
        /* unreadable or unknown headers are explicitly unverified */
      }
    }
    const relative = path.posix.relative(base.path, item.clean);
    const replacement = relative.replace(/\//g, where.separator);
    const quote = where.quote;
    if (
      !replacement ||
      (quote && replacement.includes(quote)) ||
      (!quote && /\s/.test(replacement)) ||
      seen.has(replacement)
    )
      continue;
    seen.add(replacement);
    const mismatch = !!(expected && module && module !== expected);
    candidates.push({
      uri: item.uri,
      replacement,
      score: item.score + (mismatch ? 10 : 0),
      referenced: item.referenced,
      module,
      expected,
      detail: mismatch
        ? t('editor.pathMismatch', expected, module)
        : module
          ? t('editor.pathModule', module)
          : t('editor.pathUnverified'),
    });
  }
  return {
    candidates: fresh()
      ? candidates.sort((a, b) => a.score - b.score || Number(b.referenced) - Number(a.referenced))
      : [],
    limited,
    directories,
    entries,
  };
}

export async function repairMissingPath(vscode, document, position, caseContext, token?) {
  if (document.uri.scheme !== 'file' || replacementPaused(document, Date.now(), position.line))
    return false;
  const where = pathContext(document.getText(), position.line, position.character);
  if (!where || !where.path) return false;
  const revision = document.version;
  const normalized = where.path.replace(/\\/g, '/');
  const current =
    /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')
      ? vscode.Uri.file(normalized)
      : normalized.startsWith('/')
        ? document.uri.with({ path: normalized })
        : vscode.Uri.joinPath(document.uri, '..', normalized);
  const existing =
    where.name === 'PotFile'
      ? current.with({ path: current.path + '.hst' })
      : where.name === 'FilenameRoot'
        ? current.with({ path: current.path + '.wnd' })
        : current;
  if (!canReadReference(vscode.workspace, existing)) return false;
  try {
    await vscode.workspace.fs.stat(existing);
    void vscode.window.showInformationMessage(t('editor.pathExists'));
    return false;
  } catch {
    /* missing */
  }
  const result = await pathAlternatives(vscode, document, where, caseContext, token);
  if (!currentRevision(document, revision) || token?.isCancellationRequested) return false;
  if (!result.candidates.length) {
    void vscode.window.showInformationMessage(
      t('editor.noPathAlternatives', result.limited ? t('editor.searchLimited') : ''),
    );
    return false;
  }
  const selected = await vscode.window.showQuickPick(
    result.candidates.map((c) => ({
      label: c.replacement,
      description: c.referenced ? t('editor.pathUsed') : c.detail,
      detail: `${where.value} → ${where.quote}${c.replacement}${where.quote} · ${c.detail}`,
      candidate: c,
    })),
    {
      title: t('editor.reviewPathAlternatives', result.limited ? t('editor.searchLimited') : ''),
      matchOnDescription: true,
    },
  );
  if (
    !selected ||
    !currentRevision(document, revision) ||
    token?.isCancellationRequested ||
    replacementPaused(document, Date.now(), position.line)
  )
    return false;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(position.line, where.start, position.line, where.end),
    where.quote + selected.candidate.replacement + where.quote,
  );
  return vscode.workspace.applyEdit(edit);
}
