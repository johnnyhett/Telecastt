# Telecastt — Security & Input-Sanitization Audit

**Scope:** `backend/server.js`, `backend/lib/*.js`, `scripts/*.ps1`, and the frontend input/signaling hooks.
**Nature of the app:** PC-to-PC remote display + OS-level input injection over WebRTC/WebSocket, with a local PowerShell companion that calls `user32.dll` (`SetCursorPos`, `mouse_event`, `keybd_event`, `InjectTouchInput`). **This is a high-risk application: a successful authorization bypass yields full keyboard/mouse control of the host, which is equivalent to arbitrary command execution.**
**Method:** Read-only source review. Every claim below was verified against the code; positive (well-defended) findings are called out explicitly.

**Threat model recap.** The host PC runs the Node backend (signaling **and** input injection) on port `3001`. The host browser captures its own screen (`getDisplayMedia`) and streams it to a client. The client renders the stream and captures pointer/keyboard, forwarding events over the WebRTC **control** data channel to the host browser, which relays each event to its *local* backend via a `input-inject` WebSocket message. Thus **a remote peer that knows the room code can drive the host's OS** — that is the app's core feature, so the room code is effectively a full-remote-control bearer credential.

---

## Severity summary

| ID | Severity | Finding |
|----|----------|---------|
| F1 | High | Room code is the sole capability for full host control; WS `join` has no brute-force protection |
| F2 | High | No rate limiting / flood control on the WebSocket layer (input flooding, join brute force, unbounded stdin buffer) |
| F3 | High | Device-control HTTP endpoints are unauthenticated and CSRF-reachable (incl. elevated driver install) |
| F4 | High | No transport security by default (`ws://`/`http://`) — room code & host token traverse the LAN in cleartext |
| F5 | Medium | `input-inject` is accepted from any room member, not only the authenticated host; no host-side consent gate on the server |
| F6 | Medium | Runtime download + install of a third-party display driver (supply-chain / unsigned driver) |
| F7 | Medium | Clipboard auto-sync writes attacker-supplied text into the peer's OS clipboard (paste-jacking) |
| F8 | Low | PowerShell launched via shell string concatenation in `idd-controller` / `bluetooth-controller` (fragile, currently non-exploitable) |
| F9 | Low | `/api/network-info` leaks internal IPs / interface names unauthenticated |
| F10 | Low | No HTTP security headers; second (Vite) dev server binds `0.0.0.0` |
| F11 | Info | Injection sanitizer & PowerShell JSON path are well-defended (positive) |
| F12 | Info | Origin allow-list regex is correctly anchored (positive), but is not authentication |
| F13 | Info | Dead/legacy code: `Inject-Input.ps1`, `binary-protocol.js` |

---

## F1 — Room code is a full-control bearer credential with no brute-force protection on the join path
**Severity: High**
**Location:** `backend/lib/room-registry.js:29-35` (`generateRoomCode`), `:179-182` (`canInject`); `backend/server.js:280-317` (WS `join` / `input-inject`).

**Analysis.** Room codes are 6 characters from a 32-symbol ambiguity-free alphabet → `32^6 ≈ 1.07×10^9` (~30 bits), generated with a CSPRNG (`crypto.webcrypto.getRandomValues`) with no modulo bias (32 divides 256). That part is sound. The problem is what the code grants and how it is checked:

- `canInject(peer)` authorizes input injection on the sole basis of *room membership in a live room* — no role, no per-session grant. Knowing the code → join → inject OS input. Keystroke injection includes `Meta`+`r` (Run dialog) → type → `Enter`, i.e. arbitrary command execution.
- Room-code guessing is throttled on the HTTP `GET /api/validate-room/:roomId` path by the per-IP limiter (F2), **but the WebSocket `join` path performs no rate limiting at all** (`server.js:280`). A single socket may send unlimited `join` messages with guessed codes; a failed join leaves the socket open to try again.

**Attack scenario.** An attacker on the same LAN (or any non-browser client, see F3/F12) opens one WebSocket and loops `join` with random codes. With up to `maxRooms = 500` live rooms, the hit probability per guess is ≈ `500 / 1.07e9 ≈ 4.7e-7`; ~1.5M attempts gives ~50% odds of landing in *some* active session, and the WS path imposes no cost per attempt. Any hit yields full mouse/keyboard control of that host.

