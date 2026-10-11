# OpenFAST process probe

Read-only Windows x64 process enumeration and PEB/WOW64 parameter reader adapted from the user-provided `D:/GithubProgram/AI/OpenFAST_Monitor/src/process.rs` on 2026-10-09. The reference repository is unchanged. This probe has no GUI and emits one JSON snapshot to stdout. It opens processes only with query/read permissions and never terminates a solver. Native layouts are isolated in process.rs; failures retain PID and report a parameter error.

Changes: JSON CLI, executable path, configurable executable name, .fstf support. Build using `scripts/build-process-probe.ps1`; end users do not need Rust. `bin/openfast-probe.exe` is included in VSIX; Cargo sources and lockfile are retained here for reproducibility, excluded from VSIX.
