import { detectModule } from './parser';

/** Read only a bounded header, including when a result contains millions of rows. */
export function documentHeader(document): string {
  if (!document.lineAt || !document.lineCount) return document.getText().slice(0, 64_000);
  const lines: string[] = [];
  let remaining = 64_000;
  for (let line = 0; line < Math.min(document.lineCount, 150) && remaining > 0; line++) {
    const text = document.lineAt(line).text.slice(0, remaining);
    lines.push(text);
    remaining -= text.length + 1;
  }
  return lines.join('\n');
}

export function documentSize(document): number {
  return document.positionAt && document.offsetAt
    ? document.offsetAt(document.positionAt(Number.MAX_SAFE_INTEGER))
    : document.getText().length;
}

/** Output evidence is separate from input modules so output rows never become parameters. */
export function isSimulationResultFile(filename: string, text: string): boolean {
  if (
    !/\.(out|sum|lin|ech|echo|dbg[23]?|wnd|hh|u|v|w|cts|twr|dat|txt)$/i.test(filename) ||
    text.includes('\0')
  )
    return false;
  const header = text.slice(0, 64_000).split(/\r?\n/, 40).join('\n');
  return (
    (/\.(ech|echo)$/i.test(filename) && !!detectModule(header)) ||
    /(?:predictions|results)[^\n]*generated[^\n]*(?:OpenFAST|FAST\.Farm|MoorDyn)|(?:OpenFAST|FAST\.Farm)[^\n]*linearization[^\n]*(?:output|file)|summary (?:file|of)[^\n]*(?:OpenFAST|AeroDyn|ElastoDyn|HydroDyn|MoorDyn|BeamDyn|SubDyn|TurbSim)|generated[^\n]*(?:by|using)\s+(?:ROSCO|TurbSim)\b|^\s*ROSCO\s+ECHO\s+file\b/im.test(
      header,
    ) ||
    (/\.(wnd|hh)$/i.test(filename) &&
      /^\s*!?\s*Time\s+WindSpeed\s+WindDir\s+VertSpeed\b/im.test(header)) ||
    (/\.dbg3$/i.test(filename) && /^\s*LocalVar%Time\s+(?:AvrSWAP\(\s*\d+\)\s*)+$/im.test(header))
  );
}

/** Content-based opt-in for generic text extensions; never claims binary or YAML files. */
export function isOpenFASTTextFile(filename: string, text: string, size = text.length): boolean {
  if (
    !/\.(?:dat|in|inp|ipt|ech|wnd|sum|bmi|lin|out|txt|echo|dbg[23]?|hh|u|v|w|cts|twr|ctp|csv)$/i.test(
      filename,
    )
  )
    return false;
  if (text.includes('\0')) return false;
  if (isSimulationResultFile(filename, text)) return true;
  if (size > 2_000_000) return false;
  if (detectModule(text)) return true;
  const header = text.split(/\r?\n/, 40).join('\n');
  return (
    (/\.ctp$/i.test(filename) && /coherent turbulence parameter input file/i.test(header)) ||
    (/rotor performance tables/i.test(header) &&
      /ROSCO/i.test(header) &&
      /pitch angle vector/i.test(header) &&
      /TSR vector/i.test(header)) ||
    (/!\s*Comment Flex\s*5\s*Format/i.test(header) &&
      /!\s*Dimension:\s*\d+/i.test(header) &&
      /!\s*Mass Matrix/i.test(header)) ||
    (/\.csv$/i.test(filename) &&
      /^\s*(?:TSR|RtSpd|VRel|Pitch|Skew)\s*,[^\n]*\bC_Fx\s*,\s*C_Fy\s*,\s*C_Fz\s*,\s*C_Mx\s*,\s*C_My\s*,\s*C_Mz\s*$/im.test(
        header,
      ))
  );
}
