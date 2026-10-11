param([string]$CargoPath = 'cargo', [switch]$Test)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Join-Path $projectRoot 'native/openfast-probe/Cargo.toml'
if ($Test) {
    & $CargoPath test --manifest-path $manifest --locked
    if ($LASTEXITCODE -ne 0) { throw 'Probe tests failed' }
}
& $CargoPath build --manifest-path $manifest --release --locked
if ($LASTEXITCODE -ne 0) { throw 'Probe build failed' }
New-Item -ItemType Directory -Path (Join-Path $projectRoot 'bin') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'native/openfast-probe/target/release/openfast-probe.exe') -Destination (Join-Path $projectRoot 'bin/openfast-probe.exe') -Force
