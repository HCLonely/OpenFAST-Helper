/** Reject implicit SMB access from untrusted inputs before invoking the filesystem. */
export function canReadReference(workspace, uri): boolean {
  if (workspace.isTrusted || uri.scheme !== 'file') return true;
  // Check the URI spelling as well for adapters that do not expose authority.
  const authority = uri.authority || /^file:\/\/([^/]*)/i.exec(uri.toString())?.[1];
  return !authority && !/^[\\/]{2}/.test(uri.path || '');
}
