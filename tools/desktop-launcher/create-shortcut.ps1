# Creates the "Ledgerline" desktop shortcut: npm run launcher:shortcut
# It points at launch.cmd and uses design/brand/ledgerline.ico. Run it again to refresh the shortcut
# (for example after moving the folder). -Directory puts the shortcut somewhere other than the desktop.
param(
  [string]$Directory = [Environment]::GetFolderPath('Desktop'),
  [string]$Name = 'Ledgerline'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$target = Join-Path $PSScriptRoot 'launch.cmd'
$icon = Join-Path $repoRoot 'design\brand\ledgerline.ico'

if (-not (Test-Path $icon)) {
  Write-Error "The icon is missing: $icon. Run 'npm run launcher:icon' first."
}
if (-not (Test-Path $Directory)) {
  Write-Error "The folder does not exist: $Directory"
}

$path = Join-Path $Directory "$Name.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($path)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $repoRoot
$shortcut.IconLocation = "$icon,0"
$shortcut.Description = 'Start Ledgerline if it is not running, then open it in the browser'
$shortcut.WindowStyle = 1
$shortcut.Save()

Write-Output "Created $path"
