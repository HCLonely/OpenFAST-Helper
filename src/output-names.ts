import verified from '../data/output-aliases.json';

/** Aliases are scoped to ElastoDyn, proved by equal ParamIndxAry entries. */
export function normalizedOutput(name: string, module = 'ElastoDyn') {
  const key = name.replace(/^["']?[-+]?|["']$/g, '').toLowerCase();
  return module === 'ElastoDyn' || module === 'OpenFAST'
    ? (verified.aliases[key] || key).toLowerCase()
    : key;
}
