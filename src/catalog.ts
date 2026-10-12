import catalogData from '../data/catalog.json';
import moduleParameters from '../data/module-parameters.json';
import type { Catalog, CatalogEntry } from './types';
const supplementalParameters = new Map(
  moduleParameters.parameters.map((entry) => [
    `${entry.module}:${entry.name.toLowerCase()}`,
    entry,
  ]),
);
const catalog: Catalog = {
  ...catalogData,
  parameters: [
    ...catalogData.parameters.filter(
      (entry) => !supplementalParameters.has(`${entry.module}:${entry.name.toLowerCase()}`),
    ),
    ...moduleParameters.parameters,
  ],
};
import documentation from '../data/doc-links.json';
const normalize = (x) => x.toLowerCase();
const parameters = new Map();
for (const entry of catalog.parameters) {
  parameters.set(`${entry.module}:${normalize(entry.name)}`, entry);
}
const tables = new Map(catalog.tables.map((x) => [normalize(x.name), x]));
const outputs = new Map(catalog.outputs.map((x) => [normalize(x.name), x]));
function findEntry(name: string, module: string, kind = 'parameter'): CatalogEntry | undefined {
  const base = name.replace(/\(\d+\)$/, '');
  if (kind === 'output') {
    const exact = outputs.get(normalize(name));
    if (exact) {
      return exact;
    }
    const tension = /^(FairTen|AnchTen)(\d+)$/i.exec(name);
    if (tension) {
      return {
        name,
        description: `${tension[2]} 号系泊线${/fair/i.test(tension[1]) ? '导缆' : '锚固'}端张力，N。`,
      };
    }
    return undefined;
  }
  if (kind === 'header' || kind === 'cell') {
    return tables.get(normalize(name));
  }
  for (const key of [name, base]) {
    const e =
      parameters.get(`${module}:${normalize(key)}`) || parameters.get(`通用:${normalize(key)}`);
    if (e) {
      return e;
    }
  }
  return undefined;
}
function findDocumentation(name, module) {
  return (
    documentation.entries[`${module}:${normalize(name)}`] ||
    documentation.entries[`${module}:${normalize(name.replace(/\(\d+\)$/, ''))}`]
  );
}
export { catalog, findEntry, findDocumentation, documentation, supplementalParameters };
