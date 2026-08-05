'use strict';

/**
 * idd-controller.js — virtual display driver (IDD) operations.
 *
 * All PowerShell goes through lib/powershell.js: no shell, argv arrays only,
 * and elevated calls report the child's real result instead of a blanket
 * success (see that module for why both mattered).
 */

const path = require('path');
const { runScript, runScriptElevated } = require('./powershell');

const SCRIPTS_DIR = path.join(__dirname, '..', '..', 'scripts');
const script = (name) => path.join(SCRIPTS_DIR, name);

// Coerce to bounded integers so nothing but digits ever reaches the script
// arguments, regardless of the caller.
function toInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function getStatus() {
  return runScript(script('Configure-VirtualDisplay.ps1'), ['-Action', 'Status']);
}

async function installDriver() {
  return runScriptElevated(script('Install-VirtualMonitor.ps1'), []);
}

async function uninstallDriver() {
  return runScriptElevated(script('Install-VirtualMonitor.ps1'), ['-Uninstall']);
}

async function enableDisplay() {
  return runScriptElevated(script('Configure-VirtualDisplay.ps1'), ['-Action', 'Enable']);
}

async function disableDisplay() {
  return runScriptElevated(script('Configure-VirtualDisplay.ps1'), ['-Action', 'Disable']);
}

async function configureDisplay(width, height, refreshRate) {
  return runScript(script('Configure-VirtualDisplay.ps1'), [
    '-Action', 'Configure',
    '-Width', toInt(width, 1920, 640, 7680),
    '-Height', toInt(height, 1080, 480, 4320),
    '-RefreshRate', toInt(refreshRate, 60, 24, 240),
  ]);
}

module.exports = {
  getStatus,
  installDriver,
  uninstallDriver,
  enableDisplay,
  disableDisplay,
  configureDisplay,
};
