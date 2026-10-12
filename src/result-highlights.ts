import type { ConfigToken } from './types';

/** Results have independent rows: read visible lines without indexing the entire file. */
export function resultHighlightTokens(document, ranges, cancellation?) {
  const tokens: ConfigToken[] = [];
  const lines: string[] = [];
  const seen = new Set<number>();
  let remaining = 1_000_000;
  for (const range of ranges) {
    const first = Math.max(0, range.start.line);
    const last = Math.min(document.lineCount - 1, range.end.line, first + 799);
    for (let line = first; line <= last; line++) {
      if (cancellation?.isCancellationRequested || remaining <= 0 || tokens.length >= 50_000)
        return { tokens, lines };
      if (seen.has(line)) continue;
      seen.add(line);
      const source = document.lineAt(line).text.slice(0, remaining);
      remaining -= source.length + 1;
      lines[line] = source;
      const header = /^\s*!?\s*(?:Time|LocalVar%Time)\b/i.test(source);
      if (/^\s*[!#%]/.test(source) && !header) continue;
      for (const match of source.matchAll(/\S+/g)) {
        if (tokens.length >= 50_000) break;
        if (!header && !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][-+]?\d+)?$/.test(match[0]))
          continue;
        tokens.push({
          line,
          start: match.index,
          end: match.index + match[0].length,
          kind: header ? 'header' : 'value',
          name: '',
          value: match[0],
        });
      }
    }
  }
  return { tokens, lines };
}
