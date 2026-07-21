const { exec } = require('child_process');
const path = require('path');

const SCRIPTS_DIR = path.join(__dirname, '..', '..', 'scripts');

function injectInput(data) {
  return new Promise((resolve) => {
    const { action, x = 0, y = 0, normalizedX = 0, normalizedY = 0, button = 0, key = '', deltaY = 0 } = data || {};
    
    // Scale normalized 0.0-1.0 float to 0-10000 int for PowerShell argument
    const normXPercent = Math.round(normalizedX * 10000);
    const normYPercent = Math.round(normalizedY * 10000);

    const scriptPath = path.join(SCRIPTS_DIR, 'Inject-Input.ps1');
    const cmd = `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -Action "${action}" -X ${x} -Y ${y} -NormalizedXPercent ${normXPercent} -NormalizedYPercent ${normYPercent} -Button ${button} -DeltaY ${deltaY}`;

    exec(cmd, { windowsHide: true }, (error, stdout) => {
      if (error) {
        return resolve({ success: false, error: error.message });
      }
      return resolve({ success: true });
    });
  });
}

module.exports = { injectInput };
