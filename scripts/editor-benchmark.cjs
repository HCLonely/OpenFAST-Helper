'use strict';
// Repeatable generated inputs, actual completion adapters, no research files or solver.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { harness } = require('../test/helpers/editor-harness');
const { snapshotMetrics } = require('../out/editor-snapshot');
const { largeContext } = require('../out/editor-large-context');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error('Missing ' + name + ' value');
  return args[i + 1];
};
const out = option('--out', 'test-results/editor-benchmark.json');
const baselinePath = option('--baseline', null);
if (baselinePath && path.resolve(out) === path.resolve(baselinePath))
  throw Error('Baseline and output must be different files');
const ratio = Number(option('--max-ratio', '3'));
if (!Number.isFinite(ratio) || ratio <= 1) throw Error('--max-ratio must exceed 1');
const head = 'MoorDyn INPUT FILE\nID Attachment X Y Z M V CdA CA\n';
const tail = '\n--- LINES ---\nLine LineType AttachA AttachB UnstrLen NumSegs Outputs\n1 main  ';
const large =
  'HydroDyn INPUT FILE\nJointID Jointxi Jointyi Jointzi\n1 0 0 -10\n2 0 0 -20\n--- OUTPUT ---\n2 NJOutputs - count\n' +
  ('! ' + 'x'.repeat(400) + '\n').repeat(6000) +
  '  JOutLst - joint outputs';
const scenarios = [
  {
    name: 'small-table',
    text: head + '1 Fixed 0 0 -10 0 0 0 0\n2 Coupled 0 0 -10 0 0 0 0' + tail,
    provider: 1,
  },
  {
    name: 'long-table-3000',
    text:
      head +
      Array.from({ length: 3000 }, (_, i) => `${i + 1} Fixed 0 0 -10 0 0 0 0`).join('\n') +
      tail,
    provider: 1,
  },
  {
    name: 'directory-10000',
    text: 'OpenFAST INPUT FILE\n"hydro" HydroFile - file',
    provider: 0,
    directory: true,
  },
  { name: 'large-document-local', text: large, provider: 3, large: true },
];
const summary = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: values.length,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1),
  };
};
(async () => {
  const results = [];
  for (const scenario of scenarios) {
    const cold = [],
      warm = [];
    let candidates = 0,
      headerReads = 0;
    const before = snapshotMetrics();
    for (let run = 0; run < 3; run++) {
      // A distinct harmless header comment avoids sharing a cold text-cache entry between runs.
      const text = scenario.text.replace('INPUT FILE', 'INPUT FILE ! benchmark ' + run);
      const lines = text.split('\n'),
        line = lines.length - 1,
        character = scenario.directory ? 6 : scenario.large ? 0 : lines[line].length;
      const started = performance.now();
      const h = harness(text, line, character);
      if (scenario.directory) {
        h.listeners.directory = async () =>
          Array.from({ length: 10000 }, (_, i) => ['hydro' + i + '.dat', 1]);
        h.listeners.contents = () => {
          headerReads++;
          return 'HydroDyn INPUT FILE';
        };
      }
      const query = () =>
        h.completions[scenario.provider].provideCompletionItems(
          h.document,
          h.editor.selection.active,
          { isCancellationRequested: false },
        );
      let items = await query();
      cold.push(performance.now() - started);
      candidates = items.length;
      assert.ok(candidates > 0, scenario.name + ' must exercise real candidates');
      if (scenario.large) {
        const context = largeContext(h.document, line, line, undefined, true);
        assert.ok(context.lines.length <= 3000, 'local context must remain bounded');
      }
      for (let i = 0; i < 10; i++) {
        const start = performance.now();
        items = await query();
        warm.push(performance.now() - start);
        assert.equal(items.length, candidates);
      }
      for (const subscription of h.subscriptions) subscription.dispose();
    }
    const after = snapshotMetrics();
    assert.ok(after.entries <= 8 && after.retained <= 4000000, 'snapshot cache cap');
    assert.ok(after.estimatedBytes <= after.maxEstimatedBytes, 'estimated snapshot memory cap');
    if (scenario.directory) assert.equal(headerReads, 0, 'large directory defers header reads');
    results.push({
      name: scenario.name,
      characters: scenario.text.length,
      fixtureHash: createHash('sha256').update(scenario.text).digest('hex'),
      candidates,
      coldSetupAndFirstRequest: summary(cold),
      warmRequest: summary(warm),
      snapshotBuilds: after.builds - before.builds,
      snapshotDetailBuilds: after.detailBuilds - before.detailBuilds,
      snapshotEstimatedBytes: after.estimatedBytes,
      textHits: after.textHits - before.textHits,
      documentHits: after.documentHits - before.documentHits,
      headerReads,
    });
  }
  const report = {
    schema: 1,
    extensionVersion: require('../package.json').version,
    nodeMajor: process.versions.node.split('.')[0],
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model,
    notes:
      'Generated fixtures; actual completion adapters with mocked VS Code filesystem. Cold includes registration/decorations and first query. Warm is provider wall time. Not GUI input latency.',
    results,
  };
  if (baselinePath) {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    assert.equal(baseline.schema, report.schema, 'baseline schema');
    for (const key of ['nodeMajor', 'platform', 'arch', 'cpu'])
      assert.equal(baseline[key], report[key], 'baseline environment ' + key);
    assert.deepEqual(
      baseline.results.map((r) => [r.name, r.fixtureHash]),
      results.map((r) => [r.name, r.fixtureHash]),
      'baseline fixtures',
    );
    report.comparison = { baseline: path.resolve(baselinePath), maxRatio: ratio, regressions: [] };
    for (const current of results) {
      const old = baseline.results.find((r) => r.name === current.name);
      for (const metric of ['coldSetupAndFirstRequest', 'warmRequest']) {
        const limit = Math.max(5, old[metric].medianMs) * ratio;
        if (current[metric].medianMs > limit)
          report.comparison.regressions.push({
            scenario: current.name,
            metric,
            medianMs: current[metric].medianMs,
            limitMs: limit,
          });
      }
    }
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  for (const row of results)
    process.stdout.write(
      `${row.name}: cold ${row.coldSetupAndFirstRequest.medianMs.toFixed(2)} ms; warm ${row.warmRequest.medianMs.toFixed(2)} ms; ${row.candidates} candidates\n`,
    );
  process.stdout.write('Report: ' + path.resolve(out) + '\n');
  if (report.comparison?.regressions.length) process.exitCode = 1;
})().catch((error) => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});
