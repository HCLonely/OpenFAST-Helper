import { t } from './i18n';
import * as path from 'node:path';

/** Resolve only unique evidence. Ambiguous messages stay attached to the main input. */
export function interpretLog(text: string, graph) {
  const clean = text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '');
  const lines = clean.split('\n');
  const issues = [];
  const nodes = [...(graph?.nodes.values() || [])] as any[];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!/\b(fatal|error|failed|invalid|cannot|could not|aborting)\b/i.test(line)) continue;
    if (/\b(?:no|zero|0) errors?\b/i.test(line) && !/fatal|failed|invalid/i.test(line)) continue;
    const raw = lines
      .slice(Math.max(0, i - 1), Math.min(lines.length, i + 3))
      .join('\n')
      .trim();
    if (seen.has(raw)) continue;
    seen.add(raw);
    const mentioned = nodes.filter((node) => {
      const basename = path.posix.basename(decodeURIComponent(node.uri).replace(/\\/g, '/'));
      return basename && raw.toLowerCase().includes(basename.toLowerCase());
    });
    const candidates = mentioned.length === 1 ? mentioned : nodes;
    const matches = candidates.flatMap((node) =>
      (node.parsed.records || [])
        .filter((record) =>
          new RegExp(`\\b${record.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(raw),
        )
        .map((record) => ({ node, record })),
    );
    let uri = graph?.root;
    let lineNumber = 0;
    if (matches.length === 1) {
      uri = matches[0].node.uri;
      lineNumber = matches[0].record.line;
    } else if (mentioned.length === 1) {
      uri = mentioned[0].uri;
      const explicit = /\bline\s*[:=#]?\s*(\d+)\b/i.exec(raw);
      if (explicit)
        lineNumber = Math.max(
          0,
          Math.min(Number(explicit[1]) - 1, mentioned[0].text.split(/\r?\n/).length - 1),
        );
    }
    let explanation = t('runLog.unknown');
    if (/not found|no such file|cannot open|could not open|error opening/i.test(raw))
      explanation = t('runLog.file');
    else if (/invalid|must be|out of range/i.test(raw)) explanation = t('runLog.value');
    else if (/converg|NaN|infinity|numerical|small time step/i.test(raw))
      explanation = t('runLog.numerical');
    issues.push({ uri, line: lineNumber, message: explanation + '\n\n' + raw });
    if (issues.length >= 50) break;
  }
  return issues;
}
