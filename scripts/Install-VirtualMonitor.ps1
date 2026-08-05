<#
.SYNOPSIS
    Stages and installs the IddSampleDriver virtual display driver.

.DESCRIPTION
    Downloads a PINNED release archive, verifies its SHA-256 before touching it,
    then stages and installs the driver package. Reports the truth about what
    actually happened — a staged-but-not-loaded driver is a failure, not a
    success.

.NOTES
    The upstream archive is an UNSIGNED sample driver signed with a self-signed
    test certificate. Windows will not load it unless test-signing mode is
    enabled (or the bundled certificate is trusted, which this script
    deliberately does NOT do on your behalf — trusting a third-party root is a
    decision for the machine's owner, not an installer).
#>
[CmdletBinding()]
param (
    [switch]$Uninstall,

    # Override the pinned archive URL/hash (e.g. to vendor a signed driver).
    # Supplying -Url without a matching -Sha256 is refused: an unverified
    # download of a driver package is not an acceptable default.
    [string]$Url,
    [string]$Sha256
)

$ErrorActionPreference = 'Stop'

$InstallDir = "C:\Telecastt-VDD"

# --- Pinned upstream package -------------------------------------------------
# ge9/IddSampleDriver 0.0.1.2. The hash is verified before extraction so a
# re-pointed tag, a replaced release asset or a compromised upstream account
# cannot swap in an attacker-chosen driver.
$DefaultUrl    = "https://github.com/ge9/IddSampleDriver/releases/download/0.0.1.2/IddSampleDriver.zip"
$DefaultSha256 = "C73D6F3B8AF35D68B369DE68200B1D4AD2A958D7C45D672A20A1FFE01D24F72C"

if ($Url -and -not $Sha256) {
    @{ success = $false; error = "-Url requires a matching -Sha256; refusing to install an unverified driver package." } | ConvertTo-Json -Compress
    exit 1
}
if (-not $Url) { $Url = $DefaultUrl }
if (-not $Sha256) { $Sha256 = $DefaultSha256 }

$ZipPath = Join-Path $env:TEMP ("Telecastt-IddSampleDriver-" + [guid]::NewGuid().ToString('N') + ".zip")

function Find-StagedInf {
    if (-not (Test-Path $InstallDir)) { return $null }
    # The archive extracts into a NESTED folder, so the .inf is not at the root
    # of the install directory. Locating it by name is what makes the install
    # actually run: the previous hardcoded root path never matched, so every
    # install silently skipped pnputil and then reported "not installed".
    $inf = Get-ChildItem -Path $InstallDir -Filter "*.inf" -Recurse -File -ErrorAction SilentlyContinue |
           Where-Object { $_.Name -match 'Idd|Virtual' } |
           Select-Object -First 1
    if (-not $inf) {
        $inf = Get-ChildItem -Path $InstallDir -Filter "*.inf" -Recurse -File -ErrorAction SilentlyContinue |
               Select-Object -First 1
    }
    if ($inf) { return $inf.FullName }
    return $null
}

try {
    if ($Uninstall) {
        $infPath = Find-StagedInf
        if ($infPath) {
            & pnputil /delete-driver $infPath /uninstall /force | Out-Null
        }
        if (Test-Path $InstallDir) {
            Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
        }
        @{ success = $true; message = "Uninstallation complete." } | ConvertTo-Json -Compress
        exit 0
    }

    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }

    $infPath = Find-StagedInf

    if (-not $infPath) {
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $Url -OutFile $ZipPath -UseBasicParsing -TimeoutSec 60
        } catch {
            @{ success = $false; error = "Could not download the virtual display driver ($($_.Exception.Message)). Install a signed virtual display driver manually, or retry with network access." } | ConvertTo-Json -Compress
            exit 1
        }

        # Verify BEFORE extracting — never unpack an archive we haven't authenticated.
        $actual = (Get-FileHash -Path $ZipPath -Algorithm SHA256).Hash.ToUpperInvariant()
        $expected = $Sha256.ToUpperInvariant()
        if ($actual -ne $expected) {
            Remove-Item -Path $ZipPath -Force -ErrorAction SilentlyContinue
            @{ success = $false; error = "Driver archive failed its integrity check (expected SHA-256 $expected, got $actual). The download was NOT extracted. Refusing to install an unverified driver." } | ConvertTo-Json -Compress
            exit 1
        }

        Expand-Archive -Path $ZipPath -DestinationPath $InstallDir -Force
        $infPath = Find-StagedInf
    }

    if (-not $infPath) {
        @{ success = $false; error = "Driver package extracted but no .inf was found under $InstallDir." } | ConvertTo-Json -Compress
        exit 1
    }

    # The driver reads its resolution list from option.txt beside its own files.
    $optionTxt = Join-Path (Split-Path -Parent $infPath) "option.txt"
    if (-not (Test-Path $optionTxt)) {
        "1920, 1080, 60" | Out-File -FilePath $optionTxt -Encoding ascii -Force
    }

    & pnputil /add-driver $infPath /install | Out-Null
    $pnputilExit = $LASTEXITCODE

    # Verify Windows actually enumerated a virtual display device, and report the
    # truth instead of a blanket "success".
    Start-Sleep -Seconds 2
    $device = Get-PnpDevice -Class Display -ErrorAction SilentlyContinue |
              Where-Object { $_.FriendlyName -match 'Indirect|Idd|Virtual' }

    if ($device) {
        try { Start-Process "displayswitch.exe" -ArgumentList "/extend" -NoNewWindow } catch {}
        @{ success = $true; message = "Virtual display active; extended desktop enabled." } | ConvertTo-Json -Compress
    } else {
        @{
            success = $false
            error = "Driver staged from a hash-verified package (pnputil exit $pnputilExit) but Windows created no virtual display. This is an UNSIGNED sample driver: Windows will not load it unless test-signing mode is on ('bcdedit /set testsigning on' as admin, then reboot), or you install a properly signed virtual display driver."
        } | ConvertTo-Json -Compress
    }
} catch {
    @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    exit 1
} finally {
    if (Test-Path $ZipPath) {
        Remove-Item -Path $ZipPath -Force -ErrorAction SilentlyContinue
    }
}
