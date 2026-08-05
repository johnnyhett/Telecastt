'use strict';

/**
 * powershell.js — one shell-free way to run the companion's PowerShell scripts.
 *
 * Two properties matter here and both used to be missing:
 *
 *  1. **No shell.** Every invocation goes through `execFile` with an argv array,
 *     so nothing is ever parsed by cmd.exe. The previous `exec('powershell … "'
 *     + scriptPath + '" ' + args.join(' '))` pattern was a command-injection
 *     sink waiting for its first string argument, and broke outright on an
 *     install path containing a space.
 *
 *  2. **Honest results.** An elevated child launched with `Start-Process -Verb
 *     RunAs` runs in its own process; its stdout is NOT piped back to the
 *     parent, and ShellExecute cannot redirect handles for the caller. The old
 *     code therefore captured nothing and reported `{ success: true }` no matter
 *     what actually happened — including a declined UAC prompt. Here the child
 *     redirects its OWN output into a temp file that the parent reads back, so
 *     the script's real `{ success: false, error: … }` reaches the UI.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PS_EXE = process.env.TELECASTT_POWERSHELL || 'powershell';
const PS_BASE_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
const DEFAULT_TIMEOUT_MS = Number(process.env.TELECASTT_PS_TIMEOUT_MS) || 120000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

/**
 * Quote a value as a PowerShell single-quoted literal. Inside single quotes
 * PowerShell performs no expansion at all and `''` is a literal quote, so this
 * is a complete escape — the only safe way to embed a value in a command
 * string we build ourselves.
 */
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Run `powershell -File <script> <args…>` with no shell involved. */
function execPowerShell(args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    execFile(
      PS_EXE,
      [...PS_BASE_ARGS, ...args],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES },
      (error, stdout, stderr) => {
        resolve({ error, stdout: String(stdout || ''), stderr: String(stderr || '') });
      }
    );
  });
}

/**
 * Interpret a script's output. A script that printed no JSON is a FAILURE, not
 * a success with empty output: treating "no result" as success is what let a
 * cancelled UAC prompt or a script that only warned to stderr surface in the UI
 * as "Virtual display driver initialized."
 */
function parseResult({ error, stdout, stderr }) {
  const text = String(stdout || '').trim();
  const errText = String(stderr || '').trim();
  let json = null;

  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try { json = JSON.parse(match[0]); } catch { json = null; }
      }
    }
  }

  if (json && typeof json === 'object') {
    // Scripts that report their own outcome are authoritative.
    if (typeof json.success === 'boolean') {
      return json.success
        ? { success: true, data: json, message: json.message }
        : { success: false, error: json.error || json.message || 'Script reported failure.', data: json };
    }
    // Pure data payloads (e.g. VDD status) succeed only if the process did.
    if (error) return { success: false, error: errText || error.message, data: json };
    return { success: true, data: json };
  }

  if (error) {
    const reason = error.killed
      ? 'PowerShell script timed out.'
      : errText || error.message || 'PowerShell script failed.';
    return { success: false, error: reason };
  }
  return { success: false, error: errText || 'Script produced no result.', output: text };
}

/** Run a script directly, without elevation. */
async function runScript(scriptPath, args = [], timeoutMs) {
  return parseResult(await execPowerShell(['-File', scriptPath, ...args.map(String)], timeoutMs));
}

/**
 * Run a script elevated (UAC) and recover its real output.
 *
 * `Start-Process -Verb RunAs` goes through ShellExecute, which cannot redirect
 * the child's handles for us — so the child is handed an `-EncodedCommand` that
 * redirects its own streams into a temp file we read afterwards. Encoding also
 * means not one quote or space of ours survives onto a command line.
 */
async function runScriptElevated(scriptPath, args = [], timeoutMs) {
  const outFile = path.join(os.tmpdir(), `telecastt-ps-${crypto.randomBytes(12).toString('hex')}.out`);

  const inner =
    `& ${psQuote(scriptPath)} ${args.map((a) => psQuote(a)).join(' ')} ` +
    `2>&1 | Out-File -FilePath ${psQuote(outFile)} -Encoding utf8`;
  const encoded = Buffer.from(inner, 'utf16le').toString('base64');

  const outer =
    `$ErrorActionPreference = 'Stop'; ` +
    `$p = Start-Process -FilePath ${psQuote(PS_EXE)} -Verb RunAs -Wait -PassThru ` +
    `-WindowStyle Hidden -ArgumentList @(${[...PS_BASE_ARGS, '-EncodedCommand', encoded].map(psQuote).join(',')}); ` +
    `exit [int]$p.ExitCode`;

  const run = await execPowerShell(['-Command', outer], timeoutMs);

  let captured = '';
  try {
    captured = await fsp.readFile(outFile, 'utf8');
  } catch {
    /* the child never ran (UAC declined) or wrote nothing */
  } finally {
    fs.rm(outFile, { force: true }, () => { /* best-effort cleanup */ });
  }

  if (captured.trim()) {
    return parseResult({ error: null, stdout: captured, stderr: run.stderr });
  }
  if (run.error) {
    return {
      success: false,
      error:
        'Elevation was declined or failed, so the operation did not run. ' +
        'Approve the Windows UAC prompt and try again.',
    };
  }
  return parseResult(run);
}

module.exports = { runScript, runScriptElevated, parseResult, psQuote, PS_EXE };
