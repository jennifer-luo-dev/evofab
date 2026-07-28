[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [string]$PilotUser,
    [Parameter(Mandatory)]
    [string]$SourceOrcaConfig,
    [string]$WorkspaceRoot = 'C:\EvoFab\OrcaWorkspace',
    [string]$BackupRoot = 'C:\EvoFab\OrcaWorkspace-Backups',
    [securestring]$PilotPassword
)

$ErrorActionPreference = 'Stop'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $BackupRoot "orca-config-$timestamp"
$folders = 'incoming', 'projects', 'exports', 'profile-workbench', 'profile-releases'

if (-not (Test-Path -LiteralPath $SourceOrcaConfig -PathType Container)) {
    throw 'SourceOrcaConfig must be the folder opened by OrcaSlicer Help > Show Configuration Folder.'
}

if (-not $PilotPassword) {
    $PilotPassword = Read-Host -AsSecureString "Password for $PilotUser"
}

if ($PSCmdlet.ShouldProcess($backup, 'Create profile backup and manifest')) {
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    Copy-Item -LiteralPath $SourceOrcaConfig -Destination (Join-Path $backup 'source') -Recurse -Force
    Get-ChildItem -LiteralPath (Join-Path $backup 'source') -File -Recurse |
        Get-FileHash -Algorithm SHA256 |
        Select-Object Path, Algorithm, Hash |
        Export-Csv -NoTypeInformation -Path (Join-Path $backup 'manifest.csv')
}

if (-not (Get-LocalUser -Name $PilotUser -ErrorAction SilentlyContinue)) {
    if ($PSCmdlet.ShouldProcess($PilotUser, 'Create non-administrator local pilot account')) {
        New-LocalUser -Name $PilotUser -Password $PilotPassword -PasswordNeverExpires -UserMayNotChangePassword | Out-Null
    }
}

if ($PSCmdlet.ShouldProcess($WorkspaceRoot, 'Create restricted workspace')) {
    New-Item -ItemType Directory -Path $WorkspaceRoot -Force | Out-Null
    foreach ($folder in $folders) {
        New-Item -ItemType Directory -Path (Join-Path $WorkspaceRoot $folder) -Force | Out-Null
    }
    $presetSource = Join-Path $backup 'source\user'
    if (-not (Test-Path -LiteralPath $presetSource -PathType Container)) {
        throw 'The backed-up source configuration has no user preset directory.'
    }
    # Keep an inert workbench copy only. Network/device configuration remains in the private backup.
    Copy-Item -LiteralPath $presetSource -Destination (Join-Path $WorkspaceRoot 'profile-workbench\presets') -Recurse -Force
    & icacls $WorkspaceRoot /inheritance:r | Out-Null
    & icacls $WorkspaceRoot /grant:r "${PilotUser}:(OI)(CI)M" 'Administrators:(OI)(CI)F' 'SYSTEM:(OI)(CI)F' | Out-Null
}

Write-Output "Backup: $backup"
Write-Output "Workspace: $WorkspaceRoot"
Write-Output "Manifest: $(Join-Path $backup 'manifest.csv')"
