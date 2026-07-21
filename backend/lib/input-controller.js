/**
 * input-controller.js — Persistent Input Injection Controller
 * 
 * Instead of spawning a new PowerShell process per mouse move (which is
 * completely non-viable for real-time input), this controller:
 * 
 * 1. Spawns ONE persistent PowerShell process on first use
 * 2. Feeds JSON commands via stdin line-by-line  
 * 3. PowerShell reads from stdin in a loop and injects via User32 interop
 * 4. Properly terminates the child process on cleanup
 */
const { spawn } = require('child_process');
const path = require('path');

let psProcess = null;
let isReady = false;

const PS_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms

$source = @"
using System;
using System.Runtime.InteropServices;

public class TelecasttInput {
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    public const uint MOUSEEVENTF_LEFTDOWN  = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP    = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP   = 0x0010;
    public const uint MOUSEEVENTF_WHEEL     = 0x0800;
    public const uint KEYEVENTF_KEYUP       = 0x0002;
}
"@

Add-Type -TypeDefinition $source -ErrorAction SilentlyContinue

# Signal readiness
Write-Output "READY"

# Read JSON commands from stdin indefinitely
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Trim() -eq '') { continue }

    try {
        $cmd = $line | ConvertFrom-Json

        # Calculate absolute pixel position from normalized 0.0-1.0 coords
        $bounds = [System.Windows.Forms.Screen]::AllScreens
        
        # Default to virtual screen (all monitors combined)
        $totalLeft   = [System.Windows.Forms.SystemInformation]::VirtualScreen.Left
        $totalTop    = [System.Windows.Forms.SystemInformation]::VirtualScreen.Top
        $totalWidth  = [System.Windows.Forms.SystemInformation]::VirtualScreen.Width
        $totalHeight = [System.Windows.Forms.SystemInformation]::VirtualScreen.Height

        # If a target monitor index is specified, use that monitor's bounds
        $targetIdx = if ($cmd.monitor -ne $null) { [int]$cmd.monitor } else { -1 }
        
        if ($targetIdx -ge 0 -and $targetIdx -lt $bounds.Count) {
            $mon = $bounds[$targetIdx]
            $absX = $mon.Bounds.Left + [math]::Round($cmd.nx * $mon.Bounds.Width)
            $absY = $mon.Bounds.Top  + [math]::Round($cmd.ny * $mon.Bounds.Height)
        } else {
            # Fallback: use full virtual desktop
            $absX = $totalLeft + [math]::Round($cmd.nx * $totalWidth)
            $absY = $totalTop  + [math]::Round($cmd.ny * $totalHeight)
        }

        switch ($cmd.action) {
            'move' {
                [TelecasttInput]::SetCursorPos($absX, $absY) | Out-Null
            }
            'mousedown' {
                [TelecasttInput]::SetCursorPos($absX, $absY) | Out-Null
                if ($cmd.button -eq 2) {
                    [TelecasttInput]::mouse_event([TelecasttInput]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
                } else {
                    [TelecasttInput]::mouse_event([TelecasttInput]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
                }
            }
            'mouseup' {
                [TelecasttInput]::SetCursorPos($absX, $absY) | Out-Null
                if ($cmd.button -eq 2) {
                    [TelecasttInput]::mouse_event([TelecasttInput]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)
                } else {
                    [TelecasttInput]::mouse_event([TelecasttInput]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
                }
            }
            'click' {
                [TelecasttInput]::SetCursorPos($absX, $absY) | Out-Null
                [TelecasttInput]::mouse_event([TelecasttInput]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
                Start-Sleep -Milliseconds 10
                [TelecasttInput]::mouse_event([TelecasttInput]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
            }
            'rightclick' {
                [TelecasttInput]::SetCursorPos($absX, $absY) | Out-Null
                [TelecasttInput]::mouse_event([TelecasttInput]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
                Start-Sleep -Milliseconds 10
                [TelecasttInput]::mouse_event([TelecasttInput]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)
            }
            'wheel' {
                $delta = -[int]$cmd.deltaY
                [TelecasttInput]::mouse_event([TelecasttInput]::MOUSEEVENTF_WHEEL, 0, 0, [uint32]$delta, 0)
            }
        }
    } catch {
        # Silently skip malformed input
    }
}
`;

function ensureProcess() {
  if (psProcess && !psProcess.killed) return;

  psProcess = spawn('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-Command', PS_SCRIPT
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });

  psProcess.stdout.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg.includes('READY')) {
      isReady = true;
      console.log('[InputController] Persistent injector process ready.');
    }
  });

  psProcess.stderr.on('data', (data) => {
    // Only log real errors, not warnings
    const msg = data.toString().trim();
    if (msg && !msg.includes('WARNING')) {
      console.error('[InputController] PS Error:', msg);
    }
  });

  psProcess.on('exit', (code) => {
    console.log(`[InputController] Process exited with code ${code}`);
    psProcess = null;
    isReady = false;
  });
}

/**
 * Inject input into the host OS.
 * @param {Object} data - { action, nx, ny, button, deltaY, monitor }
 *   - action: 'move' | 'mousedown' | 'mouseup' | 'click' | 'rightclick' | 'wheel'
 *   - nx: normalized X (0.0 to 1.0)
 *   - ny: normalized Y (0.0 to 1.0)
 *   - button: 0 = left, 2 = right
 *   - deltaY: scroll delta (for wheel)
 *   - monitor: target monitor index (0 = primary, 1 = extended, etc.)
 */
function injectInput(data) {
  ensureProcess();

  if (!psProcess || psProcess.killed) {
    return { success: false, error: 'Injector process not available' };
  }

  try {
    const cmd = JSON.stringify({
      action: data.action || 'move',
      nx: data.normalizedX || data.nx || 0,
      ny: data.normalizedY || data.ny || 0,
      button: data.button || 0,
      deltaY: data.deltaY || 0,
      monitor: data.monitor !== undefined ? data.monitor : -1
    });

    psProcess.stdin.write(cmd + '\n');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Kill the persistent injector process (call on server shutdown).
 */
function killInjector() {
  if (psProcess && !psProcess.killed) {
    psProcess.stdin.end();
    psProcess.kill();
    psProcess = null;
    isReady = false;
    console.log('[InputController] Injector process terminated.');
  }
}

module.exports = { injectInput, killInjector, ensureProcess };
