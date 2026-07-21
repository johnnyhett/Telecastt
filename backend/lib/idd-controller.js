const { exec } = require('child_process');
const path = require('path');

const SCRIPTS_DIR = path.join(__dirname, '..', '..', 'scripts');

function runPowerShell(scriptName, args = []) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(SCRIPTS_DIR, scriptName);
    const cmd = `powershell -ExecutionPolicy Bypass -File "${scriptPath}" ${args.join(' ')}`;
    
    exec(cmd, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        return resolve({ success: false, error: stderr || error.message });
      }
      try {
        const jsonMatch = stdout.trim().match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return resolve({ success: true, data: parsed });
        }
        return resolve({ success: true, output: stdout.trim() });
      } catch (e) {
        return resolve({ success: true, output: stdout.trim() });
      }
    });
  });
}

async function getStatus() {
  return await runPowerShell('Configure-VirtualDisplay.ps1', ['-Action', 'Status']);
}

async function installDriver() {
  return await runPowerShell('Install-VirtualMonitor.ps1', []);
}

async function uninstallDriver() {
  return await runPowerShell('Install-VirtualMonitor.ps1', ['-Uninstall']);
}

async function enableDisplay() {
  return await runPowerShell('Configure-VirtualDisplay.ps1', ['-Action', 'Enable']);
}

async function disableDisplay() {
  return await runPowerShell('Configure-VirtualDisplay.ps1', ['-Action', 'Disable']);
}

async function configureDisplay(width, height, refreshRate) {
  return await runPowerShell('Configure-VirtualDisplay.ps1', [
    '-Action', 'Configure',
    '-Width', width,
    '-Height', height,
    '-RefreshRate', refreshRate
  ]);
}

module.exports = {
  getStatus,
  installDriver,
  uninstallDriver,
  enableDisplay,
  disableDisplay,
  configureDisplay
};
