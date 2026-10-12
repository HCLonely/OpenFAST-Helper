import { detectModule } from './parser';

/** Content-based opt-in for generic text extensions; never claims binary or YAML files. */
export function isOpenFASTTextFile(filename: string, text: string): boolean {
  if (
    !/\.(?:dat|in|inp|ipt|ech|wnd|sum|bmi|lin|out|txt|echo|dbg[23]?|hh|u|v|w|cts|ctp|csv)$/i.test(
      filename,
    )
  )
    return false;
  if (text.length > 2_000_000 || text.includes('\0')) return false;
  if (detectModule(text)) return true;
  const header = text.split(/\r?\n/, 40).join('\n');
  return (
    /(?:predictions|results)[^\n]*generated[^\n]*(?:OpenFAST|FAST\.Farm|MoorDyn)|(?:OpenFAST|FAST\.Farm)[^\n]*linearization[^\n]*(?:output|file)|summary (?:file|of)[^\n]*(?:OpenFAST|AeroDyn|ElastoDyn|HydroDyn|MoorDyn|BeamDyn|SubDyn|TurbSim)/i.test(
      header,
    ) ||
    (/\.(?:wnd|hh)$/i.test(filename) &&
      /^\s*!?\s*Time\s+WindSpeed\s+WindDir\s+VertSpeed\b/im.test(header)) ||
    /generated[^\n]*(?:by|using)\s+(?:ROSCO|TurbSim)\b/i.test(header) ||
    /^\s*ROSCO\s+ECHO\s+file\b/im.test(header) ||
    (/\.ctp$/i.test(filename) && /coherent turbulence parameter input file/i.test(header)) ||
    (/rotor performance tables/i.test(header) &&
      /ROSCO/i.test(header) &&
      /pitch angle vector/i.test(header) &&
      /TSR vector/i.test(header)) ||
    (/\.dbg3$/i.test(filename) &&
      /^\s*LocalVar%Time\s+(?:AvrSWAP\(\s*\d+\)\s*)+$/im.test(header)) ||
    (/!\s*Comment Flex\s*5\s*Format/i.test(header) &&
      /!\s*Dimension:\s*\d+/i.test(header) &&
      /!\s*Mass Matrix/i.test(header)) ||
    (/\.csv$/i.test(filename) &&
      /^\s*(?:TSR|RtSpd|VRel|Pitch|Skew)\s*,[^\n]*\bC_Fx\s*,\s*C_Fy\s*,\s*C_Fz\s*,\s*C_Mx\s*,\s*C_My\s*,\s*C_Mz\s*$/im.test(
        header,
      ))
  );
}
