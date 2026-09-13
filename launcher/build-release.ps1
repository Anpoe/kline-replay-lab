[CmdletBinding()]
param(
    [string]$OutputDirectory,
    [string]$NodeExecutable,
    [string]$NativeExecutable,
    [string]$ReleaseVersion
)

$ErrorActionPreference = 'Stop'

$launcherDirectory = Split-Path -Parent $PSCommandPath
$projectRoot = Split-Path -Parent $launcherDirectory
$webSource = Join-Path $projectRoot 'web'
$nativeBuildScript = Join-Path $launcherDirectory 'build-native-control-panel.ps1'

function Resolve-ReleaseVersion {
    param([string]$Configured)

    $candidate = $Configured
    if ([string]::IsNullOrWhiteSpace($candidate)) { $candidate = $env:KLINE_RELEASE_VERSION }
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        try { $candidate = (& git -C $projectRoot describe --tags --exact-match --match 'v[0-9]*' 2>$null).Trim() } catch { }
    }
    if ([string]::IsNullOrWhiteSpace($candidate)) { return '0.0.0-dev' }
    $candidate = $candidate.Trim()
    if ($candidate.StartsWith('v')) { $candidate = $candidate.Substring(1) }
    if ($candidate -notmatch '^\d+\.\d+\.\d+(?:\.\d+)?$') {
        throw "ReleaseVersion must be a semantic version such as 0.1.2; found $candidate."
    }
    return $candidate
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $projectRoot 'artifacts\KLineTrainingCamp-Portable'
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$zipPath = $OutputDirectory.TrimEnd('\') + '.zip'

function Resolve-NodeExecutable {
    param([string]$Configured)

    if (-not [string]::IsNullOrWhiteSpace($Configured)) {
        $resolved = [IO.Path]::GetFullPath($Configured)
        if (-not (Test-Path -LiteralPath $resolved)) { throw "Node executable not found: $resolved" }
        return $resolved
    }

    $configuredFromEnvironment = $env:KLINE_NODE_EXE
    if (-not [string]::IsNullOrWhiteSpace($configuredFromEnvironment)) {
        $resolved = [IO.Path]::GetFullPath($configuredFromEnvironment)
        if (-not (Test-Path -LiteralPath $resolved)) { throw "KLINE_NODE_EXE does not point to an existing file: $resolved" }
        return $resolved
    }

    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($command -and $command.Source) { return [IO.Path]::GetFullPath($command.Source) }
    throw 'Node.js 22.13 or newer is required to build the release package.'
}

function Resolve-NpmCommand {
    param([string]$NodePath)

    $sibling = Join-Path (Split-Path -Parent $NodePath) 'npm.cmd'
    if (Test-Path -LiteralPath $sibling) { return $sibling }
    $command = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($command -and $command.Source) { return $command.Source }
    throw 'npm.cmd was not found next to Node.js or on PATH.'
}

function Invoke-Checked {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$Description
    )

    Write-Host $Description
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Description failed with exit code $LASTEXITCODE." }
}

