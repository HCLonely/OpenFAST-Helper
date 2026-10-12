import data from '../data/input-value-rules.json';

interface ValueRule {
  type: string;
  array: boolean;
  length?: number;
  special?: string[];
}
const rules = new Map<string, ValueRule>();
for (const [module, entries] of Object.entries(data.modules)) {
  for (const [name, rule] of Object.entries(entries))
    rules.set(`${module}:${name.toLowerCase()}`, rule);
}

/** Known module types take precedence over guesses based on editable prose. */
export function inputValueRule(module: string, name: string): ValueRule | undefined {
  return rules.get(`${module}:${name.replace(/\(\d+\)$/, '').toLowerCase()}`);
}
