'use strict';

/**
 * bluetooth-controller.js — Bluetooth PAN adapter operations.
 * Shell-free PowerShell invocation via lib/powershell.js.
 */

const path = require('path');
const { runScript } = require('./powershell');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'Enable-BluetoothPAN.ps1');

async function getBluetoothStatus() {
  return runScript(SCRIPT, ['-Action', 'Status']);
}

async function enableBluetooth() {
  return runScript(SCRIPT, ['-Action', 'Enable']);
}

async function disableBluetooth() {
  return runScript(SCRIPT, ['-Action', 'Disable']);
}

module.exports = {
  getBluetoothStatus,
  enableBluetooth,
  disableBluetooth,
};
