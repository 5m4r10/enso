# Copies the shared domain rules into the Apps Script project, then pushes.
# Usage (from repo root):  .\scripts\sync-domain.ps1 [-NoPush]
param([switch]$NoPush)

$root = Split-Path -Parent $PSScriptRoot
$src  = Join-Path $root 'web\domain.js'
$dst  = Join-Path $root 'gas\Domain.js'

$header = "// GENERATED from web/domain.js by scripts/sync-domain.ps1 - do not edit.`r`n"
Set-Content -Path $dst -Value ($header + (Get-Content $src -Raw)) -Encoding UTF8 -NoNewline
Write-Host "Domain.js synced."

if (-not $NoPush) {
  Push-Location (Join-Path $root 'gas')
  clasp push
  Pop-Location
}
