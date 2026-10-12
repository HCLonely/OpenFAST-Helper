import { findEntry } from './catalog';
import { lex } from './parser';
import type { ConfigToken, ParsedDocument } from './types';

/** Add editor tokens only where existing parsing has no structured interpretation.
 * Input validation and parameter-editing records retain their original semantics.
 */
export function officialHighlightTokens(lines: string[], parsed: ParsedDocument): ConfigToken[] {
  const keyValue = ['AeroDyn', 'HydroDyn', 'InflowWind', 'ServoDyn', 'StC'].includes(parsed.module);
  if (!keyValue && parsed.module !== 'TurbSim') return [];
  const occupied = new Set(
    parsed.tokens
      .filter((token) =>
        ['parameter', 'header', 'cell', 'matrix', 'output', 'end'].includes(token.kind),
      )
      .map((token) => token.line),
  );
  const result: ConfigToken[] = [];
  for (let line = 0; line < lines.length; line++) {
    if (occupied.has(line) || /^\s*[!#%]/.test(lines[line])) continue;
    const source = lines[line];
    const scan = lex(source);
    const [key, value] = scan.items;
    if (keyValue && key && value && findEntry(key.text, parsed.module)) {
      const boundary = scan.items.findIndex(
        (item, index) => index > 0 && ['-', '–'].includes(item.text),
      );
      const values = scan.items.slice(1, boundary < 0 ? undefined : boundary);
      if (
        !values.length ||
        !values.every((item) =>
          /^(?:["']|[-+]?(?:\d|\.\d)|(?:true|false|default|none|unused)$)/i.test(item.text),
        )
      )
        continue;
      const recordValue = source.slice(values[0].start, values.at(-1).end);
      result.push({ ...key, line, kind: 'parameter', name: key.text, value: recordValue });
      result.push(
        ...values.map((item) => ({
          ...item,
          line,
          kind: 'value' as const,
          name: key.text,
          value: recordValue,
        })),
      );
      continue;
    }
    // TurbSim's published sample includes AnalysisTime- and IEC_WindType-.
    if (parsed.module === 'TurbSim') {
      const match =
        /^(\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[-+]?\d+(?:\.\d*)?(?:[EeDd][-+]?\d+)?|[A-Za-z][\w.-]*))\s+([A-Za-z]\w*)[-–]\s/.exec(
          source,
        );
      if (!match) continue;
      const start = match[0].lastIndexOf(match[2]);
      result.push({
        line,
        start,
        end: start + match[2].length,
        kind: 'parameter',
        name: match[2],
        value: match[1].trim(),
      });
      const item = scan.items[0];
      result.push({ ...item, line, kind: 'value', name: match[2], value: item.text });
    }
  }
  return result;
}
