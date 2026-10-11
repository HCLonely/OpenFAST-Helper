export type OutputBlock = {
  id: number;
  start: number;
  end: number;
  kind: 'regular' | 'bladeNodes' | 'unknownNodes';
};
/** Never infer a nodal channel family from an ordinary OutList alone. */
export function outputBlocks(text: string): OutputBlock[] {
  const lines = text.split(/\r?\n/),
    blocks: OutputBlock[] = [];
  const mooring = /MoorDyn/i.test(lines.slice(0, 15).join('\n'));
  let active: OutputBlock,
    pending: OutputBlock['kind'] = 'regular';
  function close(line) {
    if (active) {
      active.end = line;
      active = undefined;
    }
  }
  for (let line = 0; line < lines.length; line++) {
    const source = lines[line].trim();
    if (/^(?:["']?END\b)/i.test(source)) {
      close(line - 1);
      pending = 'regular';
      continue;
    }
    if (/^(?:!?[-=]{3})/.test(source)) {
      close(line - 1);
      pending = /NODE.*OUTPUT|OUTPUT.*NODE/i.test(source)
        ? 'unknownNodes'
        : /OutList/i.test(source)
          ? pending
          : 'regular';
      if (
        (/OUTPUT CHANNELS/i.test(source) || (mooring && /OUTPUTS/i.test(source))) &&
        pending === 'regular'
      ) {
        active = { id: blocks.length, start: line, end: lines.length - 1, kind: 'regular' };
        blocks.push(active);
      }
      continue;
    }
    if (/\bBldNd_(?:BladesOut|BlOutNd(?:_Str)?)\b/.test(source)) pending = 'bladeNodes';
    if (/^(?:BldNd_OutList|OutList)\b/i.test(source)) {
      close(line - 1);
      active = {
        id: blocks.length,
        start: line,
        end: lines.length - 1,
        kind: /^BldNd_OutList/i.test(source) ? 'bladeNodes' : pending,
      };
      blocks.push(active);
      continue;
    }
    // MoorDyn commonly uses an OUTPUTS heading followed directly by channels.
    if (/^!?[-=]{3}/.test(source)) close(line - 1);
  }
  return blocks;
}
export function outputBlockAt(text: string, line: number) {
  return outputBlocks(text).find((b) => line > b.start && line <= b.end);
}
