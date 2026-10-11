const fs = require('node:fs');
const path = require('node:path');
const { parseDocument } = require('../out/parser');
const catalog = JSON.parse(fs.readFileSync('data/catalog.json', 'utf8'));
const definitions = new Map();
function visit(folder) {
  if (!fs.existsSync(folder)) return;
  for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, item.name);
    if (item.isDirectory()) { visit(file); continue; }
    if (!/\.(dat|fst|in|txt)$/i.test(file) || fs.statSync(file).size > 2_000_000) continue;
    const parsed = parseDocument(fs.readFileSync(file, 'utf8'));
    for (const entry of parsed.records) {
      const description = (entry.original || '').replace(/!.*$/, '').trim();
      if (description.length < 8 || /[\u3400-\u9fff]/.test(description)) continue;
      definitions.set(`${parsed.module}:${entry.name.toLowerCase()}`, description);
      if (!definitions.has(entry.name.toLowerCase())) definitions.set(entry.name.toLowerCase(), description);
    }
  }
}
visit('../OpenFAST_149工况/C-U2-Q5-F');
visit('../OpenFAST_149工况/Commons');
const overridesFile = 'data/catalog-english-overrides.json';
const overrides = fs.existsSync(overridesFile) ? JSON.parse(fs.readFileSync(overridesFile, 'utf8')) : {};
const missing = [];
const translate = (entry, kind) => {
  const key = `${kind}:${entry.module || '通用'}:${entry.name.toLowerCase()}`;
  const original = kind === 'parameter' && (definitions.get(`${entry.module}:${entry.name.toLowerCase()}`) || definitions.get(entry.name.toLowerCase()));
  const description = overrides[key] || original;
  if (!description) missing.push({ key, ...entry });
  return { ...entry, description: description || '' };
};
const english = {
  ...catalog,
  parameters: catalog.parameters.map((entry) => translate(entry, 'parameter')),
  tables: catalog.tables.map((entry) => translate(entry, 'table')),
  outputs: catalog.outputs.map((entry) => translate(entry, 'output')),
};
if (missing.length) throw new Error('English descriptions missing: ' + missing.map(entry => entry.key).join(', '));
fs.writeFileSync('data/catalog.en.json', JSON.stringify(english, null, 2) + '\n');
fs.writeFileSync('test-results/english-missing.json', JSON.stringify(missing, null, 2));
console.log('Missing:', missing.length, 'parameters:', missing.filter((entry) => entry.key.startsWith('parameter')).length);
console.log(missing.map((entry) => `${entry.key} | ${entry.description}`).join('\n'));
