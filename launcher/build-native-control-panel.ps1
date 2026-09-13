[CmdletBinding()]
param(
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$launcherDirectory = Split-Path -Parent $PSCommandPath
$projectRoot = Split-Path -Parent $launcherDirectory
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $outputPath = Join-Path $projectRoot 'KLineTrainingCamp.ControlPanel.exe'
} else {
    $outputPath = [IO.Path]::GetFullPath($OutputPath)
}
$assetDirectory = Join-Path $launcherDirectory 'assets'
$iconPath = Join-Path $assetDirectory 'KLineTrainingCamp.ico'
$iconPreviewPath = Join-Path $assetDirectory 'KLineTrainingCamp.png'
$iconGeneratorSource = Join-Path $launcherDirectory 'BrandIconGenerator.cs'
$sources = @(
    (Join-Path $launcherDirectory 'NativeProcessSupervisor.cs'),
    (Join-Path $launcherDirectory 'NativeUpdateService.cs'),
    (Join-Path $launcherDirectory 'NativeControlPanel.cs')
)
$compilerCandidates = @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $compiler) {
    Write-Error 'Unable to find .NET Framework csc.exe. Enable the .NET Framework 4.x developer tools and retry.'
    exit 1
}

$missingSource = (@($sources) + @($iconGeneratorSource)) | Where-Object { -not (Test-Path -LiteralPath $_) }
if ($missingSource) {
    Write-Error ("Missing native control panel source file: {0}" -f ($missingSource -join ', '))
    exit 1
}

$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ('KLineTrainingCamp.Icon.' + [Guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $assetDirectory -Force | Out-Null
    New-Item -ItemType Directory -Path (Split-Path -Parent $outputPath) -Force | Out-Null
    New-Item -ItemType Directory -Path $temporaryDirectory -Force | Out-Null
    $iconGeneratorExe = Join-Path $temporaryDirectory 'KLineTrainingCamp.IconGenerator.exe'
    $iconCompilerArguments = @(
        '/nologo',
        '/target:exe',
        '/optimize+',
        '/reference:System.Drawing.dll',
        ("/out:{0}" -f $iconGeneratorExe),
        $iconGeneratorSource
    )

    & $compiler @iconCompilerArguments
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $iconGeneratorExe)) {
        throw 'Native icon generator compilation failed.'
    }

    & $iconGeneratorExe $iconPath $iconPreviewPath
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $iconPath)) {
        throw 'Native application icon generation failed.'
    }

    $compilerArguments = @(
        '/nologo',
        '/target:winexe',
        '/optimize+',
        '/reference:System.Drawing.dll',
        '/reference:System.Management.dll',
        '/reference:System.IO.Compression.FileSystem.dll',
        '/reference:System.Windows.Forms.dll',
        '/reference:System.Web.Extensions.dll',
        '/reference:Microsoft.CSharp.dll',
        ("/win32icon:{0}" -f $iconPath),
        ("/out:{0}" -f $outputPath)
    ) + $sources

    Write-Host "Building $outputPath"
    & $compiler @compilerArguments
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outputPath)) {
        throw 'Native control panel compilation failed.'
    }
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
finally {
    if (Test-Path -LiteralPath $temporaryDirectory) {
        $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        $resolvedTemporaryDirectory = [IO.Path]::GetFullPath($temporaryDirectory)
        $temporaryLeaf = Split-Path -Leaf $resolvedTemporaryDirectory
        if ($resolvedTemporaryDirectory.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -and $temporaryLeaf.StartsWith('KLineTrainingCamp.Icon.', [StringComparison]::Ordinal)) {
            Remove-Item -LiteralPath $resolvedTemporaryDirectory -Recurse -Force
        }
    }
}

Write-Host "Build complete: $outputPath"
exit 0
