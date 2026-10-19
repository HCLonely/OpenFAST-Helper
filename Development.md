# Development Guide

## Reference access and result-reader boundaries

`src/reference-access.ts` centralizes `canReadReference(workspace, uri)`. Before filesystem calls, diagnostics, case graphs, document links, path completion, and path repair reject file URIs with an authority or UNC/device-style path in untrusted workspaces. Trusted workspaces and existing remote filesystem providers retain their behavior. Regression tests use mocked filesystem calls; they never connect to a network share.

`readResultMetadata(filename, signal?)` shares the bounded `resultLines` reader with time-series parsing. Text metadata limits are 1,000,000 bytes per line and 4,000,000 scanned header bytes; series lines retain the 32,000,000-byte bound. Oversized complete lines and unfinished lines are both rejected before decoding. The preview's cancellable progress passes an AbortSignal and closes pending streams on cancellation. Tests cover access policy, automatic checks, document links, oversized headers, cumulative header limits, cancellation, UTF-8 and LF/CRLF/CR. Run `npm test` and `npm run check` from the project root, with the external fixture configured as described below. Tests remain subject to the existing `test/` ignore rule.

**English** | [简体中文](Development.zh-CN.md)

## Environment and local builds

Run the following commands from the project root. Use Node.js 24 (the packaging tools require Node.js >= 22) and npm. Rebuilding the native probe requires Windows x64, the Rust MSVC toolchain and Visual Studio C++ Build Tools. Extension runtime requirements are listed in the [README](README.md).

```powershell
npm ci --ignore-scripts
npm run compile
npm test
npm run check
npm run format:check
# Replace the placeholders with the actual repository and branch or commit:
npm run package -- --baseContentUrl "https://github.com/<owner>/<repo>/blob/<ref>/"
```

package.json points to `https://github.com/HCLonely/OpenFAST-Helper`. Run `npm run package -- --baseContentUrl "https://github.com/HCLonely/OpenFAST-Helper/blob/v1.3.0/"` to link release documentation to its tag. GitHub Actions supplies a commit-specific content URL.

Run `npm run build:doc-links` to maintain the official section index (network access required). HTML fetch records and build reports are written to `test-results/docs` and excluded from the package. The parameter catalog and section index are stored separately in `data/catalog.json` and `data/doc-links.json`; rebuilding the catalog does not overwrite the link index. Maintain module documentation entry points in catalog sources, `scripts/build_catalog.py` and the English catalog. TurbSim uses the NLR v2.00 PDF and ROSCO uses its latest documentation homepage; neither receives an additional OpenFAST-version documentation link.

Open the extension folder in VS Code and press F5 to launch the Extension Development Host. On Windows, `scripts/run-host-test.ps1` runs real editor tests with separate user and extension directories, without installing into your everyday VS Code environment. Results are written to `test-results/host-result.json`.

Runtime code is written in TypeScript and compiled to `out/`, with `out/extension.js` as the entry point. `npm run watch` compiles continuously; `npm run format` formats the source; F5 compiles before debugging. Shared data interfaces are in `src/types.ts`, the language service in `src/i18n.ts`, and the English catalog in `data/catalog.en.json`. Runtime messages are stored in `data/ui.zh-CN.json` and `data/ui.en.json` with matching semantic English keys, such as `hover.builtInDescription` and `runner.executableNotFound`. Call `t('hover.builtInDescription')` for the current language. The `MessageKey` type checks keys; wording and placeholders such as `{0}` belong only in dictionary values. To add a language, extend the language enum, message and parameter catalogs, and add `package.nls.<locale>.json`.

The core parser is in `src/parser.ts`, the editor adapter in `src/extension.ts`, and the Chinese catalog in `data/catalog.json`. Packaging does not require Python. `scripts/build_catalog.py` can regenerate the catalog from earlier annotated resources in the current research workspace; the existing JSON works independently.

For test cases stored elsewhere, set `$env:OPENFAST_TEST_CASE_DIR = "absolute case directory"` before running `npm test` or the host test script. The directory must contain real configurations; its adjacent `_中文注释版` directory is used by existing parser regression tests.

The current `.gitignore` excludes local tests under `test/`, and no test sources are tracked. Fresh checkouts can compile and package the extension. JavaScript tests and formatting/host checks require the local test files; parser regressions also depend on external cases. Running these tests in CI requires shareable fixtures and removal of local path dependencies.

## Documentation languages

`README.md` and `Development.md` are the default English documents. `README.zh-CN.md` and `Development.zh-CN.md` are their Simplified Chinese counterparts. Keep both versions synchronized when changing features, commands, requirements or limitations. Each document links to its counterpart at the top; links between user and developer guides should stay in the selected language, including section anchors.

Both README files are included in the VSIX. Both development guides are excluded by `.vscodeignore`; README links to them resolve to the repository through the packaging content URL.

## Progress monitor

