const { exec } = require('child_process');
const path = require('path');

const SCRIPTS_DIR = path.join(__dirname, '..', '..', 'scripts');

function runPowerShell(scriptName, args = []) {
  return new Promise((resolve) => {
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

async function getBluetoothStatus() {
  return await runPowerShell('Enable-BluetoothPAN.ps1', ['-Action', 'Status']);
}

async function enableBluetooth() {
  return await runPowerShell('Enable-BluetoothPAN.ps1', ['-Action', 'Enable']);
}

async function disableBluetooth() {
  return await runPowerShell('Enable-BluetoothPAN.ps1', ['-Action', 'Disable']);
}

module.exports = {
  getBluetoothStatus,
  enableBluetooth,
  disableBluetooth
};