**Remediation.**
- Add strict per-IP and per-connection rate limiting to the WS `join` handler (e.g. ≤5 failed joins/min/IP, then drop the socket); reuse `RateLimiter` keyed on `req.socket.remoteAddress` at the `wss.on('connection')` level.
- Increase entropy (8–10 chars, ~40–50 bits) and/or bind a session to an out-of-band secret. The QR flow already carries the code; add a random per-room secret to the QR URL that the client must echo on `join`, so a guessed code alone is insufficient.
- Consider explicit host approval: a joining client should appear as "pending" in the host UI until the host accepts it, rather than being auto-authorized to inject.

---

## F2 — No rate limiting or flood control on the WebSocket layer
**Severity: High**
**Location:** `backend/server.js:59-66` (HTTP-only limiter), `:269-321` (WS message handler, no limiter); `backend/lib/input-controller.js:379-390` (stdin write).

**Analysis.** The token-bucket limiter (`RateLimiter(20, 50)`) is installed as **Express middleware only** (`app.use`). WebSocket upgrades bypass the Express chain (`verifyClient` runs, the middleware does not), so *no* WS message is rate-limited. Three consequences:

1. **Join brute force** (see F1) is unthrottled.
2. **Input flooding.** A joined peer can emit `input-inject` messages as fast as it can write. Each accepted message calls `psProcess.stdin.write(cmd + '\n')` (`input-controller.js:386`). PowerShell consumes one line per `ReadLine()`; if the producer outpaces the consumer, Node's writable-stream buffer grows without bound (the code ignores the `write()` backpressure return value) → memory-exhaustion DoS, plus the host's cursor/keyboard is driven uncontrollably.
3. **Connection/socket exhaustion.** There is no cap on concurrent WS connections per IP or globally; `maxPayload` (256 KB) bounds a single frame but not aggregate volume.

Note: the `commandBuffer` cap of 100 (`input-controller.js:380`) only applies *before* the injector reports READY; after READY there is no cap.

**Remediation.**
- Apply a per-connection token bucket to inbound WS messages (separate budgets for signaling vs. `input-inject`); drop or disconnect on breach.
- Respect `stdin.write()` backpressure — pause intake / drop input events when it returns `false`, and cap an outbound queue length.
- Cap concurrent connections per IP and total `wss.clients`.

---

## F3 — Unauthenticated, CSRF-reachable device-control HTTP endpoints (including elevated driver install)
**Severity: High**
**Location:** `backend/server.js:26-32` (CORS), `:164-244` (`/api/vdd/*`, `/api/bluetooth/*`), `:141-147` (`/api/create-room`); `backend/lib/idd-controller.js:6-32,51-53` (elevated PowerShell).

**Analysis.** None of the control endpoints require a room code, host token, or any credential. The only gate is the Origin allow-list, and **the allow-list does not stop request execution**. The CORS config resolves untrusted origins to `callback(null, false)`, which merely omits the `Access-Control-Allow-Origin` header and still calls `next()` — the route handler runs regardless. For "simple" cross-origin requests (POST with no custom headers / non-JSON content type) the browser sends the request and only blocks *reading the response*, so the side effect still happens.

- `POST /api/vdd/install` → `iddController.installDriver()` → `runPowerShell(..., elevate=true)` → `Start-Process -Verb RunAs` → **a UAC prompt appears on the host** and, if approved (or via the non-elevated fallback), downloads and `pnputil /add-driver /install`s a driver.
- `POST /api/vdd/enable|disable` and `/api/vdd/configure {displayMode}` → `displayswitch.exe /extend|/internal|/clone|/external` → can blank/redirect the host's primary display (DoS).
- `POST /api/bluetooth/enable|disable` → toggles the host's Bluetooth network adapters.
- `GET /api/create-room` → room-table exhaustion toward the 500-room cap.

