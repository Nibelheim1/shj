$ErrorActionPreference = 'Stop'

$workspace = [System.IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
$dist = Join-Path $workspace 'dist'
$release = Join-Path $workspace 'release'
$stage = Join-Path $release '.taptap-stage'
$folderName = 'shanhai-qixia-h5'
$packageRoot = Join-Path $stage $folderName
$archive = Join-Path $release 'shanhai-qixia-h5-taptap.zip'
$maxArchiveBytes = 300MB

function Assert-WorkspaceChild([string] $PathToCheck) {
  $resolved = [System.IO.Path]::GetFullPath($PathToCheck)
  $prefix = $workspace.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify a path outside the workspace: $resolved"
  }
}

Assert-WorkspaceChild $stage
Assert-WorkspaceChild $archive

Write-Host '[TapTap] Building the H5 release...'
& node (Join-Path $workspace 'build-dist.js')
if ($LASTEXITCODE -ne 0) {
  throw "H5 build failed with exit code $LASTEXITCODE."
}

$entry = Join-Path $dist 'index.html'
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) {
  throw 'The H5 build did not produce dist/index.html.'
}

New-Item -ItemType Directory -Path $release -Force | Out-Null
if (Test-Path -LiteralPath $stage) {
  Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null

Get-ChildItem -LiteralPath $dist -Force | Copy-Item -Destination $packageRoot -Recurse -Force

if (Test-Path -LiteralPath $archive) {
  Remove-Item -LiteralPath $archive -Force
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $stage,
  $archive,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $false
)

$zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
try {
  $files = @(
    $zip.Entries |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_.Name) } |
      ForEach-Object { $_.FullName.Replace('\', '/') }
  )

  if ($files.Count -eq 0) {
    throw 'The TapTap archive is empty.'
  }

  $unexpected = @($files | Where-Object { -not $_.StartsWith("$folderName/", [System.StringComparison]::Ordinal) })
  if ($unexpected.Count -gt 0) {
    throw "The archive contains entries outside its single top-level folder: $($unexpected -join ', ')"
  }

  $expectedEntry = "$folderName/index.html"
  if ($files -notcontains $expectedEntry) {
    throw "The archive does not contain $expectedEntry."
  }
}
finally {
  $zip.Dispose()
}

$archiveBytes = (Get-Item -LiteralPath $archive).Length
if ($archiveBytes -ge $maxArchiveBytes) {
  throw ('The TapTap archive is {0:N2} MB; it must be smaller than 300 MB.' -f ($archiveBytes / 1MB))
}

Remove-Item -LiteralPath $stage -Recurse -Force

Write-Host ('[TapTap] Package ready: {0}' -f $archive)
Write-Host ('[TapTap] ZIP size: {0:N2} MB' -f ($archiveBytes / 1MB))
Write-Host ('[TapTap] Layout: {0}/index.html' -f $folderName)
