/**
 * input-controller.js — Persistent Input Injection Controller
 * 
 * Spawns ONE persistent PowerShell process that reads JSON commands via stdin.
 * Supports: 
 *   - Native Windows Touch Injection (InjectTouchInput via user32.dll)
 *   - Mouse move, click, drag, right-click, middle-click, scroll
 *   - Full Keyboard injection (keydown/keyup with VK lookup)
 * 
 * Touch injection operates on native POINTER_TOUCH_INFO contacts so touching
 * the extended display does NOT move or hijack the host's main mouse cursor!
 */
const { spawn } = require('child_process');

let psProcess = null;
let isReady = false;
let commandBuffer = [];

const PS_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms

$source = @"
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct POINT {
    public int x;
    public int y;
}

[StructLayout(LayoutKind.Sequential)]
public struct RECT {
    public int left;
    public int top;
    public int right;
    public int bottom;
}

[StructLayout(LayoutKind.Sequential)]
public struct POINTER_INFO {
    public uint pointerType;
    public uint pointerId;
    public uint frameId;
    public uint pointerFlags;
    public IntPtr sourceDevice;
    public IntPtr hwndTarget;
    public POINT ptPixelLocation;
    public POINT ptHimetricLocation;
    public POINT ptPixelLocationRaw;
    public POINT ptHimetricLocationRaw;
    public uint dwTime;
    public uint historyCount;
    public int InputData;
    public uint dwKeyStates;
    public ulong PerformanceTimeStamp;
    public uint ButtonChangeType;
}

[StructLayout(LayoutKind.Sequential)]
public struct POINTER_TOUCH_INFO {
    public POINTER_INFO pointerInfo;
    public uint touchFlags;
    public uint touchMask;
    public RECT rcContact;
    public uint orientation;
    public uint pressure;
}

public class TelecasttInput {
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern short VkKeyScan(char ch);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool InitializeTouchInjection(uint maxCount, uint dwMode);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool InjectTouchInput(uint count, POINTER_TOUCH_INFO[] contacts);

    public const uint MOUSEEVENTF_LEFTDOWN   = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP     = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN  = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP    = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP   = 0x0040;
    public const uint MOUSEEVENTF_WHEEL      = 0x0800;
    public const uint KEYEVENTF_KEYDOWN      = 0x0000;
    public const uint KEYEVENTF_KEYUP        = 0x0002;

    public static bool InjectTouch(int x, int y, uint touchId, string phase) {
        try {
            POINTER_TOUCH_INFO touchInfo = new POINTER_TOUCH_INFO();
            touchInfo.pointerInfo.pointerType = 2; // PT_TOUCH
            touchInfo.pointerInfo.pointerId = touchId;
            touchInfo.pointerInfo.ptPixelLocation.x = x;
            touchInfo.pointerInfo.ptPixelLocation.y = y;

            if (phase == "down") {
                // POINTER_FLAG_NEW (0x1) | POINTER_FLAG_INRANGE (0x2) | POINTER_FLAG_INCONTACT (0x4) | POINTER_FLAG_DOWN (0x10)
                touchInfo.pointerInfo.pointerFlags = 0x0001 | 0x0002 | 0x0004 | 0x0010;
            } else if (phase == "move") {
                // POINTER_FLAG_NEW (0x1) | POINTER_FLAG_INRANGE (0x2) | POINTER_FLAG_INCONTACT (0x4) | POINTER_FLAG_UPDATE (0x8)
                touchInfo.pointerInfo.pointerFlags = 0x0001 | 0x0002 | 0x0004 | 0x0008;
            } else {
                // POINTER_FLAG_NEW (0x1) | POINTER_FLAG_UP (0x20)
                touchInfo.pointerInfo.pointerFlags = 0x0001 | 0x0020;
            }

            touchInfo.touchFlags = 0x00000001; // TOUCH_FLAG_NONE
            touchInfo.touchMask = 0x00000001;  // TOUCH_MASK_CONTACTAREA
            touchInfo.rcContact.left = x - 4;
            touchInfo.rcContact.top = y - 4;
            touchInfo.rcContact.right = x + 4;
            touchInfo.rcContact.bottom = y + 4;

            POINTER_TOUCH_INFO[] contacts = new POINTER_TOUCH_INFO[] { touchInfo };
            return InjectTouchInput(1, contacts);
        } catch {
            return false;
        }
    }
}
"@