The `install`/`enable`/`disable`/`bluetooth` calls send **no** `Content-Type` (`frontend/src/lib/api.ts:58-60`), so they are simple requests → **no preflight → CSRF-able** from any website the host user visits. (`/api/vdd/configure` sets `Content-Type: application/json`, so it *is* preflight-protected. `GET` endpoints are also simple/CSRF-triggerable but their responses aren't readable cross-site.) Independently of CSRF, any non-browser LAN client can call all of these directly (see F12).

**Remediation.**
- Require the host token (Authorization header/bearer) on every state-changing control endpoint; reject if absent/invalid.
- Enforce the Origin/Host check *server-side* by returning `403` for disallowed origins instead of relying on CORS response headers; add a CSRF token or require a custom header (forcing a preflight) on all POST endpoints.
- Gate elevated operations (`vdd/install`) behind explicit local host-UI confirmation, not a remotely-triggerable HTTP call.

---

## F4 — No transport security by default; room code and host token cross the LAN in cleartext
**Severity: High**
**Location:** `frontend/src/lib/env.ts:5-10`; `backend/server.js:73` (`http.createServer`).

**Analysis.** The backend is a plain `http`/`ws` server; TLS is only used if the *page* happens to be served over HTTPS (`env.ts` picks `wss`/`https` from `window.location.protocol`), which the app does not provision. Consequently, over the LAN in cleartext:
- `GET /api/create-room` returns `{ roomId, hostToken, expiresAt }` — the host token itself.
- The client's `join`, and all offer/answer/ICE signaling, travel in cleartext.

WebRTC **media** is protected (DTLS-SRTP), and the clipboard/input **data channels** between peers are DTLS-encrypted — but the *signaling and the credentials that bootstrap the session are not*. An on-path attacker (open/public Wi-Fi, ARP spoofing, rogue AP) can capture the room code and host token, then join/hijack the room and inject input, or MITM the signaling to insert their own ICE candidates. The prominent "DTLS / SRTP" badge in `HostView.tsx:57` overstates the actual protection of the control plane.

**Remediation.**
- Serve the backend over TLS (`wss://`/`https://`) with a locally-trusted certificate; refuse to expose input injection over plaintext transports.
- Treat the host token as a secret: never return it over an unencrypted channel; scope it to the loopback interface where possible.
- Bind the injection-capable socket to `127.0.0.1` when the host browser and backend are co-located (the common case), so remote peers cannot reach the injection port at all and must go through the host's WebRTC relay.

---

## F5 — `input-inject` accepted from any room member, not just the authenticated host
**Severity: Medium**
**Location:** `backend/server.js:313-317`; `backend/lib/room-registry.js:179-182` (`canInject`).

**Analysis.** In the intended design, **only the host** sends `input-inject` (the host browser relays the client's data-channel events to its own backend — `frontend/src/hooks/useHostInputRelay.ts`, gated on `isHost` in `App.tsx:65`). Clients send input over the WebRTC data channel, never over `input-inject`. But the server accepts `input-inject` from *any* peer for which `canInject` is true, and `canInject` checks only room membership — not `peer.role === 'host'`. Therefore any joined client (up to `maxPeersPerRoom = 8`) can craft `input-inject` frames directly on its own socket and drive the host, bypassing the host browser entirely.

Impact today is bounded because a legitimately-connected client already has injection capability by design; however, this violates least privilege and **defeats any host-side mediation** — e.g. a future "pause remote control" toggle in the host UI would be trivially bypassed by the direct WS path, and extra peers that never negotiated WebRTC can still inject.

**Remediation.** In the `input-inject` branch, require the sender to be the room's authenticated host (`peer.role === 'host'` / `room.hostId === peer.id`). Route all client input through the host's WebRTC relay so the host remains the single, mediating injector, and add a server-honored "control enabled" flag the host can toggle.

---

## F6 — Runtime download and install of a third-party display driver
**Severity: Medium**
**Location:** `scripts/Install-VirtualMonitor.ps1:9,33-47`; invoked (elevated) from `backend/lib/idd-controller.js:51-53`.

**Analysis.** `Install-VirtualMonitor.ps1` downloads `IddSampleDriver.zip` from a hardcoded third-party GitHub release (`ge9/IddSampleDriver/.../0.0.1.2`), extracts it into `C:\Telecastt-VDD`, and runs `pnputil /add-driver /install`. There is no integrity check (no pinned hash/signature verification of the downloaded archive) beyond TLS transport. A compromised upstream release, account takeover, or a tag being re-pointed would result in an attacker-chosen driver being installed on the host — a serious supply-chain exposure given driver-level privilege. This is reachable via the unauthenticated `POST /api/vdd/install` (F3).

**Remediation.** Pin and verify a SHA-256 of the archive before extraction; prefer a signed driver and vendor it into the release rather than fetching at runtime; require explicit local confirmation before any driver install.

---

## F7 — Clipboard auto-sync writes attacker-supplied text into the peer's OS clipboard
**Severity: Medium**
**Location:** `frontend/src/hooks/useClipboardSync.ts:26-38`.

**Analysis.** Incoming `clipboard` data-channel messages are written to the local OS clipboard automatically (`navigator.clipboard.writeText`) with no user confirmation and no content constraints (only a monotonic-timestamp echo guard). A malicious room peer can silently plant arbitrary text into the other party's clipboard — a classic paste-jacking primitive (e.g. planting a shell one-liner that the victim later pastes into a terminal). The channel is DTLS-encrypted so it is not exposed on the wire, but the peer itself is the adversary here. The `document.hidden` check only guards the *copy* direction, not *write*.

**Remediation.** Gate clipboard application behind an explicit per-transfer user action or a visible "peer wants to share clipboard" affordance; cap size; consider making sync opt-in and unidirectional by default.

---

## F8 — PowerShell launched via shell string concatenation (fragile pattern)
**Severity: Low (currently non-exploitable)**
**Location:** `backend/lib/idd-controller.js:6-32`; `backend/lib/bluetooth-controller.js:6-27`.

**Analysis.** Both controllers build a command string and call `child_process.exec` (which spawns a shell), interpolating `scriptPath` and `args.join(' ')`. The elevated branch nests quoting inside `Start-Process -Verb RunAs -ArgumentList '...'`. **No user-controlled string currently reaches these** — `scriptPath` derives from `__dirname`, and the only dynamic args (`configureDisplay` width/height/refresh) are double-clamped to bounded integers (`server.js:194-227` and `idd-controller.js:70-81`). So it is not exploitable today. But the pattern is injection-prone: any future string argument (a filename, a device name) interpolated here would be a command-injection sink, especially in the elevated path. Contrast with the safe `execFile('displayswitch.exe', [flag], ...)` allow-list in `server.js:187-217`.

**Remediation.** Replace `exec(string)` with `execFile('powershell', ['-ExecutionPolicy','Bypass','-File', scriptPath, ...args])` so arguments are passed as an argv array with no shell. Never interpolate values into an elevated command line.

---

## F9 — Unauthenticated internal-network information disclosure
**Severity: Low**
**Location:** `backend/server.js:96-138` (`GET /api/network-info`).

**Analysis.** Returns every non-internal IPv4 address, interface name, adapter type, and Bluetooth-active status, with no authentication. Any LAN client can enumerate the host's network topology / interface naming. (Cross-site pages can trigger it but cannot read the response due to missing CORS headers.)

**Remediation.** Require the host token; or return only the single selected `localIp` needed by the QR flow, omitting the full interface inventory.

---

## F10 — Missing HTTP security headers; dev server LAN exposure
**Severity: Low**
**Location:** `backend/server.js` (no `helmet`/headers); `frontend/package.json:7` (`vite --host`).

**Analysis.** No `helmet`, HSTS, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`, or CSP. The generic error handler (`server.js:247-250`) is appropriately terse (no stack leakage) — good. The Vite dev server is started with `--host` (binds `0.0.0.0`), exposing the dev build and its module graph to the whole LAN during development.

**Remediation.** Add `helmet` with a restrictive CSP and `frame-ancestors 'none'`; avoid `--host` outside trusted networks.

---

## F11 — Injection sanitizer & PowerShell JSON path are well-defended (positive)
**Severity: Informational**
**Location:** `backend/lib/input-controller.js:19-276` (PS script), `:329-362` (`sanitize`).

**Verified strengths.** The end-to-end input path is robust against command/argument injection:
- The injector is spawned once via `spawn('powershell', [...])` **with no shell**; the script body (`PS_SCRIPT`) is a fixed constant. Untrusted data reaches PowerShell only as a single JSON line on stdin, parsed with `ConvertFrom-Json`.
- `sanitize()` rebuilds a fresh object with a fixed field set: `action` is checked against an allow-list (`ALLOWED_ACTIONS`, defaulting unknown values to `move`); `nx`/`ny` are clamped to `[0,1]`; `button` to `[0,2]`; `deltaY` to `[-10000,10000]`; `touchId`/`monitor` to bounded integers; `key` is coerced to a string and truncated to 32 chars. Malformed payloads are dropped.
- No value is ever passed to `Invoke-Expression`, used as a script path, or interpolated into a command. `key` is used only as a hashtable lookup (`$VK_MAP`) or, when exactly one character, passed to `VkKeyScan(char)` — so at most one keystroke is produced per event. JSON escaping (via `JSON.stringify`) means a newline inside `key` cannot break out of the single stdin line.
- Coordinates are recomputed against real screen bounds in PowerShell; out-of-range `monitor` indices safely fall back to the virtual-screen rectangle.

**Residual (by design, not a defect):** the feature legitimately grants arbitrary printable keystrokes plus modifier keys, which *is* equivalent to arbitrary command execution on the host once a peer is authorized. This is why the authorization findings (F1, F4, F5) are the ones that matter most.

---

## F12 — Origin allow-list regex is correctly anchored (positive) — but is not authentication
**Severity: Informational**
**Location:** `backend/server.js:19-24` (`TRUSTED_ORIGIN`), `:79` (`verifyClient`).

**Verified.** The regex is anchored with `^…$` and its alternatives are structured so the classic bypasses fail:
- `https://evil-192.168.1.1.attacker.com` → rejected (the private-range alternative must match immediately after `://`, and the leading `evil-` breaks the anchor).
- `https://192.168.1.1.evil.com` → rejected (`.evil` contains letters that `[\d.]+` cannot consume before `$`).
- `100.64.x` (carrier-grade NAT) and other public IPs → rejected; only `10/127`, `192.168`, `172.16-31`, `localhost`, `[::1]` match.
- Port suffix handled by `(?::\d+)?$`. DNS-rebinding is mitigated for origin-checked endpoints because the browser's `Origin` reflects the attacker's hostname (e.g. `https://evil.com`), which never matches.

**Caveats worth stating.** (1) A missing `Origin` header is treated as trusted (`isTrustedOrigin(null) === true`), so **any non-browser client — curl, a script, a native app — passes both the CORS check and `verifyClient`**. The origin allow-list is a CSRF-style defense against *browser* cross-site abuse only; it is *not* authentication and does not protect against direct LAN attackers. (2) For HTTP endpoints the check is not even enforced server-side (see F3). (3) The entire private-LAN range is trusted, so every device on the network is inside the trust boundary.

---

## F13 — Dead / legacy code
**Severity: Informational**
**Location:** `scripts/Inject-Input.ps1`; `backend/lib/binary-protocol.js`.

- `Inject-Input.ps1` is **not referenced** by any controller (input goes through the inline `PS_SCRIPT` in `input-controller.js`). It has a `key` value in its `[ValidateSet]` with no matching `switch` case, i.e. it is incomplete legacy. Left wired to the F8 `exec`-concatenation pattern with a string `-Key`, it *would* be an argument-injection sink — but nothing invokes it today.
- `binary-protocol.js` is imported only by `test/unit.test.js`; neither the server nor the frontend uses it. Its `decode()` bounds-checks the header/length correctly.

**Remediation.** Delete unused scripts/modules to shrink the attack surface and avoid a future maintainer wiring them up unsafely.

---

## Dependency notes
**Location:** `backend/package.json`, `frontend/package.json`.

- Backend: `express ^5.2.1`, `ws ^8.21.1`, `cors ^2.8.6`, `dotenv ^17.4.2` — all current-generation with no known critical advisories at these ranges. `dotenv` is declared but `server.js` never calls `require('dotenv').config()` (harmless).
- Frontend: `react 19`, `vite 8`, `qrcode.react`, `lucide-react` — nothing alarming.
- The material supply-chain risk is not an npm package but the **runtime driver download** in F6.
- Caret ranges (`^`) mean transitive drift; run `npm audit` in CI and commit lockfile-pinned installs.

---

## Prioritized remediation roadmap

**P0 — before any exposure beyond a single trusted machine**
1. **Bind the injection-capable server to loopback** and/or put it behind TLS (`wss://`); never expose plaintext input injection to the LAN (F4).
2. **Authenticate every control channel with the host token** — WS `join`/`input-inject` and all `/api/vdd/*` + `/api/bluetooth/*` endpoints — and enforce it server-side (F1, F3, F5).
3. **Rate-limit the WebSocket layer** (join attempts and input messages) and honor stdin backpressure (F1, F2).

**P1 — harden the authorization model**
4. Restrict `input-inject` to the authenticated host; add a server-honored host "control enabled" gate and per-client host approval (F5, F1).
5. Enforce Origin server-side (403 on mismatch) and add CSRF protection / required preflight headers to all state-changing POSTs; stop returning the host token over cleartext (F3, F4).
6. Increase room-code entropy and/or add a per-room secret carried in the QR link (F1).

**P2 — reduce blast radius & supply-chain risk**
7. Pin+verify the driver archive hash and require local confirmation for elevated installs; move to `execFile` for all PowerShell invocations (F6, F8).
8. Gate clipboard application behind explicit user consent (F7).

**P3 — hygiene**
9. Add `helmet`/CSP, lock down `/api/network-info`, remove dead code (`Inject-Input.ps1`, `binary-protocol.js`), and drop `vite --host` outside trusted networks; wire `npm audit` into CI (F9, F10, F13).
