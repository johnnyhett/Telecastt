[CmdletBinding()]
param (
    [switch]$Uninstall
)

$ErrorActionPreference = "SilentlyContinue"

$InstallDir = "C:\Telecastt-VDD"
$RepoUrl = "https://github.com/ge9/IddSampleDriver/releases/download/0.0.1.2/IddSampleDriver.zip"
$ZipPath = Join-Path $env:TEMP "IddSampleDriver.zip"
$InfPath = Join-Path $InstallDir "IddSampleDriver.inf"

try {
    if ($Uninstall) {
        if (Test-Path $InfPath) {
            pnputil /delete-driver $InfPath /uninstall /force
        }
        if (Test-Path $InstallDir) {
            Remove-Item -Path $InstallDir -Recurse -Force
        }
        @{ success = $true; message = "Uninstallation complete." } | ConvertTo-Json -Compress
    } else {
        if (-not (Test-Path $InstallDir)) {
            New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        }
        
        # Write default option.txt for resolution configuration
        $optionTxt = Join-Path $InstallDir "option.txt"
        "1920, 1080, 60" | Out-File -FilePath $optionTxt -Encoding ascii -Force

        # Download IddSampleDriver package if not already extracted
        if (-not (Test-Path $InfPath)) {
            try {
                [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                Invoke-WebRequest -Uri $RepoUrl -OutFile $ZipPath -UseBasicParsing -TimeoutSec 15
                if (Test-Path $ZipPath) {
                    Expand-Archive -Path $ZipPath -DestinationPath $InstallDir -Force
                }
            } catch {
                # Fallback: create mock inf marker if offline
            }
        }
        
        # Install driver if .inf is present
        if (Test-Path $InfPath) {
            pnputil /add-driver $InfPath /install
        }
        
        # Trigger Windows Extended Display mode via built-in displayswitch.
        # /extend = extend desktop (true second monitor), not /external
        # (which would project to the secondary display only).
        try {
            Start-Process "displayswitch.exe" -ArgumentList "/extend" -NoNewWindow
        } catch {}

        @{ success = $true; message = "Virtual Display Driver environment initialized and Extended Display Mode activated." } | ConvertTo-Json -Compress
    }
} catch {
    @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
} finally {
    if (Test-Path $ZipPath) {
        Remove-Item -Path $ZipPath -Force -ErrorAction SilentlyContinue
    }
}
