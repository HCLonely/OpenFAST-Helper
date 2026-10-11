param([switch]$WithVSIcons, [switch]$Packaged)
$ErrorActionPreference = 'Stop'
$env:OPENFAST_TEST_EXECUTABLE = (Get-Command node -ErrorAction Stop).Source
$extensionRoot = Split-Path -Parent $PSScriptRoot
$testRoot = Join-Path $extensionRoot 'test-results'
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$taskWorkspace = Join-Path $testRoot 'task-workspace'
New-Item -ItemType Directory -Path $taskWorkspace -Force | Out-Null
$developmentRoot = $extensionRoot
if ($WithVSIcons) {
    $iconsSource = Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE '.vscode/extensions') -Directory -Filter 'vscode-icons-team.vscode-icons-*' | Select-Object -First 1
    if (-not $iconsSource) { throw 'vscode-icons extension not installed' }
    $extensionsRoot = Join-Path $testRoot 'extensions'
    New-Item -ItemType Directory -Path $extensionsRoot -Force | Out-Null
    $iconsTarget = Join-Path $extensionsRoot $iconsSource.Name
    if (-not (Test-Path -LiteralPath $iconsTarget)) { Copy-Item -LiteralPath $iconsSource.FullName -Destination $iconsTarget -Recurse }
    # Windows PowerShell may pass the decoded JSON array as one pipeline object.
    $installedEntries = Get-Content -LiteralPath (Join-Path $env:USERPROFILE '.vscode/extensions/extensions.json') -Raw | ConvertFrom-Json
    $entry = @($installedEntries) | Where-Object { $_.identifier.id -eq 'vscode-icons-team.vscode-icons' } | Select-Object -First 1
    if (-not $entry) { throw 'vscode-icons extension metadata not found' }
    $entry.location.path = '/' + $iconsTarget.Replace('\', '/')
    $entry.relativeLocation = $iconsSource.Name
    ConvertTo-Json -InputObject @($entry) -Depth 20 | Set-Content -LiteralPath (Join-Path $extensionsRoot 'extensions.json') -Encoding utf8
    $userFolder = Join-Path $testRoot 'user-data/User'
    New-Item -ItemType Directory -Path $userFolder -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $userFolder 'settings.json') -Value '{"openfast.language":"zh-CN","workbench.iconTheme":"vscode-icons","vsicons.dontShowNewVersionMessage":true,"vsicons.projectDetection.disableDetect":true}' -Encoding utf8
    # The test host disables unrelated extensions; declare the test-only dependency
    # in an isolated development copy so the real icon generator can be exercised.
    $developmentRoot = Join-Path $testRoot 'development-with-icons'
    New-Item -ItemType Directory -Path $developmentRoot -Force | Out-Null
    foreach ($component in @('src', 'out', 'bin', 'package.nls.json', 'package.nls.zh-cn.json', 'data', 'icons', 'syntaxes', 'language-configuration.json')) {
        Copy-Item -LiteralPath (Join-Path $extensionRoot $component) -Destination $developmentRoot -Recurse -Force
    }
    $manifest = Get-Content -LiteralPath (Join-Path $extensionRoot 'package.json') -Raw | ConvertFrom-Json
    $manifest | Add-Member -NotePropertyName extensionDependencies -NotePropertyValue @('vscode-icons-team.vscode-icons') -Force
    $manifest | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $developmentRoot 'package.json') -Encoding utf8
}
$codeCmd = (Get-Command code -ErrorAction Stop).Source
if ($Packaged) {
    if (-not $WithVSIcons) { throw 'Packaged regression requires -WithVSIcons' }
    $packageManifest = Get-Content -LiteralPath (Join-Path $extensionRoot 'package.json') -Raw | ConvertFrom-Json
    $vsix = Join-Path $extensionRoot ('dist/' + $packageManifest.name + '-' + $packageManifest.version + '.vsix')
    & $codeCmd --user-data-dir (Join-Path $testRoot 'user-data') --extensions-dir (Join-Path $testRoot 'extensions') --install-extension $vsix --force | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot install packaged extension in isolated host' }
    $developmentRoot = Join-Path $testRoot 'production-harness'
    New-Item -ItemType Directory -Path $developmentRoot -Force | Out-Null
    $harness = @{name='openfast-production-test';publisher='local-test';version='1.0.0';engines=@{vscode='^1.85.0'};main='./index.js';activationEvents=@('onStartupFinished');extensionDependencies=@(($packageManifest.publisher + '.' + $packageManifest.name),'vscode-icons-team.vscode-icons')}
    $harness | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $developmentRoot 'package.json') -Encoding utf8
    Set-Content -LiteralPath (Join-Path $developmentRoot 'index.js') -Value 'exports.activate=()=>{};' -Encoding utf8
}
$codeExe = (Resolve-Path -LiteralPath (Join-Path (Split-Path -Parent $codeCmd) '../Code.exe')).Path
$arguments = @(
    '--disable-gpu', '--skip-welcome', '--skip-release-notes', '--new-window', '--disable-workspace-trust',
    ('--user-data-dir="' + (Join-Path $testRoot 'user-data') + '"'),
    ('--extensions-dir="' + (Join-Path $testRoot 'extensions') + '"'),
    ('--extensionDevelopmentPath="' + $developmentRoot + '"'),
    ('--extensionTestsPath="' + (Join-Path $extensionRoot 'test/host-test.js') + '"')
    ('"' + $taskWorkspace + '"')
)
if (-not $WithVSIcons) { $arguments += '--disable-extensions' }
$hostProcess = Start-Process -FilePath $codeExe -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $testRoot 'host-stdout.log') -RedirectStandardError (Join-Path $testRoot 'host-stderr.log')
Write-Output ('VS Code isolated test PID: ' + $hostProcess.Id)