Add-Type -TypeDefinition $source -ErrorAction SilentlyContinue

# Try initializing touch injection (10 contact points, TOUCH_FEEDBACK_DEFAULT)
try {
    [TelecasttInput]::InitializeTouchInjection(10, 1) | Out-Null
} catch {}

# Virtual key code lookup table
$VK_MAP = @{
    'Enter'      = 0x0D; 'Tab'        = 0x09; 'Escape'     = 0x1B
    'Backspace'  = 0x08; 'Delete'     = 0x2E; 'Insert'     = 0x2D
    'Home'       = 0x24; 'End'        = 0x23; 'PageUp'     = 0x21
    'PageDown'   = 0x22; 'ArrowUp'    = 0x26; 'ArrowDown'  = 0x28
    'ArrowLeft'  = 0x25; 'ArrowRight' = 0x27; 'Space'      = 0x20
    'Control'    = 0xA2; 'ControlLeft'= 0xA2; 'ControlRight'= 0xA3
    'Shift'      = 0xA0; 'ShiftLeft'  = 0xA0; 'ShiftRight' = 0xA1
    'Alt'        = 0xA4; 'AltLeft'    = 0xA4; 'AltRight'   = 0xA5
    'Meta'       = 0x5B; 'MetaLeft'   = 0x5B; 'MetaRight'  = 0x5C
    'CapsLock'   = 0x14; 'NumLock'    = 0x90; 'ScrollLock' = 0x91
    'F1' = 0x70; 'F2' = 0x71; 'F3' = 0x72; 'F4' = 0x73
    'F5' = 0x74; 'F6' = 0x75; 'F7' = 0x76; 'F8' = 0x77
    'F9' = 0x78; 'F10'= 0x79; 'F11'= 0x7A; 'F12'= 0x7B
    'PrintScreen'= 0x2C; 'Pause'     = 0x13; 'ContextMenu'= 0x5D
}

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
        
        $totalLeft   = [System.Windows.Forms.SystemInformation]::VirtualScreen.Left
        $totalTop    = [System.Windows.Forms.SystemInformation]::VirtualScreen.Top
        $totalWidth  = [System.Windows.Forms.SystemInformation]::VirtualScreen.Width
        $totalHeight = [System.Windows.Forms.SystemInformation]::VirtualScreen.Height

        $targetIdx = if ($cmd.monitor -ne $null) { [int]$cmd.monitor } else { -1 }
        
        if ($targetIdx -ge 0 -and $targetIdx -lt $bounds.Count) {
            $mon = $bounds[$targetIdx]
            $absX = $mon.Bounds.Left + [math]::Round($cmd.nx * $mon.Bounds.Width)
            $absY = $mon.Bounds.Top  + [math]::Round($cmd.ny * $mon.Bounds.Height)
        } else {
            $absX = $totalLeft + [math]::Round($cmd.nx * $totalWidth)
            $absY = $totalTop  + [math]::Round($cmd.ny * $totalHeight)
        }

        switch ($cmd.action) {
            'touch' {
                $tId = if ($cmd.touchId -ne $null) { [uint32]$cmd.touchId } else { 1 }
                $phase = if ($cmd.phase) { $cmd.phase } else { 'down' }
                
                # Attempt native touch injection first
                $injected = [TelecasttInput]::InjectTouch($absX, $absY, $tId, $phase)
                
                # Fallback to mouse click/move if native touch injection fails
                if (-not $injected) {
                    [TelecasttInput]::SetCursorPos($absX, $absY) | Out-Null
                    if ($phase -eq 'down') {
                        [TelecasttInput]::mouse_event([TelecasttInput]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
                    } elseif ($phase -eq 'up') {
                        [TelecasttInput]::mouse_event([TelecasttInput]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
                    }
                }
            }
            'move' {
                [TelecasttInput]::SetCursorPos($absX, $absY) | Out-Null
            }
            'mousedown' {
                [TelecasttInput]::SetCursorPos($absX, $absY) | Out-Null
                if ($cmd.button -eq 2) {
                    [TelecasttInput]::mouse_event([TelecasttInput]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
                } elseif ($cmd.button -eq 1) {
                    [TelecasttInput]::mouse_event([TelecasttInput]::MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, 0)
                } else {
                    [TelecasttInput]::mouse_event([TelecasttInput]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
                }
            }
            'mouseup' {
                [TelecasttInput]::SetCursorPos($absX, $absY) | Out-Null
                if ($cmd.button -eq 2) {
                    [TelecasttInput]::mouse_event([TelecasttInput]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)
                } elseif ($cmd.button -eq 1) {
                    [TelecasttInput]::mouse_event([TelecasttInput]::MOUSEEVENTF_MIDDLEUP, 0, 0, 0, 0)
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
            'keydown' {
                $vk = 0
                $keyName = $cmd.key
                if ($VK_MAP.ContainsKey($keyName)) {
                    $vk = $VK_MAP[$keyName]
                } elseif ($keyName.Length -eq 1) {
                    $vk = [TelecasttInput]::VkKeyScan($keyName) -band 0xFF
                }
                if ($vk -gt 0) {
                    [TelecasttInput]::keybd_event([byte]$vk, 0, [TelecasttInput]::KEYEVENTF_KEYDOWN, 0)
                }
            }
            'keyup' {
                $vk = 0
                $keyName = $cmd.key
                if ($VK_MAP.ContainsKey($keyName)) {
                    $vk = $VK_MAP[$keyName]
                } elseif ($keyName.Length -eq 1) {
                    $vk = [TelecasttInput]::VkKeyScan($keyName) -band 0xFF
                }
                if ($vk -gt 0) {
                    [TelecasttInput]::keybd_event([byte]$vk, 0, [TelecasttInput]::KEYEVENTF_KEYUP, 0)
                }
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
      console.log('[InputController] Persistent injector process ready with Native Touch support.');
      while (commandBuffer.length > 0) {
        const buffered = commandBuffer.shift();
        try {
          psProcess.stdin.write(buffered + '\n');
        } catch { /* ignore */ }
      }
    }
  });

  psProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg && !msg.includes('WARNING')) {
      console.error('[InputController] PS Error:', msg);
    }
  });

  // Without this handler a failed spawn (e.g. PowerShell missing on a
  // non-Windows host, or ENOENT) emits an unhandled 'error' event that would
  // crash the entire server process. Handle it and degrade gracefully.
  psProcess.on('error', (err) => {
    console.error('[InputController] Failed to spawn injector process:', err.message);
    psProcess = null;
    isReady = false;
    commandBuffer = [];
  });

  psProcess.on('exit', (code) => {
    console.log(`[InputController] Process exited with code ${code}`);
    psProcess = null;
    isReady = false;
  });
}

const ALLOWED_ACTIONS = new Set([
  'move', 'mousedown', 'mouseup', 'click', 'rightclick', 'touch', 'wheel', 'keydown', 'keyup'
]);

// Coerce and bound an untrusted remote payload before it is handed to the
// native injector. Anything malformed is rejected rather than forwarded.
function sanitize(data) {
  if (!data || typeof data !== 'object') return null;
  const action = ALLOWED_ACTIONS.has(data.action) ? data.action : 'move';

  const clamp01 = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
  };
  const int = (v, fallback, min, max) => {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };

  const key = typeof data.key === 'string' ? data.key.slice(0, 32) : '';

  return {
    action,
    nx: clamp01(data.normalizedX !== undefined ? data.normalizedX : data.nx),
    ny: clamp01(data.normalizedY !== undefined ? data.normalizedY : data.ny),
    button: int(data.button, 0, 0, 2),
    deltaY: int(data.deltaY, 0, -10000, 10000),
    key,
    phase: data.phase === 'up' ? 'up' : data.phase === 'move' ? 'move' : 'down',
    touchId: int(data.touchId, 1, 0, 4294967295),
    monitor: int(data.monitor, -1, -1, 64)
  };
}

function injectInput(data) {
  const clean = sanitize(data);
  if (!clean) {
    return { success: false, error: 'Invalid input payload' };
  }

  ensureProcess();

  if (!psProcess || psProcess.killed) {
    return { success: false, error: 'Injector process not available' };
  }

  try {
    const cmd = JSON.stringify(clean);

    if (!isReady) {
      if (commandBuffer.length < 100) {
        commandBuffer.push(cmd);
      }
      return { success: true, buffered: true };
    }

    psProcess.stdin.write(cmd + '\n');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function killInjector() {
  if (psProcess && !psProcess.killed) {
    try {
      psProcess.stdin.end();
      psProcess.kill();
    } catch { /* ignore */ }
    psProcess = null;
    isReady = false;
    commandBuffer = [];
    console.log('[InputController] Injector process terminated.');
  }
}

module.exports = { injectInput, killInjector, ensureProcess };
