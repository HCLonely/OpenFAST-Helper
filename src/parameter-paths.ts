/** Enumerated selectors can contain "File" without naming a filesystem path. */
export function isPathParameter(name: string, module?: string): boolean {
  if (/^(?:WindProfileType|CTEventFile|DLL_ProcName)$/i.test(name)) return false;
  if (module === 'TurbSim') return /^(?:UserFile|ProfileFile)$/i.test(name);
  return (
    !/^(?:Num|OutFile|DLL_ProcName)/i.test(name) &&
    /(?:File|AFNames|FilenameRoot|PotFile|BldFile|TwrFile)/i.test(name)
  );
}

/** TurbSim reads user files only for the corresponding spectrum/profile modes. */
export function turbSimFileActive(parsed, name: string): boolean {
  const value = (key: string) =>
    (
      parsed.parameters.get(key) ||
      [...parsed.parameters.values()].find(
        (entry) => entry.name.toLowerCase() === key.toLowerCase(),
      )
    )?.value
      .replace(/^["']|["']$/g, '')
      .trim()
      .toUpperCase();
  if (/^UserFile$/i.test(name)) {
    const model = value('TurbModel');
    return !model || ['USRINP', 'TIMESR'].includes(model);
  }
  if (/^ProfileFile$/i.test(name)) {
    const profile = value('WindProfileType');
    const model = value('TurbModel');
    return !profile || profile === 'USR' || model === 'USRVKM';
  }
  return true;
}
