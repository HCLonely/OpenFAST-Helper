import { detectModule, lex } from './parser';

/** Require the primary grid signature, not just the TurbSim module/header. */
export function isTurbSimInput(filename: string, text: string): boolean {
  if (!/\.(inp|in|dat|txt)$/i.test(filename) || text.length > 2_000_000 || text.includes('\0'))
    return false;
  // Only primary header/parameters matter; avoid scanning large numeric tables on each edit.
  const prefix = text.slice(0, 64_000).split(/\r?\n/, 150).join('\n');
  if (detectModule(prefix) !== 'TurbSim') return false;
  const labels = new Set(
    prefix
      .split(/\r?\n/)
      .slice(0, 150)
      .map((line) => {
        const { items } = lex(line);
        return items.length >= 2 ? items[1].text.replace(/-$/, '').toLowerCase() : '';
      }),
  );
  return ['numgrid_z', 'numgrid_y', 'timestep', 'analysistime'].every((name) => labels.has(name));
}
