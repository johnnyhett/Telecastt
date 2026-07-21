[CmdletBinding()]
param (
    [Parameter(Mandatory=$true)]
    [ValidateSet('move', 'click', 'mousedown', 'mouseup', 'rightclick', 'key', 'wheel')]
    [string]$Action,

    [int]$X = 0,
    [int]$Y = 0,
    [int]$NormalizedXPercent = 0, # 0 to 10000 (representing 0.00% to 100.00%)
    [int]$NormalizedYPercent = 0,
    [int]$Button = 0,
    [string]$Key = '',
    [int]$DeltaY = 0
)

$ErrorActionPreference = "SilentlyContinue"

# Define User32 Win32 API Interop
$source = @"
using System;
using System.Runtime.InteropServices;

public class Win32Input {
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP   = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP   = 0x0010;
    public const uint MOUSEEVENTF_WHEEL     = 0x0800;
}
"@

if (-not ([System.Management.Automation.PSTypeName]'Win32Input').Type) {
    Add-Type -TypeDefinition $source
}

# Resolution bounds
$screenWidth = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width
$screenHeight = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height

# Calculate target X and Y from normalized percentages if provided
if ($NormalizedXPercent -gt 0 -or $NormalizedYPercent -gt 0) {
    $targetX = [math]::Round(($NormalizedXPercent / 10000.0) * $screenWidth)
    $targetY = [math]::Round(($NormalizedYPercent / 10000.0) * $screenHeight)
} else {
    $targetX = $X
    $targetY = $Y
}

switch ($Action) {
    'move' {
        [Win32Input]::SetCursorPos($targetX, $targetY) | Out-Null
    }
    'mousedown' {
        [Win32Input]::SetCursorPos($targetX, $targetY) | Out-Null
        if ($Button -eq 2) {
            [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
        } else {
            [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        }
    }
    'mouseup' {
        [Win32Input]::SetCursorPos($targetX, $targetY) | Out-Null
        if ($Button -eq 2) {
            [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)
        } else {
            [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
        }
    }
    'click' {
        [Win32Input]::SetCursorPos($targetX, $targetY) | Out-Null
        [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    }
    'rightclick' {
        [Win32Input]::SetCursorPos($targetX, $targetY) | Out-Null
        [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
        [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)
    }
    'wheel' {
        [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_WHEEL, 0, 0, [uint32](-$DeltaY), 0)
    }
}

@{ success = $true } | ConvertTo-Json -Compress