function Copy-WebSource {
    param([string]$Destination)

    $excludedDirectories = @(
        (Join-Path $webSource 'node_modules'),
        (Join-Path $webSource 'dist'),
        (Join-Path $webSource '.next'),
        (Join-Path $webSource '.vinext'),
        (Join-Path $webSource '.wrangler'),
        (Join-Path $webSource '.local-data'),
        (Join-Path $webSource '.playwright-cli'),
        (Join-Path $webSource 'coverage'),
        (Join-Path $webSource 'artifacts'),
        (Join-Path $webSource 'outputs'),
        (Join-Path $webSource 'work')
    )
    $robocopyArguments = @($webSource, $Destination, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/XD') + $excludedDirectories
    & robocopy.exe @robocopyArguments
    if ($LASTEXITCODE -gt 7) { throw "Copying web source failed with robocopy exit code $LASTEXITCODE." }
}

$nodePath = Resolve-NodeExecutable $NodeExecutable
$npmPath = Resolve-NpmCommand $nodePath
$nodeVersionText = (& $nodePath '--version').Trim()
if ($nodeVersionText -notmatch '^v(\d+)\.(\d+)\.') { throw "Unable to determine Node.js version from $nodeVersionText." }
$nodeMajor = [int]$Matches[1]
$nodeMinor = [int]$Matches[2]
if ($nodeMajor -lt 22 -or ($nodeMajor -eq 22 -and $nodeMinor -lt 13)) {
    throw "Node.js 22.13 or newer is required; found $nodeVersionText."
}

$nativeExecutableForRelease = $NativeExecutable
$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ('KLineTrainingCamp.Release.' + [Guid]::NewGuid().ToString('N'))
$stageRoot = Join-Path $temporaryDirectory 'KLineTrainingCamp-Portable'
$stageWeb = Join-Path $stageRoot 'web'
$stageRuntime = Join-Path $stageRoot 'runtime'

if (-not [string]::IsNullOrWhiteSpace($nativeExecutableForRelease)) {
    $nativeExecutableForRelease = [IO.Path]::GetFullPath($nativeExecutableForRelease)
    if (-not (Test-Path -LiteralPath $nativeExecutableForRelease)) { throw "Native executable not found: $nativeExecutableForRelease" }
} else {
    $nativeExecutableForRelease = Join-Path $temporaryDirectory 'KLineTrainingCamp.ControlPanel.exe'
}

try {
    New-Item -ItemType Directory -Path $stageWeb -Force | Out-Null
    New-Item -ItemType Directory -Path $stageRuntime -Force | Out-Null

    Copy-WebSource $stageWeb
    Invoke-Checked $npmPath @('--prefix', $stageWeb, 'ci', '--no-audit', '--no-fund') 'Installing locked release dependencies'
    Invoke-Checked $npmPath @('--prefix', $stageWeb, 'run', 'build') 'Building the production WebUI'

    if ([string]::IsNullOrWhiteSpace($NativeExecutable)) {
        Invoke-Checked (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $nativeBuildScript, '-OutputPath', $nativeExecutableForRelease) 'Building the native control panel'
    }

    Copy-Item -LiteralPath $nativeExecutableForRelease -Destination (Join-Path $stageRoot 'KLineTrainingCamp.ControlPanel.exe') -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot '启动本地网页版.bat') -Destination (Join-Path $stageRoot '启动本地网页版.bat') -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination (Join-Path $stageRoot 'README.md') -Force
    Copy-Item -LiteralPath $nodePath -Destination (Join-Path $stageRuntime 'node.exe') -Force

    $nodeDirectory = Split-Path -Parent $nodePath
    foreach ($licenseName in @('LICENSE', 'LICENSE.txt', 'README.md')) {
        $licensePath = Join-Path $nodeDirectory $licenseName
        if (Test-Path -LiteralPath $licensePath) { Copy-Item -LiteralPath $licensePath -Destination (Join-Path $stageRuntime $licenseName) -Force }
    }

$gitRevision = 'local-build'
    try {
        $gitRevision = (& git -C $projectRoot rev-parse --short HEAD).Trim()
        if ([string]::IsNullOrWhiteSpace($gitRevision)) { $gitRevision = 'local-build' }
    } catch { }
    $resolvedReleaseVersion = Resolve-ReleaseVersion $ReleaseVersion
    $manifest = [ordered]@{
        product = 'K线训练营 2.0'
        version = $resolvedReleaseVersion
        commit = $gitRevision
        webServer = 'vinext-bundled'
        runtime = 'bundled-node'
        ports = [ordered]@{ data = 3100; web = 3101; worker = 3102 }
        builtAtUtc = [DateTime]::UtcNow.ToString('o')
    }
    ($manifest | ConvertTo-Json -Depth 4) | Set-Content -LiteralPath (Join-Path $stageRoot 'release-manifest.json') -Encoding UTF8

    $privatePaths = @(
        'AGENTS.md',
        'docs'
    )
    foreach ($privatePath in $privatePaths) {
        if (Test-Path -LiteralPath (Join-Path $stageRoot $privatePath)) { throw "Private development content leaked into the release package: $privatePath" }
    }

    # Build/runtime state must never be distributed. A clean package starts
    # with the checked-in sample database and creates fresh state on first run.
    $releaseExcludedDirectories = @(
        (Join-Path $stageWeb '.wrangler'),
        (Join-Path $stageWeb '.local-data')
    )

    if (Test-Path -LiteralPath $OutputDirectory) { Remove-Item -LiteralPath $OutputDirectory -Recurse -Force }
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    New-Item -ItemType Directory -Path (Split-Path -Parent $OutputDirectory) -Force | Out-Null
    $releaseCopyArguments = @($stageRoot, $OutputDirectory, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/XD') + $releaseExcludedDirectories
    & robocopy.exe @releaseCopyArguments
    if ($LASTEXITCODE -gt 7) { throw "Copying the release package failed with robocopy exit code $LASTEXITCODE." }

    foreach ($excludedDirectoryName in @('.wrangler', '.local-data')) {
        $excludedDirectoryPath = Join-Path (Join-Path $OutputDirectory 'web') $excludedDirectoryName
        if (Test-Path -LiteralPath $excludedDirectoryPath) { throw "Build/runtime state leaked into the release package: $excludedDirectoryName" }
    }

    $sevenZip = Get-Command 7z.exe -ErrorAction SilentlyContinue
    if ($sevenZip) {
        Push-Location (Split-Path -Parent $OutputDirectory)
        try {
            & $sevenZip.Source 'a' '-tzip' $zipPath (Split-Path -Leaf $OutputDirectory) | Out-Host
            if ($LASTEXITCODE -ne 0) { throw "7-Zip failed with exit code $LASTEXITCODE." }
        } finally {
            Pop-Location
        }
    } else {
        Compress-Archive -Path (Join-Path $OutputDirectory '*') -DestinationPath $zipPath -Force
    }

    Write-Host "Release directory: $OutputDirectory"
    Write-Host "Release archive: $zipPath"
}
finally {
    if (Test-Path -LiteralPath $temporaryDirectory) {
        try {
            $quotedTemporaryDirectory = '"' + $temporaryDirectory + '"'
            Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/c', 'rmdir', '/s', '/q', $quotedTemporaryDirectory) -WindowStyle Hidden | Out-Null
        } catch {
            Write-Warning ("Temporary release staging cleanup could not be scheduled: " + $_.Exception.Message)
        }
    }
}

exit 0
