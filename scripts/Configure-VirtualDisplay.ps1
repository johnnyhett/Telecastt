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

function Get-VDDStatus {
    $driverExists = Test-Path "C:\Telecastt-VDD\IddSampleDriver.inf"
    $device = Get-PnpDevice -FriendlyName "*Virtual Display*" -ErrorAction SilentlyContinue
    if (-not $device) {
        $device = Get-PnpDevice -FriendlyName "*IddSpot*" -ErrorAction SilentlyContinue
    }
    
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
        $device = Get-PnpDevice -FriendlyName "*Virtual Display*" -ErrorAction SilentlyContinue
        if ($device) {
            Enable-PnpDevice -InstanceId $device.InstanceId -Confirm:$false
            @{ success = $true; message = "Virtual Display Device enabled." } | ConvertTo-Json -Compress
        } else {
            @{ success = $false; message = "Virtual Display Device not found." } | ConvertTo-Json -Compress
        }
    }
    'Disable' {
        $device = Get-PnpDevice -FriendlyName "*Virtual Display*" -ErrorAction SilentlyContinue
        if ($device) {
            Disable-PnpDevice -InstanceId $device.InstanceId -Confirm:$false
            @{ success = $true; message = "Virtual Display Device disabled." } | ConvertTo-Json -Compress
        } else {
            @{ success = $false; message = "Virtual Display Device not found." } | ConvertTo-Json -Compress
        }
    }
    'Configure' {
        $optionFile = "C:\Telecastt-VDD\option.txt"
        if (Test-Path $optionFile) {
            "$Width, $Height, $RefreshRate" | Out-File -FilePath $optionFile -Encoding ascii
            @{ success = $true; message = "Configured option.txt ($Width x $Height @ $RefreshRate Hz)" } | ConvertTo-Json -Compress
        } else {
            @{ success = $false; message = "option.txt not found at $optionFile" } | ConvertTo-Json -Compress
        }
    }
}
