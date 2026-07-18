# Install-VirtualMonitor.ps1
# Requires Run as Administrator

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Warning "This script requires Administrator privileges to install the Virtual Display Driver."
    Write-Warning "Please right-click and run as Administrator, or run from an elevated PowerShell prompt."
    exit
}

Write-Host "Configuring Virtual Display Driver settings for high-resolution EDID Spoofing..." -ForegroundColor Cyan

$VddDir = "C:\VirtualDisplayDriver"
if (-not (Test-Path $VddDir)) {
    New-Item -ItemType Directory -Path $VddDir | Out-Null
    Write-Host "Created directory: $VddDir" -ForegroundColor Green
}

# The vdd_settings.xml now includes 1080p, 1440p, and 4K at various hertz
$XmlContent = @"
<?xml version="1.0" encoding="utf-8"?>
<VddSettings>
  <Monitors>
    <Monitor>
      <Name>Telecastt Virtual Display</Name>
      <Resolutions>
        <!-- 1080p -->
        <Resolution><Width>1920</Width><Height>1080</Height><RefreshRate>60</RefreshRate></Resolution>
        <Resolution><Width>1920</Width><Height>1080</Height><RefreshRate>120</RefreshRate></Resolution>
        <Resolution><Width>1920</Width><Height>1080</Height><RefreshRate>144</RefreshRate></Resolution>
        <!-- 1440p -->
        <Resolution><Width>2560</Width><Height>1440</Height><RefreshRate>60</RefreshRate></Resolution>
        <Resolution><Width>2560</Width><Height>1440</Height><RefreshRate>120</RefreshRate></Resolution>
        <Resolution><Width>2560</Width><Height>1440</Height><RefreshRate>144</RefreshRate></Resolution>
        <!-- 4K -->
        <Resolution><Width>3840</Width><Height>2160</Height><RefreshRate>60</RefreshRate></Resolution>
        <Resolution><Width>3840</Width><Height>2160</Height><RefreshRate>120</RefreshRate></Resolution>
        <Resolution><Width>3840</Width><Height>2160</Height><RefreshRate>144</RefreshRate></Resolution>
      </Resolutions>
    </Monitor>
  </Monitors>
</VddSettings>
"@

Set-Content -Path "$VddDir\vdd_settings.xml" -Value $XmlContent -Encoding UTF8
Write-Host "Settings file created at $VddDir\vdd_settings.xml" -ForegroundColor Green

Write-Host "Installing VirtualDrivers.Virtual-Display-Driver via Winget..." -ForegroundColor Cyan
winget install --id=VirtualDrivers.Virtual-Display-Driver -e --accept-package-agreements --accept-source-agreements

Write-Host "`nInstallation complete!" -ForegroundColor Green
Write-Host "Action Required: The virtual monitor should now appear in Windows Display Settings." -ForegroundColor Yellow
Write-Host "1. Go to Settings > System > Display." -ForegroundColor Yellow
Write-Host "2. Select 'Extend these displays'." -ForegroundColor Yellow
Write-Host "3. You can now toggle the resolution up to 4K and refresh rate up to 144Hz in Advanced Display Settings." -ForegroundColor Yellow
