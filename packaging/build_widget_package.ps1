<#
.SYNOPSIS
Build the distributable Windows widget package from a reviewed commit.

.DESCRIPTION
Every file is read out of the git object store with `git show <ref>:<path>`, never
from the working tree, so an uncommitted or untracked file cannot reach the
package. The staged tree is then scanned for personal medication data before it
is compressed; the build fails closed if anything matches.

A previous package shipped a real regimen inside `medication_schedule.json` and
named a hospital and a drug in its README. That data survived a plaintext history
scan because a zip is DEFLATE-compressed and the scan could not see inside it.
Hence the scan here runs against the STAGED PLAINTEXT, before compression.

.EXAMPLE
pwsh -File packaging/build_widget_package.ps1 -Ref HEAD -Version v3
#>
[CmdletBinding()]
param(
  [string] $Ref = 'HEAD',
  [Parameter(Mandatory)][string] $Version,
  [string] $OutputDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (& git rev-parse --show-toplevel)
if ($LASTEXITCODE -ne 0) { throw 'Not inside a git repository.' }
$repoRoot = $repoRoot.Trim()
if (-not $OutputDirectory) { $OutputDirectory = $repoRoot }

$resolvedRef = (& git rev-parse --verify "$Ref^{commit}")
if ($LASTEXITCODE -ne 0) { throw "Cannot resolve git ref: $Ref" }
$resolvedRef = $resolvedRef.Trim()

# Source path in the repo -> destination name inside the package.
$payload = [ordered]@{
  'medication_reminder.py'      = 'medication_reminder.py'
  'medication_core.py'          = 'medication_core.py'
  'sync_client.py'              = 'sync_client.py'
  'medication_schedule.json'    = 'medication_schedule.json'
  'medication_icon.ico'         = 'medication_icon.ico'
  'requirements.txt'            = 'requirements.txt'
  'run_medication_reminder.bat' = 'run_medication_reminder.bat'
  'install_dependencies.bat'    = 'install_dependencies.bat'
  'build_windows_exe.bat'       = 'build_windows_exe.bat'
  'packaging/widget-README.md'  = 'README.md'
}

# Personal medication data that must never ship, stored as SHA-256 of the
# lowercased term. Hashes, not literals: a denylist written in plain text is
# itself a disclosure, and this file is committed to a public repository. The
# first version of this script listed the drug names outright and was caught by
# the history scan before it was ever published.
#
# To add a term:  python -c "import hashlib;print(hashlib.sha256(b'<lowercase>').hexdigest().upper())"
$forbiddenHashes = [Collections.Generic.HashSet[string]]::new([string[]] @(
  '6F718B4226C33753734D93F3DAB2D7B50CAD664C70BF468F6CDDC8296DE8ED28'
  'CA8CD5E8EB41623C1BB357C76B5FE3C121D26EE75A5969481DF07F0A9F46C7B7'
  'CAECC5E44B044EADFA15BD273AD30F3FAEE8A38524EA8B059B18694F8946EFF6'
  '8C1EC4FA9E80839BCD63D6339E486B136C90AEE791F044FE431AFBAD3C96D568'
  '920EDDE59B13E5A5F94316B1A207F1CC2CEDB299A4DB7390D6C92FB7098D749E'
  '83C99FAA3D38124E04FAADD462587385B6718823B068728B57591DFAF55176B2'
  '1C457FD6984BD1909F2278D61C2D6B67545E8BB83461E61E7CDB31A7838762BD'
  '3B1B4399AC9727C0EB8E119CDC550BD63D9A65A6F776E1D3F087C874D2C6A604'
  'AB8FF70846E0D1679B1C1574954FBC8E2404AD53AB97A877D8024EE4548EA51D'
  '6167CDC1BEF986F0FED8C4813997B38D12011EB9488A76A57CF009DB06488A98'
  'AA260D27847DEC909FC58915657CC8C0E6F61AD7B28FE094583A6A665DE788BA'
))

function Get-TermHash {
  param([Parameter(Mandatory)][string] $Term)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    return [BitConverter]::ToString(
      $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Term.ToLowerInvariant()))
    ).Replace('-', '')
  } finally { $sha.Dispose() }
}

