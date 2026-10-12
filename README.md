# OpenFAST Helper

**English** | [简体中文](README.zh-CN.md)

Syntax highlighting and offline English/Chinese explanations for OpenFAST configurations in VS Code. No translated comments need to be added to your inputs; reading and editing assistance does not automatically rewrite configuration files.

## Installation

1. Open the Extensions view in VS Code.
2. Select `…` → **Install from VSIX…**.
3. Choose `openfast-helper-1.1.0.vsix` and reload the window if prompted.
4. Open an `.fst` or module `.dat` file. The language mode in the lower-right corner should be **OpenFAST**.

You can also install from the command line:

```powershell
code --install-extension "openfast-helper-1.1.0.vsix"
```

The extension has not yet been published to the marketplace. VS Code 1.85 or newer is required.

Download `openfast-helper-1.1.0.vsix` from [GitHub Releases](https://github.com/HCLonely/OpenFAST-Helper/releases/tag/v1.1.0), then install it with **Install from VSIX…**. Development builds are also available from **Actions → Build VSIX → successful run → Artifacts**.

## Supported text formats

`.fst` and `.fstf` retain their direct OpenFAST association. With `openfast.autoDetect` enabled, plain-text `.dat`, `.in`, `.inp`, `.ipt`, `.ech`, `.wnd`, `.sum`, `.bmi`, `.lin`, `.out` and `.txt` files are recognized from module headers, parameter signatures or supported output headers. This includes ROSCO `DISCON.IN`, TurbSim inputs, BeamDyn blade files, module/driver inputs, echo files, summaries, linearization output and uniform-wind text with a recognized column header. OLAF, ExtPtfm and SimpleElastoDyn input headers are also recognized.

Highlighting retains this project's existing parameter/value/comment separation, semantic tokens and theme colors. It covers ROSCO values and arrays with parameter names after `!`, including records without a trailing description; TurbSim bare string choices; unquoted filenames; known table headers, units rows and output titles.

Generic extensions are not globally reassigned. Explicitly selected languages remain in place. Files without enough content evidence, including headerless numeric wind/output files, can be opened through **OpenFAST: Recognize current file as OpenFAST** or the language-mode picker. Automatic detection retains the 2 MB limit. Binary `.outb`/`.bts`, DLLs and ROSCO YAML are outside this text-highlighting detection. Additional highlighting does not imply complete parameter documentation, validation or support for launching ROSCO. TurbSim primary inputs have a separate run command described below.

Official-document additions cover ROSCO `.echo/.dbg/.dbg2/.dbg3` and rotor-performance tables; AeroDisk, AeroAcoustics and structural-control input titles; TurbSim user time series, spectra and profiles, plus `.hh/.u/.v/.w/.cts` text and legacy `.ctp` input; and AeroDisk coefficient `.csv` tables with recognized columns. Recognition still requires content evidence. Key-first records in documented key/value modules and compact TurbSim labels such as `AnalysisTime-` receive supplementary editor highlighting. Full-line `#/%` comments and the documented table headers retain existing theme styles. These additions do not extend strict pre-run validation or editing commands to key-first records.

Existing recognition and coloring take precedence when formats overlap. Other language modes remain protected: VS Code normally opens `.hh` as C++ and `.cts` as TypeScript; manually select OpenFAST to highlight these text files. ROSCO tuning YAML keeps YAML highlighting. TurbSim binary `.wnd/.bts/.bin/.twr` files remain outside text detection.

Sources: [ROSCO controller files](https://rosco.readthedocs.io/en/latest/source/rosco.html), [ROSCO input definitions](https://rosco.readthedocs.io/en/latest/source/toolbox_input.html), [OpenFAST input formats](https://openfast.readthedocs.io/en/main/source/user/input_file_overview.html), [AeroDisk](https://openfast.readthedocs.io/en/main/source/user/aerodisk/input_files.html), and [TurbSim v2 manual](https://www.nlr.gov/docs/libraries/wind-docs/turbsim_v2-00-pdf.pdf?sfvrsn=5a0a30f8_1), especially Appendix A/H and the output-file sections.

## Usage

In an untrusted workspace, automatic reference checks, document links, and path assistance skip UNC/network file references. Local references remain available; trust the workspace to enable network references.

- Parameters, values, booleans, paths, section headings, descriptions and output channels use distinct colors inherited from your editor theme.
- Hover over a parameter name or value to see its built-in description, actual value in the current file and supported applicability conditions. Original descriptions and supplementary comments appear together in a **Line comments** block, below its label.
- Specific official sections are linked where available, such as [RotSpeed: initial conditions](https://openfast.readthedocs.io/en/main/source/user/elastodyn/input.html#initial-conditions) and [PCMode: pitch control](https://openfast.readthedocs.io/en/main/source/user/servodyn/input.html#pitch-control). Missing specific links are identified explicitly, with a documentation entry point provided instead.
- Hover over table headers or cells for field descriptions. HydroDyn added-matrix values show row/column degrees of freedom and units.
- Output lists explain channels individually, including multiple comma-separated channels inside quotes.
- Press `Ctrl+Shift+P` and run **OpenFAST: Look up parameter descriptions** to search the offline catalog by English parameter name or Chinese keyword.
- Fixed-option values offer completion menus with choices and localized meanings, such as `WaveMod` values `0 — Still water`, `1 — Regular waves` and `2 — JONSWAP / PM irregular waves`. Select a suggestion to replace the value. Automatic display follows VS Code's **Suggest On Trigger Characters** setting.
- Fixed-option hover explanations, the lightbulb selector and **OpenFAST: Choose a fixed parameter value** remain available. Selection replaces only the scalar value, preserving indentation and comments; no fixed-option shortcut is assigned.
- `Ctrl`-click (`Cmd`-click on macOS) an input path to open an existing referenced file. `PotFile` opens the `.hst` file with the same root name.
- Use the Outline view to navigate sections.
- If detection fails, run **OpenFAST: Recognize current file as OpenFAST**, or choose OpenFAST from the language-mode selector.

`.fst/.fstf` files are associated automatically. Other supported text files are recognized from headers and multiple parameter signatures, preserving another explicitly selected programming language. The extension does not globally associate every `.dat` file with OpenFAST.

## Formatting, consistency and repeatable verification (0.15.0)

1. **Follow table formatting**: accepting an ID, reference or enum at a row end follows commas, tabs or spaces from up to eight nearby same-field examples within 20 lines. Consistent column starts are retained where possible, adding at most 80 spaces. Existing cells, separators, comments and physical values are not reformatted; without evidence, the existing tab fallback is used. New row templates also follow nearby separators and retain field placeholders.
2. **Consistent field context**: editor snapshots retain empty cells between consecutive explicit commas and share field mapping across highlighting, hover, references, diagnostics and signatures. Quoted commas remain part of values and original UTF-16 positions are preserved. Unknown variable-length counts map only the known prefix; ordinary whitespace does not imply a missing middle cell. Strict solver parsing and physical rules remain separate.
3. **Native undo**: completion values, automatic quotes and row-end separators are submitted in one native completion edit, without a follow-up rewrite command. Real host checks cover selections, multiple cursors, paths and completion after Chinese-edit protection expires; one undo restores the original text.
4. **Explain empty suggestions on demand**: **OpenFAST: Show Suggestions with Empty-result Explanation** opens native suggestions and, once all relevant extension providers finish without candidates, explains missing definitions, unclear counts, unknown node ranges or disabled settings. **OpenFAST: Explain Suggestions Here** queries the reason directly and links to relevant settings, path review or array templates. No placeholder completion items are added. Cancellation, failure, stale requests and cursor changes stay quiet. VS Code uses Invoke for both manual and automatic suggestions, so only these two explicit commands enable explanations. The check concerns this extension's candidates; editor word suggestions and other extensions operate independently.
5. **Per-element array feedback**: the four ElastoDyn/AeroDyn node arrays verified in the previous release are checked for element count, integer type, lower bounds and a uniquely known local upper bound when counts are explicit and valid. Diagnostics target individual elements and are delayed on the active line. Zero counts allow ignored placeholders; unknown upper bounds do not produce range errors; repeated nodes are not prohibited. Controlled by `openfast.enableTableFieldDiagnostics`, with no automatic repair or changes to pre-run rules.
6. **Theme preview and overlap handling**: read-only previews include deliberately invalid enums, unresolved references, signed Fortran exponents and AeroDyn arrays. Field-group dotted lines yield to definition/reference or active-cell borders. Semantic types remain consistent across three built-in theme checks. Previews support visual comparison and are not complete solver inputs.
7. **Repeatable performance regression checks**: completion benchmarks and reports are available; see [Performance benchmarks](Development.md#performance-benchmarks) for usage and comparison limits.

## Highlighting and input assistance (0.14.0)

1. **Restorable display presets**: **OpenFAST: Switch Highlighting and Hint Preset** offers reading, table and structure views, changing display settings only. The first application persistently saves original overrides; restoration works after multiple preset changes, including removing overrides that did not originally exist. Scope priority is current folder, workspace, then user; folders retain separate backups.
2. **Field error explanations**: table hovers show actual values, expected types, units, explicit choices and current errors. Verified references link to definition lines. Lightbulbs offer individual parameter-name or enum-spelling fixes, applied only when selected; existing numeric/character fixes remain.
3. **Missing-path alternatives**: **OpenFAST: Find Alternatives for Missing Path**, also available from the diagnostic lightbulb, previews the old and replacement values before acceptance. Search covers the current directory, two subdirectory levels and known case references, capped at 24 directories, 600 entries and 300 references. At most 24 candidates are checked, reading at most 128 KiB per header. Module mismatches rank lower and unknown headers are labeled. Quotes, comments, separators and PotFile/FilenameRoot root-name conventions are preserved. Hidden directories and links are skipped; changed documents cancel replacement; files are not saved automatically.
4. **Next unfilled field**: **OpenFAST: Next Unfilled Table Field** selects a field-name placeholder or missing trailing cell and opens suggestions. Complete tables produce no target. Missing tails are filled from the first missing field; unknown variable counts use only the confirmed prefix. Physical values are not filled. Documents are limited to two million characters for this command.
5. **Optional field groups**: `openfast.highlightTableFieldGroups` distinguishes definition, reference, geometry and coefficient fields with themed dotted lines. Disabled by default and capped at 2,000 visible cells, it preserves semantic colors and existing large-document local highlighting.
6. **Verified array assistance**: count-aware positions, templates and node-range candidates cover ElastoDyn `BldGagNd/TwrGagNd` and AeroDyn `BlOutNd/TwOutNd`, alongside `LinTimes`. Rules follow [ElastoDyn v4.0.5](https://openfast.readthedocs.io/en/v4.0.5/source/user/elastodyn/input.html#outputs) and [AeroDyn v4.0.5](https://openfast.readthedocs.io/en/v4.0.5/source/user/aerodyn/input.html#outputs) and are restricted to version 4.0. Unknown versions show a verification reminder; explicitly selected other versions disable these additions. Node bounds must be uniquely known in the current file; `BlOutNd` does not infer bounds from blade files and still offers placeholders. Zero, duplicate or invalid counts generate no values; templates stop if extra elements already exist. Candidates are capped at 500, selected nodes rank lower, and numeric spelling and element separators are preserved.
7. **Candidate evidence**: path, table-reference, JOutLst and output suggestions identify case references, module verification, definition sources or previously selected items; existing priorities and natural numeric sorting remain.
8. **Measured performance report**: **OpenFAST: Show Editor Performance** opens a read-only session report with actual completion/highlighting/snapshot durations, cache hits and document size. It retains up to 24 operation categories and the latest 128 samples per category. Mean/max cover cumulative calls; p95 uses recent samples. Async waits and cancellations are included, so this is not a response-latency benchmark. Run again to refresh.
9. **Possible column shifts**: when a fixed-width row is exactly one cell short and has type/enum conflicts, feedback checks whether inserting a gap could explain the shift and lists possible missing fields. Ambiguous all-numeric rows, unknown variable counts and unsupported cases are not inferred. Feedback is informational and does not move data or alter strict pre-run checks.

## Reading, navigation and candidate selection (0.13.0)

1. **Natural sorting**: table IDs, JOutLst, path names and numbered channels sort by numeric segments, with `2` before `10`. Existing-item demotion, path roles and case relevance are preserved.
2. **List summaries**: reference candidates show definition coordinates/field summaries up to 80 characters, retaining full details separately. Outputs show units, quantity categories and cataloged meanings; searching still uses English channel names only.
3. **Current-value hints**: `openfast.showCurrentValueHint` shows fixed-option meanings and explicitly cataloged units on the active scalar line. Compact density shortens labels; detailed density retains hover descriptions. Unknown units are not guessed. Disabled by default.
4. **Highlight preview**: **OpenFAST: Preview Highlighting and Hints** opens read-only OpenFAST, HydroDyn, MoorDyn or ElastoDyn samples beside native settings. Samples are not solver templates and do not run simulations or check sample paths. They use current-window settings; verify folder-specific overrides in actual files.
5. **Table crosshair**: a themed focus border distinguishes the active cell from its row and column. With table highlighting and hints enabled, the status bar shows the physical column, field and unit, including during horizontal scrolling.
6. **Upstream control sources**: child-file scalar hovers show confirmed upstream reference roles, control fields, values, source files and links from the current case graph. The selected main case takes priority. Hints are omitted for ambiguous roots, duplicate definitions, changed paths or an unavailable graph. They describe reference activation, not every physical applicability condition, and do not change dimming rules.
7. **Browse output quantities**: on a blank line in an ordinary OutList, **OpenFAST: Browse Output Channels by Quantity** offers motion/attitude, forces/loads, wind/waves, generator/control and other cataloged groups, then lets you select channels. Uses current-module built-in, dynamic and supplemental candidates, excludes existing entries and preserves quoting/indentation. Node lists retain their dedicated completion.
8. **Stable highlighting**: unchanged document versions and decoration ranges are not resubmitted. Regression tests continue to cover partial numbers, quotes and semantic-token deltas.
9. **Stable path candidates**: async verification updates only selected-candidate details, preserving list order, inserted text and replacement ranges. Repeated/concurrent resolution does not duplicate module details; later requests can rank from the verified cache.
10. **Diagnostic deduplication**: a cell's type/enum error suppresses derived reference errors; extra-cell feedback replaces duplicate column-count feedback at the same location. Distinct cells/rules and strict pre-run output are preserved.

## Field consistency and contextual assistance (0.12.0)

1. **Variable-length NodeLocs**: explicit NOutLoc controls positions, units, signatures and numeric feedback. Zero counts create no items; unknown counts map only the known prefix.
2. **Shared table rules**: editing and pre-run checks share field types, enums and special values. Active-line feedback is deferred while pre-run checking remains strict.
3. **JOutLst suggestions**: complete existing JointIDs element by element, showing definition summaries and current/total positions. Selected items rank lower; replacement preserves other elements, separators and comments.
4. **Table special values**: FillDens offers DEFAULT; transverse Cp/CpMG fields in the three coefficient models offer MCF. Other numeric values remain editable. Field coverage follows the [HydroDyn coefficient documentation](https://openfast.readthedocs.io/en/v4.0.5/source/user/hydrodyn/input_files.html#hydrodynamic-coefficients).
5. **Typed row templates**: recognized fixed-column tables offer unused IDs, defined references and enums. Physical quantities retain field-name placeholders; variable lists require explicit counts.
6. **Navigation**: go to/peek definitions and find references for confirmed relationships within a document. Duplicate definitions return multiple locations; cross-file relationships are not guessed.
7. **Local Chinese-edit protection**: the 800 ms quiet period applies to changed Chinese-text lines, allowing completion elsewhere. Line-count changes clear old ranges. Protection still relies on committed text changes.
8. **Large-file context**: documents over 2 MB cache distant table/output anchors for visible highlighting and reference completion, including split editors. Limits are 12,000,000 characters, 250,000 lines, 4,096 anchors and 800 lines per window. Definition samples are capped at 256 rows per table and 2,048 overall. Beyond limits, basic syntax remains; local indexes do not suggest unused IDs because global occupancy is unknown.
9. **Custom input constraints**: supplemental parameters accept valueType (`number/integer/boolean/string`), options (up to 50) and specialValues (up to 20) for suggestions, hover and editing diagnostics. Values are single ASCII tokens up to 80 characters, without whitespace, quotes or expression fragments. Built-in rules take priority; entries are isolated by resource/module/version.
10. **Theme compatibility**: custom semantic types declare standard parent types and base syntax scopes, supporting light, dark and high-contrast inheritance.

Dictionary example: `{"module":"SeaState","kind":"parameter","name":"CustomWave","description":"Custom wave mode","valueType":"integer","options":["1","2"],"specialValues":["DEFAULT"]}`.

## Safe editing and candidate feedback (0.11.0)

1. **Definition/reference roles**: `openfast.highlightSymbolRoles` assigns confirmed definitions, valid references and unresolved references separate semantic scopes plus borders, dotted lines or waves in the visible area. Disabled by default; follows theme colors. Full-document relationship decorations are skipped above two million characters.
2. **Safe rename**: native Rename Symbol supports recognized MoorDyn point/line IDs and line-type names, and verified HydroDyn/SubDyn structural definition columns. It updates resolved references in the same document with native edit-review metadata. Collisions, duplicate definitions, noncanonical IDs and uncertain relationships stop the operation. HydroDyn member coefficient/output tables and `JOutLst` participate. Comments, dynamic channel names and cross-file references are not renamed by text matching.
3. **Table type feedback**: checks known integer/enum/numeric fields while allowing supported `DEFAULT/MCF`. Active-line type/reference checks wait until you leave the line. Unknown physical ranges are not guessed; `openfast.enableTableFieldDiagnostics` disables the added feedback.
4. **Extra-cell positions**: marks individual cells beyond the header and suggests checking alignment. Unknown `FillNumM` prevents guessing later positions. Data is not moved automatically.
5. **Repeated fill members**: duplicate HydroDyn `FillMList` members receive informational feedback; selected members rank lower but remain selectable. This is not a solver error and is not applied to other reference columns where repeats are allowed.
6. **Path content verification**: known module mismatches for roles such as `EDFile/HydroFile` are explained and demoted. Read failures, unknown headers and files over 128 KiB are identified. Small directories pre-read at most 24 candidates; larger ones verify on selection. Unverified does not mean compatible.
7. **Compact long signatures**: tables over nine columns show first/last fields and up to two neighbors on each side of the current field, at most seven fields. Physical column and variable-list size remain visible. Disable `openfast.compactTableSignatures` for all fields; types/units remain available.
8. **Numeric-part highlighting**: `openfast.highlightNumericParts` separates leading signs, mantissas and `E/D` exponents of complete numbers. Partial exponents retain basic highlighting; values and precision are unchanged. Themes can style `openfastNumericSign/openfastNumericExponent`.
9. **Cursor after completion**: paths retain one quote pair; directories leave the cursor before the closing quote. Accepting an ID/enum at an incomplete table row end adds a tab for the next field, preserving existing separators and later cells. Tab display follows editor indentation settings.
10. **Input stability**: Chinese/Japanese/Korean changes trigger an 800 ms quiet period for replacement corrections and editing diagnostics. Delayed numeric/character feedback and candidate details check versions, closure and cancellation. VS Code exposes no public IME composition-state event, so this protects committed changes rather than detecting every uncommitted composition.

OutList continues to search English names. This release adds no Chinese output search, shortcuts or automatic configuration rewrites.

## Complex formats and input assistance (0.10.0)

1. **Incomplete table rows**: existing cells retain field highlighting without guessed values for remaining fields; blank positions can show the next field.
2. **Multiline file lists**: known AeroDyn `AFNames` and ServoDyn `BStCfiles/TStCfiles/NStCfiles/SStCfiles` counts enable path highlighting, file suggestions and current/total hints on continuation lines, including empty entries and partial quotes. Counts follow physical lines and stop at the next parameter/section. Unknown, zero or over-10,000 counts do not infer continuation ranges. Unsaved files show positions only; save before relative-path completion.
3. **Separate output lists**: completion and deduplication respect each list's boundaries. ElastoDyn blade-node lists use 42 families verified against official source, separate from ordinary OutList candidates. Quoted `END` is supported. Uncertain node-list types do not infer families; other modules' node channels are not yet included.
4. **Variable fields**: valid explicit HydroDyn `FillNumM` expands `FillMList`, correctly positioning later `FillFSLoc/FillDens` highlighting, column emphasis, units, hovers and inline hints. Member references complete defined MemberIDs. Incomplete/invalid counts retain only the confirmed prefix.
5. **Field hints**: table signatures show field order, current column, type and available units, including empty cells and recognized variable fields. Controlled by `openfast.enableTableHints`.
6. **Character checks**: delayed feedback detects zero-width characters, unexpected BOMs, full-width spaces, curly quotes and Unicode minus signs in structured records. The initial BOM and comments are preserved. Manual ASCII fixes are offered only for definite numeric minus signs, full-width spaces outside values and complete curly-quote pairs. Real spaces in paths remain; uncertain invisible characters receive feedback only. Controlled by `openfast.enableNumericAssistance`.
7. **New IDs**: recognized definition ID columns suggest the first five unused positive integers. Reference columns suggest existing definitions only. These candidates do not recommend connectivity or physical quantities.
8. **Control dependencies**: selecting a control parameter emphasizes controlled parameter names confirmed by existing rules. Control-field hovers list related parameters; controlled fields retain applicability hints, including when disabled.
9. **Workspace dictionary**: `openfast.dictionary` filters by resource, module, entry kind and optional version, supplying parameter/output completion, hover and unknown-field feedback. Entries are labeled as supplemental, do not override built-ins or change solver physics, and are limited to 500 entries with 4,000-character descriptions. Unknown versions retain entries for review.
10. **Quote consistency**: single and double quotes share pairing, string/comment exclusions and selection wrapping. Existing closing quotes can be skipped; path completion retains one existing pair.

Example workspace settings:

```json
{
  "openfast.dictionary": [
    {
      "module": "SeaState",
      "kind": "parameter",
      "name": "ResearchWave",
      "description": "Custom wave parameter for an experimental branch; verify its input format.",
      "versions": ["5.0"]
    },
    {
      "module": "SeaState",
      "kind": "output",
      "name": "MyWaveProbe",
      "description": "Wave-elevation probe output for an experimental branch.",
      "unit": "m"
    }
  ]
}
```

Rule sources: [HydroDyn filled members](https://openfast.readthedocs.io/en/v4.0.5/source/user/hydrodyn/input_files.html), [ElastoDyn nodal outputs](https://openfast.readthedocs.io/en/v3.5.3/source/user/elastodyn/EDNodalOutputs.html) and [nodal-output source](https://github.com/OpenFAST/openfast/blob/main/modules/elastodyn/src/ElastoDyn_AllBldNdOuts_IO.f90). Node-channel data includes verification dates and source SHA-256 hashes. OutList search remains English-only.

## Editing stability and candidate accuracy (0.9.0)

1. **Partial input highlighting**: bare minus signs, partial exponents and recoverable unclosed quotes retain value/parameter separation. Recovery affects editor highlighting only; pre-run checks remain strict. Basic syntax also recognizes partial numbers.
2. **Linked definitions and references**: selecting a recognized table ID/name or reference emphasizes related occurrences. Point IDs, line IDs and circular/rectangular properties use separate definition-table scopes.
3. **Precise token feedback**: duplicate channels and missing references mark actual tokens. Uncataloged parameters receive informational spelling suggestions, not automatic invalidity judgments. Missing definition tables do not imply reference errors.
4. **Condition-aware candidates**: known control fields demote disabled parameter names; value/path details explain conditions. All candidates remain accessible. Missing controls do not imply disabled states.
5. **Definition summaries**: reference candidates include definition locations and up to five other fields, such as connection type, coordinates or diameter, with available units.
6. **Precise OutList completion**: replaces only the current channel in multiple-channel, comma-separated or single/double-quoted entries. Unquoted channels are quoted and replaced atomically, preserving minus signs and neighbors without suffix remnants in insert mode. Two hundred alias spellings sharing official ElastoDyn output indexes, such as `LSSTipPxa/Azimuth` and `LSSTipVxa/RotSpeed`, inform duplicate feedback and demotion within that module.
7. **Local style**: booleans follow nearby complete-record casing. New paths/unquoted channels follow nearby quote styles; directory continuation follows existing path separators. Explicit existing quoting/separators take priority. Numeric precision and whole-file formatting are unchanged.
8. **Version labels**: verified version rules flag inapplicable parameter candidates; removed fields are deprecated. Unknown target versions retain all candidates.
9. **Lazy descriptions**: full value, parameter and channel details are generated on selection. Directories over 100 entries return basic candidates first, then read selected file headers; subsequent requests can rank from cached headers. Read limits, cancellation and stale-request protection remain.
10. **Incremental highlighting and fallback**: normal documents support semantic-token deltas without submitting partial results on cancellation. Above two million UTF-16 characters, analysis covers the visible area and refreshes on scrolling, retaining basic syntax. Local parsing uses the preceding 30 lines and file header; distant table/list boundaries may initially receive basic highlighting only. Later large-file context improvements are described under 0.12.0.

Alias source: [OpenFAST ElastoDyn SetOutParam](https://github.com/OpenFAST/openfast/blob/main/modules/elastodyn/src/ElastoDyn.f90). The rule snapshot includes source SHA-256 and verification date. OutList Chinese search is not provided.

## Enhanced highlighting and input assistance (0.8.0)

1. **Dynamic numbered channels**: suggestions use known blade counts, blade/tower gauge counts, wind/wave point counts and actual MoorDyn line IDs. Gauge numbers follow gauge order. Missing/ambiguous counts retain static suggestions without guessing channel families.
2. **Table enums**: field-specific MoorDyn `Attachment` and HydroDyn `PropPot/MSecGeom` candidates include official rule sources.
3. **Open numeric values**: `DEFAULT` is suggested when original descriptions explicitly allow it. Ordinary numbers remain open inputs rather than closed enums.
4. **Fuzzy parameter correction**: recognizes adjacent transpositions, missing letters and case errors, prioritizing current-module and common parameters.
5. **Case-aware ranking**: paths prioritize resolved case references, then header module and field role. Ambiguous multiple roots do not share inferred context. Headers are limited to 128 KiB, at most 24 per request, with 128 cached entries.
6. **Array/matrix positions**: emphasizes the active array element or matrix row/column and shows element index, degree of freedom and unit within the visible area.
7. **Numeric format assistance**: after approximately 650 ms of inactivity, flags Chinese separators, repeated decimal points and partial exponents. Exponent warnings wait on the active line. Manual separator fixes preserve significant digits and comments; ambiguous formats are not rewritten automatically.
8. **Hint density**: `openfast.hintDensity` accepts `compact/standard/detailed`; `openfast.highlightArrayMatrix` and `openfast.enableNumericAssistance` are independently controlled.
9. **Completion ranges**: unquoted scalars, parameter names, tables and channels support VS Code insert/replace modes, replacing the current token by default. Quoted paths use atomic replacement. Multiple cursors require matching field semantics and safe selections.
10. **Shared caches and cancellation**: editor providers share versioned parse results. Text caches hold at most eight entries/four million characters; stale path results are discarded. Actual BOM, tab, CRLF and Chinese/English positions are preserved.

Verified sources: [MoorDyn input](https://moordyn.readthedocs.io/en/latest/inputs.html), [HydroDyn input](https://openfast.readthedocs.io/en/main/source/user/hydrodyn/input_files.html) and [ElastoDyn channel definitions](https://github.com/OpenFAST/openfast/blob/main/modules/elastodyn/src/ElastoDyn_IO.f90). Coverage is limited to known rules; OutList search remains English-only.

## Highlighting and input assistance (0.7.0)

- **Contextual highlighting**: ordinary English descriptions are not uniformly colored as parameters. Parameter records, OutList channels, headers and special values are distinguished. `unused/none/DEFAULT/ranlux/fixed/vessel/N/A` share special-value handling with booleans; arrays distinguish numeric tokens. Unclosed quotes do not carry string coloring into the next line.
- **Reference styling**: recognized paths use semantic type `openfastPath`, inheriting string styling. Customize `editor.semanticTokenColorCustomizations.rules.openfastPath` without changing the theme. Existing diagnostics still mark missing files.
- **Path suggestions**: enter a quote, `/` or `\` in a recognized reference, or invoke suggestions, to browse files/folders relative to the current configuration. Candidates rank by parameter role; directories keep the cursor inside quotes. Single/double quotes, empty/partial paths, spaces and `!` are supported. `PotFile` candidates for `.hst/.1` insert root names; `FilenameRoot` strips `.wnd`. Recognized AeroDyn `AFNames` continuation lines also offer completion.
- **Fixed choices**: automatic suggestions filter by typed prefixes; explicit suggestions or the existing fixed-value command show all choices. Details include sources, conditions and known version notes. Blank/partial booleans and recognized ROSCO scalar records with names after `!` are supported; only values are replaced.
- **Table editing**: highlights the active row and matching header/column, with inline field names and units. Completes defined MoorDyn points, line types and recognized node/property references. Point candidates exclude line IDs; property definitions follow known section types.
- **Parameter correction**: suggests current-module/common names only in existing value/name records, replacing names without inserting lines. Includes known migration warnings. Use official templates for new configurations; the extension does not reorder fields automatically.
- **Section folding**: uses parsed section headings and `END` without requiring fixed English heading keywords.

These commands are available in the Command Palette without assigned shortcuts:

| Command | Behavior |
| --- | --- |
| **OpenFAST: Insert table row snippet** | Inserts a navigable fixed-column template at the recognized table end. Fill field-name placeholders with actual values; it does not copy IDs, guess physical quantities or change counts. Variable-width `FillMList` templates are not supported by this initial feature. |
| **OpenFAST: Preview table count updates** | Produces a read-only diff for recognized counts. Review and apply it, or run **OpenFAST: Apply previewed table count updates**. Changed sources require a new preview. The entire application is undoable and does not save automatically. Incomplete columns or field-name placeholders prevent synchronization. |
| **OpenFAST: Insert Array Value Template** | Initially supports `LinTimes/NLinTimes` with 1–1,000 navigable elements. Existing positions retain values; new positions need actual times. Inline hints show actual/required counts. |
| **OpenFAST: Insert common output channel group** | On a blank line before `END` in an existing output area, select a group and preview channel selection. Uses cataloged current-module channels, excludes existing entries and preserves quotes/indentation. Includes platform motion, blade-root/tower-base loads, generator, wave and wind groups; it is not a complete channel database. |

`openfast.inactiveParameterOpacity` controls disabled-parameter opacity (0.1–1, default 0.48). `openfast.highlightActiveTableColumn`, `openfast.enablePathSuggestions`, `openfast.enableTableSuggestions` and `openfast.enableParameterNameSuggestions` default to enabled and can be disabled separately. `openfast.showCurrentValueHint` defaults to off; when enabled, it explains fixed choices on the active line. `openfast.enableTableHints` continues to control table/array hints.

OutList completes English channel names without Chinese search. Assistance requires recognized formats; unknown modules, tables and values without explicit rules are not inferred.

## Eight added features (0.2.0)

| Feature | Usage and behavior |
| --- | --- |
| Live parameter diagnostics | Squiggles and the Problems view flag known invalid enums/types, duplicate fields, missing references and related issues. |
| Inactive-parameter dimming | WindType, WaveMod, controller and module switches dim inactive records; hovers explain conditions. |
| Cross-file checks | Opening a main file triggers checks. Use the editor or configuration-tree check button for **Check entire case**, covering known QTF exclusivity, external wave kinematics, time-step and environmental consistency. |
| Semantic case comparison | Use the editor comparison button and select two main files. Compares parameters, OutList and recognized tables by reference role, ignoring comments, whitespace and equivalent numeric spelling. Produces a read-only report; **Export case comparison** saves Markdown. |
| OutList suggestions | Suggests module-specific channels with localized meanings and cataloged units. Existing channels are labeled and demoted; duplicates still receive feedback. |
| Configuration tree | The Explorer's **OpenFAST Configuration** view expands main files and references, opens selected files, and marks inactive, missing and circular references. Refresh updates the file list. |
| Table assistance | Active rows show field names; hovers show units/descriptions. Checks column/row counts, duplicate IDs and known node/property references. |
| Version adaptation | **OpenFAST: Select OpenFAST version** or settings selects auto, 3.5, 4.0, 4.1, 4.2, 5.0 or main, affecting verified choices, migration warnings and documentation entry points. |

These features default to enabled without custom shortcuts. Existing hover, fixed-choice completion and icon customization remain. Unsaved edits participate in checks/comparisons; inputs are not saved or modified automatically.

Auto version detection uses explicit OpenFAST versions in the first 15 header lines; child files can inherit the current main-file version. Without a known version, line-defined choices are used. Verified rules cover CompAero/CompElast changes and some added/removed 5.0 fields, not complete version-specific input validation. Older versions use available official documentation entry points; uncertain anchors are not fabricated.

The built-in catalog has 119 channel records. Unknown channels remain editable and are not rejected directly. Table assistance recognizes 161 built-in fields, not arbitrary numeric files or every module format. The case graph reads up to 300 text configurations by default, at most 2 MB each. Binary wind fields, DLLs and WAMIT coefficients are checked for existence without executing or comparing their contents. Comparison traverses enabled text references; unrecognized tables, unit-line changes, comments and output order are excluded. Read failures and file limits are reported.

### Using output channel suggestions

In a module's OutList or OUTPUT CHANNELS / OUTPUTS area, start a line before END and type a double quote or channel prefix, such as `"Rot`, `"Wave` or `"Gen`. Select a candidate to insert it; quotes and both letter cases trigger suggestions.

Existing channels are marked as already added and ranked lower; the channel currently being edited is not marked against itself. Version 0.2.0 filtered all existing channels and could leave real cases without candidates; this was fixed in 0.2.1.

**OpenFAST: Output suggestion settings** opens the switch directly; you can also search settings for `@id:openfast.enableOutputSuggestions`. String quick suggestions default to enabled for OpenFAST only, without changing global settings. Explicitly disabled editor suggestions are respected.

## Running FST directly (0.2.2)

1. Click **OpenFAST path** in the lower-right status bar, or run **OpenFAST: Configure executable path**, and choose your OpenFAST executable, such as openfast_x64.exe. Alternatively, enter its full path under `@id:openfast.executablePath` in settings. Running requires a trusted workspace folder; a window with only a single file prompts you to open a folder first.
2. Open the main `.fst/.fstf` and click ▶ in the editor title bar. Alternatively, choose **OpenFAST: Run FST** from the Explorer context menu or use the configuration-tree run button.
3. The program runs in a VS Code task terminal and enters the run queue. Its working directory is the main file's directory. The terminal shows output directly; OpenFAST writes results according to its inputs. Use **Terminal → Terminate Task** to stop it.

If no executable is configured, the first run opens a picker and saves the path. If the setting is unavailable or cannot be written in the current window, workspace extension storage retains it as a fallback; manual settings.json edits are unnecessary. The same FST cannot start twice concurrently. Pre-run checks cover the main file and enabled references. Relevant unsaved files are listed; choosing to save and check saves them and repeats validation. Known errors, unreadable configurations and reference limits block execution; ordinary warnings require confirmation. Unrelated modified files remain untouched. Separate process arguments support Chinese, spaces and special characters without constructing a shell command. Execution requires a trusted local workspace, has no assigned shortcut and is never triggered by opening or editing a file.

## Running TurbSim with one click

1. Open a trusted local workspace and a TurbSim primary input (.inp/.in/.dat/.txt). Detection requires NumGrid_Z, NumGrid_Y, TimeStep and AnalysisTime within the first 150 lines and 64,000 characters. Auxiliary time-series, spectrum and profile inputs, and output files cannot run directly.
2. Click **TurbSim path** in the status bar or use **TurbSim: Configure executable path** to select the program (for example TurbSim_x64.exe). The setting `openfast.turbSimExecutablePath` is independent of the OpenFAST path. The first run opens a picker if unset; extension storage provides a fallback when settings cannot be written.
3. Click ▶ in the editor title or use **TurbSim: Run primary input file** from the Explorer context menu. This menu may also appear on other files with the same generic extensions; execution validates their contents. A running input cannot be started twice.

The current primary input is saved before launch; a failed save blocks execution. The program receives the full input path as a separate argument and runs in its directory. Raw output appears in a VS Code task terminal; use **Terminal → Terminate Task** to stop it. Nonzero exits display an error pointing to the terminal. TurbSim tasks do not enter the OpenFAST queue or progress monitor and do not use OpenFAST case preflight checks. Save modified auxiliary files yourself; TurbSim validates the actual inputs. Detection accepts text files up to 2 MB. Opening or editing a file never starts execution.

## Run workflow (0.5.0)

- **Shared pre-run checks**: single and batch runs use the same case graph for relevant unsaved edits, enabled references, known parameter rules and cross-file constraints. References are rediscovered after saving. Save failures, errors and incomplete reads block execution; related save/check dialogs are handled sequentially.
- **Run-log diagnostics**: raw stdout/stderr remains in the terminal. After execution, recognized errors and localized explanations appear in Problems. Diagnostics target a file/parameter only when uniquely identifiable, otherwise the main-file start. An unrecognized nonzero exit receives a generic error. Reruns clear the case's old run diagnostics.
- **Batch queue**: **OpenFAST: Run FST batch** selects multiple `.fst/.fstf` files. The Explorer's **OpenFAST Run Queue** shows waiting, running, succeeded, failed and cancelled states. Cancel one/all, retry failed/cancelled cases or open case directories.
- **Concurrency**: `openfast.runConcurrency` defaults to `1`, accepts `1–16`, and applies on the next case submission. Cancelling processes occupy their slots until fully terminated, preventing premature retries. Queue state lasts for the current window and is not restored after reload.

Log analysis uses the last 1,000,000 characters and produces at most 50 diagnostics. Raw terminal retention follows its scrollback setting. Common error explanations do not cover every OpenFAST/controller DLL log format. Case-directory actions open the main file's directory. Offline pre-run checks do not replace OpenFAST validation.

## Calculation progress monitoring (0.6.1)

A waveform **OpenFAST Progress** icon appears by default in the left Activity Bar alongside Explorer, Search and Extensions. It opens the task list. Startup does not open the monitor or scan processes. Scanning occurs every five seconds only while either the sidebar or editor monitor is visible; when both are closed or in the background, scanning and timed UI refresh stop. Showing either refreshes immediately. Stopping monitoring does not stop simulations. **Open in Editor** expands the list; the status bar and queue title also open the monitor. After upgrading, run **Developer: Reload Window** once. If you previously hid the icon, re-enable it from the Activity Bar context menu.

The list shows case, status, PID, simulation time/TMax, percentage, elapsed time, monitor-estimated remaining time, OpenFAST remaining time and progress source. Search by name/path/PID; filter running/waiting, all session tasks, finished or failed tasks. The compact sidebar opens case details including paths, working directory, command line, report time and original native ETA, plus case-directory and log-link actions.

Progress collection follows the local `OpenFAST_Monitor` Rust implementation:

- In trusted local Windows workspaces, discovers OpenFAST processes every five seconds and refreshes the visible interface every second. The Windows x64 package includes a read-only native probe for command lines, working directories and creation times, including WOW64 processes. Relative `.fst/.fstf` paths resolve against the solver's actual working directory and need not belong to the workspace. If the probe cannot run, CIM fallback resolves relative paths only through a unique workspace match.
- Extension tasks and external processes are deduplicated by PID; external identities also use creation time. Insufficient argument permissions still show the task with a read issue. The monitor does not guess working directories or terminate solvers.
- Reads same-root `.log/.stdout.log/.stdout` files updated since the current launch, case-directory logs, `runs/<attempt>/stdout.log`, `stderr.log`, and logs referenced by PID-matching `run_status.json`. Directory logs are used automatically only with one active case in that directory. Multiple processes for the same case require explicit log association. Launch time excludes stale logs/outputs; reads are capped at the last 128 KiB per file.
- Uses the last complete data row of a same-root text `.out` for simulation time and FST TMax for percentage, ignoring incomplete trailing rows. Logs and text output can both supply progress; the newer simulation time wins. `.outb` alone without logs does not imply live progress.
- **Monitor estimated remaining** uses elapsed time and simulation progress. **OpenFAST remaining** independently reads the latest complete `Estimated final completion at ... (in ... days)` report and is never replaced by the monitor estimate. Incomplete new ETA text does not overwrite a previous complete report. Solver days are rounded, so converted durations are approximate. Text-output-only progress can show the monitor estimate while native ETA remains `—`.
- Native remaining time retains the latest solver report without counting down and becomes `—` after completion. Estimated completion keeps the original local clock text without inventing a date. Details flag reports older than 30 seconds without treating staleness as process termination.
- Existing processes remain running even when logs contain fatal-error hints. After exit, current-run logs or PID-matching status evidence determine normal/failed completion; without evidence, exit status is unknown. Extension tasks retain queue states. Query failures preserve previous process state.

Up to 100 finished records are retained and can be cleared. Reload rediscovers processes still running. External discovery is Windows-only; the native probe is x64-only, with CIM fallback on other Windows architectures. On other systems, extension-started tasks still receive console progress. Remote windows and untrusted workspaces do not read local processes. External tasks without logs or text outputs show process state only; previously emitted output from another terminal cannot be recovered.

The package includes the Windows x64 probe; users do not need Rust. See [Native probe](Development.md#native-probe) for rebuild instructions.

## Parameter sweeps and case generation (0.6.0)

Open a baseline `.fst/.fstf` and use the sweep icon in the editor/configuration-tree title, or run **OpenFAST: Create parameter sweep**:

1. Select up to eight numeric scalars and enter comma- or space-separated values, such as `8, 10, 12`. D/E exponents are supported; range expressions are not.
2. Review combinations, configuration-file counts, estimated write volume and shared resources. After editing values, update the combination preview before generating into a new directory.
3. Select a parent folder. The extension creates a timestamped sweep directory; after generation, submit the generated cases to the existing run queue.

At most 200 Cartesian-product combinations are generated. Candidates exclude known inactive parameters, references, arrays, fixed choices and common counts. Combinations that change references/activation or violate known parameter/cross-file constraints are rejected. Preview uses the opening snapshot, including unsaved edits; reopen to capture new changes.

Each case gets independent text configurations, including recognized ROSCO controller inputs. A multiply referenced text file is copied once per case. Configuration references become relative paths; wind fields, DLLs and WAMIT coefficients remain shared through absolute paths. Original research inputs are not rewritten. Copy shared resources separately when moving to another computer. Only recognized references are handled; unknown third-party controller/custom-module paths need manual review.

The root `sweep-manifest.json` records the baseline, parameter values, shared resources and generated main files. Existing directories are not overwritten. Failed writes leave an `.incomplete.json` marker and any written files for inspection. Running is offered only after successful complete generation.

## Quick output preview (0.6.0)

Run **OpenFAST: Preview output results** and select up to four local `.out/.outb` files, or use the Explorer context menu. Supports standard OpenFAST text outputs and binary IDs 1, 2, 3 and 4, including compressed time/channels, uncompressed double precision and long channel names. Binary handling follows the [official OpenFAST toolbox reader](https://github.com/OpenFAST/openfast_toolbox/blob/main/openfast_toolbox/io/fast_output_file.py).

- Search/select up to four channels, enter start/end times in seconds and update curves/statistics. Channels have separate plots; cross-file overlays require unambiguous matching names and units. Duplicate names within a file include physical column numbers.
- Shows finite/nonfinite counts, mean, population standard deviation, minimum and maximum in the interval. NaN/Inf are excluded from statistics and counted separately. Time must be finite and strictly increasing.
- Time-bucketed curves retain endpoints and extrema, capped at 2,000 points each. Statistics use all finite samples in the interval. Hover or left/right arrow keys inspect retained points; source files are unchanged.
- **Export statistics CSV** saves source paths, channel names, columns, units, requested intervals and full-sample statistics. It exports a statistics table, not downsampled curves or raw time series.

Streaming/chunked reads avoid loading entire results into the editor, though large files still take time to scan. Closing preview cancels reads. File-size or modification-time changes during reading require reopening to avoid mixing unfinished simulation results. Preview is read-only, does not run models, and uses the VS Code theme with offline scripts.

Initial metadata reading shows cancellable progress. Text headers are limited to 1,000,000 bytes per line and 4,000,000 scanned bytes in total; oversized or malformed headers are rejected. Data lines retain a 32,000,000-byte limit. UTF-8 headers and LF, CRLF, and CR line endings are supported.

The configuration-tree line-chart icon also selects outputs; `.out/.outb` editor titles offer a preview icon, so the Command Palette is optional.

## Configuration file icons

Since 0.1.4, local customization of the active **vscode-icons** theme replaces only `.fst/.dat` icons with turbine-and-wave SVGs for light/dark backgrounds. Other files, folders and custom associations are preserved. `.fstf` and DISCON.IN icons are unchanged.

Run **OpenFAST: Apply FST/DAT icons (keep current theme)**. It writes two SVGs into the vscode-icons custom directory, merges `.fst/.dat` associations and invokes **Apply Icons Customization**, without changing `workbench.iconTheme`. Settings prefer the current workspace, falling back to user scope. The approach follows [vscode-icons custom icons](https://github.com/vscode-icons/vscode-icons/wiki/Custom) and [association configuration](https://github.com/vscode-icons/vscode-icons/wiki/FineTuning).

Only vscode-icons currently supports this local customization. Other themes lack a unified VS Code partial-override API, so they are preserved and reported as unsupported rather than replaced. Icon changes do not alter language detection.

Extension-based associations show the new icon for all DAT files, including shared blade/tower, BeamDyn and airfoil-polar files, without opening them first.

## Supported scope

The built-in catalog contains 477 parameter records (including module-specific namesakes), 161 table fields and 119 output records, plus dynamic explanations for arbitrarily numbered MoorDyn end-tension channels. Coverage focuses on OpenFAST main files, ElastoDyn, InflowWind, ServoDyn, SeaState, HydroDyn and MoorDyn. AeroDyn, structural properties and ROSCO have common descriptions. BeamDyn, SubDyn and TurbSim headers are recognized, but their full parameter sets are not cataloged.

Explanations use actual current-document values, never assuming example-case wind speeds, durations, rotor speeds or activation states apply elsewhere. Applicability hints cover common wind, controller, linearization and some sea/hydrodynamic switches, not complete version validation. Unknown fields retain original English descriptions and identify missing catalog coverage. Existing `! 中文说明：` comments join original descriptions in **Line comments**, preserving all text without overriding built-ins or requiring translated text in source configurations.

The official link index contains 408 module-parameter entries, based on the [OpenFAST documentation](https://openfast.readthedocs.io/en/main/source/this_doc.html) main branch and referenced MoorDyn inputs, verified on 2026-10-09. It records actual sections containing descriptive paragraphs, tables or definition lists, without fabricating anchors from parameter names. It is not a complete site/PDF index; an absent link means only that the current index lacks it. Catalogs and links are packaged for offline hover/search; only opening an external link accesses the web.

Parameter choices and formats vary by OpenFAST version. Original file descriptions and official documentation for your version take priority. Explanations/checks are offline; only explicit run actions invoke the configured OpenFAST or TurbSim executable. A running model may load its configured controller DLLs.

Fixed choices prioritize current-line `{1=...; 2=...}`, `[1=..., 2=...]` or parenthesized descriptions, including booleans and groups such as `[10, 11, or 12]`. Without them, common built-in module choices are marked for version review. Continuous quantities, matrices, arrays and paths without closed choice sets receive no fixed-choice menu. For example, `NumCrctn`'s `0=no correction` is a special value, not a full enum. The current seven-file local case has 102 selectable scalar fields. The fixed-choice menu does not currently support ROSCO values before `! parameter-name`, or variable-phase expressions such as `WaveMod=1P#`; enter these manually.

## Settings

Run **OpenFAST: Open all extension settings**, or search `@ext:hclonely.openfast-helper`. Uninstall the old `openfast-local.openfast-config-helper` extension to avoid duplicate registrations/providers. Standard settings remain usable; executable paths stored only in the old extension's private fallback storage must be selected again through the status bar.

| Setting | Default | Purpose |
| --- | --- | --- |
| `openfast.highlightSymbolRoles` | `false` | Definition/reference semantic roles and borders |
| `openfast.highlightNumericParts` | `false` | Leading signs and scientific exponents |
| `openfast.compactTableSignatures` | `true` | Compact long signatures; disable for all fields |
| `openfast.enableTableFieldDiagnostics` | `true` | Table types, extra cells and repeated fill members |
| `openfast.language` | `auto` | Automatic / Simplified Chinese / English |
| `openfast.autoDetect` | `true` | Content-based OpenFAST/ROSCO/TurbSim text-format detection |
| `openfast.enableHover` | `true` | Localized hover explanations |
| `openfast.showOriginalDescription` | `true` | Complete line comments |
| `openfast.enableValueSuggestions` | `true` | Fixed-choice suggestions and lightbulb selector |
| `openfast.executablePath` | Empty | Full OpenFAST executable path |
| `openfast.turbSimExecutablePath` | Empty | Full TurbSim executable path, independent of OpenFAST |
| `openfast.runConcurrency` | `1` | Concurrent runs (1–16); applies on next submission |
| `openfast.enableDiagnostics` | `true` | Live diagnostics |
| `openfast.dimInactiveParameters` | `true` | Dim inactive parameters |
| `openfast.enableCrossFileChecks` | `true` | Known cross-file constraints |
| `openfast.enableOutputSuggestions` | `true` | Module-specific OutList candidates |
| `openfast.enableTableHints` | `true` | Active table row field names and units |
| `openfast.version` | `auto` | Explicit version detection or manual selection |
| `openfast.maxReferencedFiles` | `300` | Text references per case (10–1,000) |

## Display language

`openfast.language = "auto"` follows the VS Code interface: Simplified Chinese for Chinese interfaces, English otherwise. Select `zh-CN` or `en` in settings, or run **OpenFAST: Select display language**, to change hover, lookup, suggestions, diagnostics and run messages immediately. Command menus, settings titles and view names use VS Code's interface-language `package.nls` resources; overriding extension runtime language does not change the VS Code interface.

All 477 parameters, 161 table fields and 119 channels include English and Chinese descriptions. Existing file comments retain their original language. Chinese mode labels blocks “内置说明” and “行尾注释”; English mode uses **Built-in description** and **Line comments**. English, Chinese and mixed comments are shown in full, including text before “中文说明：”, even when they repeat the built-in explanation. `openfast.showOriginalDescription` controls the entire line-comments block.

Generated lookup labels, fixed choices, table descriptions, diagnostics, run messages and new comparison reports support both languages. File comments, section headings, paths, parameter/channel/module names, original official section titles and OpenFAST/OS output retain their original text. Existing/exported reports retain their generation language; compare again after switching to create a report in the selected language.

## Development

See the [Development Guide](Development.md) for building, testing, native probe rebuilding and GitHub Actions.

## Sources

The catalog draws on original local English descriptions, existing Chinese annotations and local output-header units, with references to the [OpenFAST user documentation](https://openfast.readthedocs.io/en/main/source/user/index.html), [MoorDyn inputs](https://moordyn.readthedocs.io/en/latest/inputs.html) and [ROSCO documentation](https://rosco.readthedocs.io/en/latest/source/rosco.html). Highlighting and hover use VS Code's [language extension facilities](https://code.visualstudio.com/api/language-extensions/overview) and [HoverProvider API](https://code.visualstudio.com/api/language-extensions/programmatic-language-features).
