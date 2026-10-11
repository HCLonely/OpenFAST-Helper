/** Data shared by the parser, validators and editor adapters. */
export interface Lexeme {
  text: string;
  start: number;
  end: number;
}
export interface ParameterRecord {
  comments?: string[];
  name: string;
  value: string;
  line: number;
  original?: string;
  inline?: string;
  comment?: string;
  start?: number;
  end?: number;
}
export type TokenKind = 'parameter' | 'value' | 'header' | 'cell' | 'matrix' | 'output' | 'end';
export interface ConfigToken {
  outputBlock?: number;
  outputKind?: string;
  comments?: string[];
  name: string;
  kind: TokenKind;
  line: number;
  start: number;
  end: number;
  value?: string;
  original?: string;
  inline?: string;
  comment?: string;
  row?: number;
  column?: number;
}
export interface ParsedDocument {
  module: string;
  tokens: ConfigToken[];
  sections: {
    name: string;
    line: number;
  }[];
  parameters: Map<string, ParameterRecord>;
  records: ParameterRecord[];
  lineCount: number;
}
export interface CatalogEntry {
  name: string;
  description: string;
  module?: string;
}
export interface Catalog {
  schemaVersion: number;
  parameters: CatalogEntry[];
  tables: CatalogEntry[];
  outputs: CatalogEntry[];
  sources: Record<string, string>;
}
export interface VersionProfile {
  version: string;
  known: boolean;
  explicit: boolean;
  detected?: string;
  major: number;
  source: string;
}
export interface ParameterExplanation {
  source?: string;
  comments?: string[];
  name: string;
  module: string;
  kind?: string;
  description: string;
  value?: string;
  original?: string;
  inline?: string;
  comment?: string;
  applicability?: string;
  profile?: VersionProfile;
  row?: number;
  column?: number;
}
export interface DiagnosticIssue {
  line: number;
  start?: number;
  end?: number;
  severity: 'error' | 'warning' | 'information';
  code: string;
  message: string;
  uri?: string;
  url?: string;
}