function Find-ForbiddenTerms {
  <#
    Tokenise to lowercase words and adjacent word pairs, hash each, and match
    against the denylist. Pairs are needed because some terms are two words.
  #>
  param([Parameter(Mandatory)][AllowEmptyString()][string] $Text)
  $tokens = [Text.RegularExpressions.Regex]::Matches($Text.ToLowerInvariant(), '[a-z]+')
  $found = @()
  for ($i = 0; $i -lt $tokens.Count; $i++) {
    $single = $tokens[$i].Value
    if ($forbiddenHashes.Contains((Get-TermHash $single))) { $found += (Get-TermHash $single) }
    if ($i + 1 -lt $tokens.Count) {
      $pair = "$single $($tokens[$i + 1].Value)"
      if ($forbiddenHashes.Contains((Get-TermHash $pair))) { $found += (Get-TermHash $pair) }
    }
  }
  return $found
}

$packageName = "Medication_Reminder_Widget_Windows_$Version"
$stageRoot = Join-Path ([IO.Path]::GetTempPath()) "medication-widget-$Version-$([guid]::NewGuid().ToString('N'))"
$stage = Join-Path $stageRoot 'MedicationReminderWidget'
$zipPath = Join-Path $OutputDirectory "$packageName.zip"

if (Test-Path -LiteralPath $zipPath) {
  throw "Refusing to overwrite an existing package: $zipPath"
}

$extractRoot = Join-Path $stageRoot 'extract'
New-Item -ItemType Directory -Path $stage -Force | Out-Null
New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
try {
  # -- Binary-safe extraction: git archive | tar preserves bytes exactly, whereas
  #    piping `git show` through PowerShell decodes stdout as text and corrupts
  #    the .ico. Same pattern the Pages release runbook uses.
  $tarPath = Join-Path $stageRoot 'payload.tar'
  & git archive --format=tar --output=$tarPath $resolvedRef -- @($payload.Keys)
  if ($LASTEXITCODE -ne 0 -or
      -not (Test-Path -LiteralPath $tarPath -PathType Leaf) -or
      (Get-Item -LiteralPath $tarPath).Length -eq 0) {
    throw "Failed to archive the package payload from $resolvedRef."
  }
  & tar.exe -xf $tarPath -C $extractRoot
  if ($LASTEXITCODE -ne 0) { throw 'Failed to extract the package payload.' }

  foreach ($source in $payload.Keys) {
    $extracted = Join-Path $extractRoot $source
    if (-not (Test-Path -LiteralPath $extracted -PathType Leaf)) {
      throw "Not present at ${resolvedRef}: $source"
    }
    $destination = Join-Path $stage $payload[$source]
    Move-Item -LiteralPath $extracted -Destination $destination -Force
    if (-not (Test-Path -LiteralPath $destination -PathType Leaf) -or
        (Get-Item -LiteralPath $destination).Length -eq 0) {
      throw "Extracted file is missing or empty: $source"
    }
  }

  # -- The schedule that ships must be an empty seed, never a real regimen.
  $schedulePath = Join-Path $stage 'medication_schedule.json'
  $schedule = Get-Content -Raw -LiteralPath $schedulePath | ConvertFrom-Json
  if (@($schedule.events).Count -ne 0) {
    throw 'The packaged medication_schedule.json is not empty; refusing to ship a real schedule.'
  }

  # -- Fail-closed scan of the staged plaintext, before compression hides it.
  $hits = @()
  foreach ($file in Get-ChildItem -LiteralPath $stage -Recurse -File) {
    $bytes = [IO.File]::ReadAllBytes($file.FullName)
    $text = [Text.Encoding]::UTF8.GetString($bytes)
    foreach ($hash in (Find-ForbiddenTerms -Text $text)) {
      # Report the hash prefix, never the matched term -- an error message is a
      # disclosure channel too, and these land in logs and CI output.
      $hits += "$($file.Name): denylisted term $($hash.Substring(0, 8))"
    }
  }
  if ($hits.Count) {
    throw "Personal medication data found in the staged package:`n  $($hits -join "`n  ")"
  }

  Compress-Archive -Path $stage -DestinationPath $zipPath -CompressionLevel Optimal
  if (-not (Test-Path -LiteralPath $zipPath -PathType Leaf) -or
      (Get-Item -LiteralPath $zipPath).Length -eq 0) {
    throw 'Package creation reported success but the archive is missing or empty.'
  }

  [pscustomobject]@{
    Package = $zipPath
    Commit  = $resolvedRef
    Files   = @($payload.Keys).Count
    Bytes   = (Get-Item -LiteralPath $zipPath).Length
    Scanned = "$($forbiddenHashes.Count) denylisted term hashes, 0 hits"
  }
} finally {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
}
