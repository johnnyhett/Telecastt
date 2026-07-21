const { exec } = require('child_process');
const path = require('path');

const SCRIPTS_DIR = path.join(__dirname, '..', '..', 'scripts');

function runPowerShell(scriptName, args = [], elevate = false) {
  return new Promise((resolve) => {
    const scriptPath = path.join(SCRIPTS_DIR, scriptName);
    let cmd;

    if (elevate) {
      // Launch via PowerShell with Administrator elevation (triggers Windows UAC prompt if needed)
      cmd = `powershell -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-ExecutionPolicy Bypass -File \\"${scriptPath}\\" ${args.join(' ')}'"`;
    } else {
      cmd = `powershell -ExecutionPolicy Bypass -File "${scriptPath}" ${args.join(' ')}`;
    }

    exec(cmd, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        // Fallback execution without elevation if user cancels UAC
        const fallbackCmd = `powershell -ExecutionPolicy Bypass -File "${scriptPath}" ${args.join(' ')}`;
        return exec(fallbackCmd, { windowsHide: true }, (fbErr, fbOut) => {
          if (fbErr) {
            return resolve({ success: false, error: stderr || error.message });
          }
          parseOutput(fbOut, resolve);
        });
      }
      parseOutput(stdout, resolve);
    });
  });
}

function parseOutput(stdout, resolve) {
  try {
    const jsonMatch = stdout.trim().match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return resolve({ success: true, data: parsed });
    }
    return resolve({ success: true, output: stdout.trim() });
  } catch {
    return resolve({ success: true, output: stdout.trim() });
  }
}

async function getStatus() {
  return await runPowerShell('Configure-VirtualDisplay.ps1', ['-Action', 'Status'], false);
}

async function installDriver() {
  return await runPowerShell('Install-VirtualMonitor.ps1', [], true);
}

async function uninstallDriver() {
  return await runPowerShell('Install-VirtualMonitor.ps1', ['-Uninstall'], true);
}

async function enableDisplay() {
  return await runPowerShell('Configure-VirtualDisplay.ps1', ['-Action', 'Enable'], true);
}

async function disableDisplay() {
  return await runPowerShell('Configure-VirtualDisplay.ps1', ['-Action', 'Disable'], true);
}

async function configureDisplay(width, height, refreshRate) {
  // Coerce to bounded integers so nothing but digits ever reaches the shell
  // command line (guards against injection regardless of the caller).
  const toInt = (v, fallback, min, max) => {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };

  return await runPowerShell('Configure-VirtualDisplay.ps1', [
    '-Action', 'Configure',
    '-Width', toInt(width, 1920, 640, 7680),
    '-Height', toInt(height, 1080, 480, 4320),
    '-RefreshRate', toInt(refreshRate, 60, 24, 240)
  ], false);
}

module.exports = {
  getStatus,
  installDriver,
  uninstallDriver,
  enableDisplay,
  disableDisplay,
  configureDisplay
};
