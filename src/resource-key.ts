/** Local Windows file events and references can spell the same path with different case. */
export function resourceKey(value: string): string {
  return process.platform === 'win32' && /^file:/i.test(value) ? value.toLowerCase() : value;
}
