[CmdletBinding()]
param (
    [Parameter(Mandatory=$false)]
    [ValidateSet('Status', 'Enable', 'Disable', 'Configure')]
    [string]$Action = 'Status',

    [int]$Width = 1920,
    [int]$Height = 1080,
    [int]$RefreshRate = 60
)

$ErrorActionPreference = "Stop"

function Get-VDDDevice {
    $device = Get-PnpDevice -FriendlyName "*Virtual Display*" -ErrorAction SilentlyContinue
    if (-not $device) {
        $device = Get-PnpDevice -FriendlyName "*IddSpot*" -ErrorAction SilentlyContinue
    }
    if (-not $device) {
        $device = Get-PnpDevice -FriendlyName "*IddSampleDriver*" -ErrorAction SilentlyContinue
    }
    if (-not $device) {
        $device = Get-PnpDevice -Class Display -FriendlyName "*Indirect*" -ErrorAction SilentlyContinue
    }
    return $device
}

function Get-VDDStatus {
    $driverExists = (Test-Path "C:\Telecastt-VDD\IddSampleDriver.inf") -or (Test-Path "C:\Telecastt-VDD\option.txt")
    $device = Get-VDDDevice
    
    return [PSCustomObject]@{
        Installed = [bool]$driverExists
        Present = [bool]($device -ne $null)
        Status = if ($device) { $device.Status } else { "NotPresent" }
        InstanceId = if ($device) { $device.InstanceId } else { $null }
    }
}

switch ($Action) {
    'Status' {
        $status = Get-VDDStatus
        $status | ConvertTo-Json -Compress
    }
    'Enable' {
        $device = Get-VDDDevice
        if ($device) {
            Enable-PnpDevice -InstanceId $device.InstanceId -Confirm:$false -ErrorAction SilentlyContinue
        }
        
        # Always trigger display switch to EXTEND mode (true second monitor).
        # NOTE: /extend = extend desktop, /external = second-screen-only,
        # /clone = duplicate, /internal = primary-only.
        try {
            Start-Process "displayswitch.exe" -ArgumentList "/extend" -NoNewWindow
        } catch {}

        @{ success = $true; message = "Extended Display activated." } | ConvertTo-Json -Compress
    }
    'Disable' {
        $device = Get-VDDDevice
        if ($device) {
            Disable-PnpDevice -InstanceId $device.InstanceId -Confirm:$false -ErrorAction SilentlyContinue
        }
        
        try {
            Start-Process "displayswitch.exe" -ArgumentList "/internal" -NoNewWindow
        } catch {}

        @{ success = $true; message = "Virtual Display disabled." } | ConvertTo-Json -Compress
    }
    'Configure' {
        $vddDir = "C:\Telecastt-VDD"
        if (-not (Test-Path $vddDir)) {
            New-Item -ItemType Directory -Path $vddDir -Force | Out-Null
        }
        $optionFile = Join-Path $vddDir "option.txt"
        "$Width, $Height, $RefreshRate" | Out-File -FilePath $optionFile -Encoding ascii
        @{ success = $true; message = "Configured option.txt ($Width x $Height @ $RefreshRate Hz)" } | ConvertTo-Json -Compress
    }
}
