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
        
        # Install the driver only if the .inf actually downloaded/extracted.
        $installedInf = Test-Path $InfPath
        if ($installedInf) {
            pnputil /add-driver $InfPath /install | Out-Null
        }

        # Verify Windows actually enumerated a virtual display device, and report
        # the truth instead of a blanket "success".
        Start-Sleep -Seconds 2
        $device = Get-PnpDevice -Class Display -ErrorAction SilentlyContinue |
                  Where-Object { $_.FriendlyName -match 'Indirect|Idd|Virtual' }

        if ($device) {
            try { Start-Process "displayswitch.exe" -ArgumentList "/extend" -NoNewWindow } catch {}
            @{ success = $true; message = "Virtual display active; extended desktop enabled." } | ConvertTo-Json -Compress
        } elseif ($installedInf) {
            @{ success = $false; error = "Driver files staged but Windows created no virtual display. This unsigned sample driver needs test-signing mode ('bcdedit /set testsigning on' as admin, then reboot) or a properly signed virtual display driver." } | ConvertTo-Json -Compress
        } else {
            @{ success = $false; error = "Could not download the virtual display driver (no network, or the release moved). Install a signed virtual display driver manually, or enable test-signing and retry." } | ConvertTo-Json -Compress
        }
    }
} catch {
    @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
} finally {
    if (Test-Path $ZipPath) {
        Remove-Item -Path $ZipPath -Force -ErrorAction SilentlyContinue
    }
}