`src/monitor-sampler.ts` discovers actual `.log/.stdout/.stderr/.txt` files in the case directory and two subdirectory levels without relying on launcher metadata or fixed folder names. Discovery shares limits of 100 directories, 1,000 entries and 100 candidates; only the 16 newest fresh candidates are read. Symbolic-link directories, `.git` and `node_modules` are skipped. Launch-time freshness and shared-directory ambiguity checks still apply. Result fallback checks the main `.out` and up to 32 case-prefixed module `.out/.dbg*` files, requiring a leading `Time` header and complete rows matching its column count. It reads at most 64 KiB of header and 128 KiB of tail per result, rejects times beyond FST TMax and preserves solver ETA independently. `src/run-monitor.ts` resolves project actions from stored task paths and calls `vscode.openFolder` with `forceNewWindow`, only in trusted local workspaces. Task names open projects; Details focuses and scrolls to the task inspection region only on explicit clicks. Periodic snapshots preserve focus without scrolling. Detail buttons expose `aria-controls` and `aria-expanded`. The monitor webview sorts all eight columns using raw numeric values or localized natural text ordering; unknown values stay last in both directions and ties retain incoming order. Sorting runs after filtering and persists through the webview state API. Headers use native buttons and `aria-sort`, retaining keyboard focus across refreshes.

After `npm run compile`, run `node --test test/run-progress.test.js test/monitor-sampler.test.js test/run-monitor.test.js test/run-monitor-sort.test.js test/process-discovery.test.js` with the local tests available. These cover arbitrary nested log names, ignored custom status JSON, scan depth limits, stale attempts, native discovery, project actions/trust checks, numeric and natural sorting, missing values, and sorting persistence.

## Native probe

Source is in `native/openfast-probe`; the runtime binary is `bin/openfast-probe.exe`. Run from the project root:

```powershell
./scripts/build-process-probe.ps1 -Test
```

If Cargo is not on PATH, add `-CargoPath <path-to-cargo>`. The script uses Cargo.lock to lock dependencies, runs Rust tests, builds the release binary and copies it to bin. VSIX users do not need Rust.

## GitHub Actions builds

Workflow: `.github/workflows/build.yml`, named **Build VSIX**.

- Runs on pushes to any branch or tag, pull request creation or updates, and manual dispatch. A new run cancels an unfinished run for the same ref.
- Uses `windows-2022`, Node.js 24 and the Windows x64 Rust stable toolchain. npm downloads are cached using package-lock.json; installation uses `npm ci --ignore-scripts`.
- Runs `npm run check`, tests and rebuilds the native probe with the existing PowerShell script, then compiles TypeScript and packages through `npm run package`.
- Supplies `--baseContentUrl` using GitHub repository and commit information so relative README links point to that commit, without hardcoding a repository URL.
- Checks the VSIX entry point, parameter catalog and native probe, then uploads `dist/*.vsix`. The artifact is named `openfast-helper-windows-x64-<run-number>` and retained for 30 days.
- Requires only repository read permissions and no additional secrets. Download from **Actions → Build VSIX → selected run → Artifacts**. **Run workflow** is available once the workflow exists on the default branch.

CI runs type checking, Rust tests and package-content checks. JavaScript and real VS Code host tests require the local resources described above. The workflow creates a VSIX artifact; it does not publish to the extension marketplace or GitHub Releases. The package contains a Windows x64 probe; see the README for other-platform limitations.

When releasing a new version, update package.json, package-lock.json and the versioned output path in the `package` script together. The workflow collects VSIX files with a wildcard and needs no version update.

### Troubleshooting

- Dependency installation fails: check the Node.js version and consistency between package.json and package-lock.json.
- Native probe build fails: check the MSVC toolchain, C++ linker and Cargo.lock. CI rebuilds the probe and does not depend on a prebuilt repository binary.
- Packaging fails or produces no artifact: check the `npm run package` log and output path. CI creates dist first and fails the upload if the artifact is missing.
- Local tests cannot find cases: set `OPENFAST_TEST_CASE_DIR` and check the adjacent Chinese-annotated directory. Packaging does not require an actual OpenFAST simulation.

## Performance benchmarks

Run `npm run benchmark:editor` from the project root. Generated fixtures include a small table, a 3,000-row definition table, 10,000 directory candidates and a document larger than 2 MB. The report records cold registration/first requests, warm-request medians and p95 values, candidate counts and cache hits in `test-results/editor-benchmark.json`. It calls the real completion adapter with a mocked VS Code filesystem; it does not measure GUI input latency. By default, it reports timings and verifies candidate/cache boundaries without making ordinary tests fail randomly on timing thresholds.

To compare a baseline, retain the old report and use a separate output path:

```powershell
npm run benchmark:editor -- --baseline test-results/editor-benchmark-baseline.json --out test-results/editor-benchmark-current.json --max-ratio 3
```

Comparison requires matching scenario hashes, report format, Node.js major version, platform, architecture and CPU model. It fails if any scenario's cold or warm median exceeds `max(baseline median, 5 ms) × ratio`. The default ratio is 3 and can be adjusted; background load on the same machine can still affect results. Identical baseline and output paths are rejected to protect the baseline.

## GitHub Releases

For 1.3.0, run the checks and native probe build above, then package with the `v1.3.0` content URL. Commit and push the source, create and push the `v1.3.0` tag, then publish a GitHub Release with `dist/openfast-helper-1.3.0.vsix` attached. Verify that the release tag points to the tested commit. Publishing to the VS Code Marketplace is a separate process.
