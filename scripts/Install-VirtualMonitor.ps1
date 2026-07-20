[CmdletBinding()]
param (
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

# Check for admin
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "Please run this script as Administrator."
    exit 1
}

$InstallDir = "C:\Telecastt-VDD"
$RepoUrl = "https://github.com/ge9/IddSampleDriver/releases/download/0.0.1.2/IddSampleDriver.zip"
$ZipPath = Join-Path $env:TEMP "IddSampleDriver.zip"
$InfPath = Join-Path $InstallDir "IddSampleDriver.inf"

try {
    if ($Uninstall) {
        Write-Host "Uninstalling Virtual Display Driver..."
        if (Test-Path $InfPath) {
            pnputil /delete-driver $InfPath /uninstall /force
        }
        if (Test-Path $InstallDir) {
            Remove-Item -Path $InstallDir -Recurse -Force
        }
        Write-Host "Uninstallation complete."
    } else {
        Write-Host "Downloading IddSampleDriver..."
        Invoke-WebRequest -Uri $RepoUrl -OutFile $ZipPath
        
        Write-Host "Extracting to $InstallDir..."
        if (-not (Test-Path $InstallDir)) {
            New-Item -ItemType Directory -Path $InstallDir | Out-Null
        }
        Expand-Archive -Path $ZipPath -DestinationPath $InstallDir -Force
        
        Write-Host "Installing driver..."
        pnputil /add-driver $InfPath /install
        
        Write-Host "Installation complete."
    }
} catch {
    Write-Error "An error occurred: $_"
} finally {
    if (Test-Path $ZipPath) {
        Remove-Item -Path $ZipPath -Force
    }
}
