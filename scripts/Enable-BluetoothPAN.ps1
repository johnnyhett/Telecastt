[CmdletBinding()]
param (
    [Parameter(Mandatory=$false)]
    [ValidateSet('Status', 'Enable', 'Disable')]
    [string]$Action = 'Status'
)

$ErrorActionPreference = "Stop"

function Get-BluetoothNetworkAdapters {
    $adapters = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { 
        $_.InterfaceDescription -like "*Bluetooth*" -or $_.Name -like "*Bluetooth*"
    }
    
    $results = @()
    foreach ($adapter in $adapters) {
        $ip = (Get-NetIPAddress -InterfaceIndex $adapter.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).IPAddress
        $results += [PSCustomObject]@{
            Name = $adapter.Name
            Description = $adapter.InterfaceDescription
            Status = $adapter.Status
            MacAddress = $adapter.MacAddress
            IPAddress = if ($ip) { $ip } else { "Unassigned" }
            IsConnected = ($adapter.Status -eq "Up")
        }
    }
    return $results
}

switch ($Action) {
    'Status' {
        $adapters = Get-BluetoothNetworkAdapters
        @{
            success = $true
            hasBluetoothAdapter = ($adapters.Count -gt 0)
            adapters = $adapters
        } | ConvertTo-Json -Depth 3 -Compress
    }
    'Enable' {
        $adapters = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { 
            $_.InterfaceDescription -like "*Bluetooth*" -or $_.Name -like "*Bluetooth*"
        }
        foreach ($adapter in $adapters) {
            Enable-NetAdapter -Name $adapter.Name -Confirm:$false -ErrorAction SilentlyContinue
        }
        @{ success = $true; message = "Bluetooth network adapters enabled." } | ConvertTo-Json -Compress
    }
    'Disable' {
        $adapters = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { 
            $_.InterfaceDescription -like "*Bluetooth*" -or $_.Name -like "*Bluetooth*"
        }
        foreach ($adapter in $adapters) {
            Disable-NetAdapter -Name $adapter.Name -Confirm:$false -ErrorAction SilentlyContinue
        }
        @{ success = $true; message = "Bluetooth network adapters disabled." } | ConvertTo-Json -Compress
    }
}
