# Telecastt — Functional Bug Audit

Ruthless, behavior-focused audit of the PC-to-PC screen-share + remote-control
app. Scope: runtime data flows that break or degrade the app for a real user.
Read-only pass; no source files were modified. Line numbers reflect the tree at
audit time (several files were being edited concurrently).

Severity key: **P0** blocks core use · **P1** major degradation · **P2** minor/edge.

Reported symptoms this audit maps to root causes: (1) clicks don't register,
(2) poor video quality, (3) extend does nothing, (4) VDD does nothing, (5) bad UX.
The most important new finding is a coordinate-mapping bug (#2.1) that explains
"mouse moves but I can't click" precisely.

---

## 1. Connection / Signaling

### 1.1 No TURN server — connection is STUN-only (P1, over cellular P0)
`frontend/src/lib/env.ts:12-20` lists only Google STUN servers, no TURN.
- Trigger: MacBook on a phone hotspot ↔ Windows host. Cellular carrier-grade NAT
  and many hotspot NATs are symmetric; STUN cannot punch through symmetric-to-symmetric.
- Wrong behavior: ICE finds no working candidate pair → `pc.connectionState` goes
  `failed`, no media, no data channels ever open. When it *does* connect it may be
  forced onto a poor host-reflexive path, contributing to the "poor quality" report.
- Fix: add a TURN server (udp+tcp+tls/443) to `ICE_SERVERS`. Without a relay
  fallback, a large fraction of real-world NAT combinations will never connect.

### 1.2 `wss://` derived from page TLS but signaling server is plain HTTP (P1 latent)
`env.ts:5,9-10` sets `SIGNALING_URL = wss://host:3001` whenever the page is served
over HTTPS, but `backend/server.js:73` is `http.createServer` (plain `ws`, no TLS).
- Trigger: serve the frontend over HTTPS — which you are effectively forced to do
  to get Safari client features (clipboard, wake lock) and to run `getDisplayMedia`
  on a host that isn't `localhost`.
- Wrong behavior: the client opens `wss://host:3001` against a `ws`-only server →
  WebSocket handshake fails → no signaling → nothing connects. The app is silently
  pinned to "host on localhost + plain-HTTP LAN clients."
- Fix: terminate TLS in front of the Node server (or run it with a cert) and make
  the ws/wss choice match the actual signaling transport, not the page origin.

### 1.3 Client cannot recover when the host disconnects and reconnects (P1)
`useWebRTC.ts` only recreates the client `RTCPeerConnection` inside the client's own
`joined` handler (`createClientPeer()` at line 338). When the host's socket drops and
the host re-joins (registry evicts the stale host, `room-registry.js:118-124`), the
host is assigned a **new** peerId and calls `createHostPeer` → sends a fresh offer.
- Trigger: host laptop sleeps / Wi-Fi blips / host tab reloads mid-session.
- Wrong behavior: the client receives the new offer and applies it to its *existing*
  (now `failed`/`disconnected`) pc via `setRemoteDescription` (line 368). This pc was
  built for the old DTLS/ICE session; renegotiation onto it is unreliable and often
  throws or never reconnects. Meanwhile the client's `peer-left` handler (line 349-355)
  already set state to `disconnected`. The client is stuck until a manual refresh.
- Fix: on the client, tear down and `createClientPeer()` whenever a new offer arrives
  from a different `from` id (host identity changed), or when the current pc is in a
  terminal state.

### 1.4 `ready` legacy signal is dead; only the first client triggers it (P2, dead code)
`server.js:327-329` broadcasts `ready` only when `room.peers.size === 2`. No client of
`handleSignal` in `useWebRTC.ts` handles `type: 'ready'`. It is inert for every peer and
never fires for the 3rd+ secondary. Harmless but misleading; remove or wire it.

### 1.5 Room TTL (30 min) silently kills remote control mid-session (P1)
`room-registry.js:72` sets `expiresAt = now + ttlMs` and it is **never extended**
(no keep-alive touches it anywhere). `canInject` gates on `now <= expiresAt`
(line 181) and `sweep()` deletes expired rooms (line 219).
- Trigger: any session longer than 30 minutes.
- Wrong behavior: media is peer-to-peer and keeps flowing, but after 30 min every
  `input-inject` is dropped by `server.js:341` (canInject false) and the room is
  reaped with **no notification to peers**. The user sees video continue while the
  mouse/keyboard abruptly and permanently stop, with no error.
- Fix: extend `expiresAt` on activity (join/relay/input) for rooms with ≥1 peer, or
  only expire *empty* rooms; and push a `session-expired` signal before reaping.

### 1.6 Host↔stale-host eviction races the client's `peer-left` (P2)
When a reconnecting host evicts the stale host (`room-registry.js:118-124`), the
client isn't told; only when the stale socket later closes does `leave()` fire
`peer-left {peerId: staleHostId}` (`server.js:350-357`). Depending on whether the new
offer arrived first, `hostIdRef` may equal the new or old id, so the client may or may
not mark itself disconnected — nondeterministic. Compounds 1.3.

---

## 2. Input / Clicking  ← contains the keystone bug

### 2.1 KEYSTONE: coordinates normalized against the container, but the video is `object-fit: contain` (P0)
This is the concrete cause of "the cursor moves but clicks don't land."
- `frontend/src/styles/app.css:359`: `.video-stage video { … object-fit: contain; }`
- `frontend/src/components/VideoStage.tsx:15-27`: `cropStyle` returns `undefined` for the
  default full-frame region, so the CSS `object-fit: contain` applies (mirror mode).
- `frontend/src/hooks/usePointerCapture.ts:36-41`: `normalize()` divides by
  `el.getBoundingClientRect()` where `el` is `.client-live`, which is `100vw × 100vh`
  (`app.css:349-357`).

Trigger: any client whose viewport aspect ratio ≠ the host surface aspect ratio — e.g.
a 16:10 MacBook or a portrait phone viewing a 16:9 desktop (i.e. essentially always).

Wrong behavior: `object-fit: contain` letterboxes the video inside the container, so the
rendered video occupies only part of `.client-live` (black bars). But the normalized
0..1 coordinate is computed over the **whole container**, not the visible video rect.
Every pointer position is therefore offset/scaled: the remote cursor does not sit under
the user's pointer, and a click aimed at a button lands on empty desktop or an adjacent
widget — "clicks don't register." Moves *appear* to work (the cursor still moves), which
is exactly the reported asymmetry. The vertical error equals the letterbox bar fraction.

Fix: compute normalization against the **actual displayed video rectangle**, not the
container. Either derive the content rect from `videoWidth/videoHeight` +
`getBoundingClientRect()` (account for the contain letterbox), or make the video fill the
container with `object-fit: fill`/a known contain math and map through it. This one fix
should restore clicking.

### 2.2 All input is injected onto the PRIMARY monitor regardless of the shared surface (P1, sometimes P0)
`backend/lib/input-controller.js:177-185` maps normalized coords to
`Screen::PrimaryScreen.Bounds` unless a `monitor` index is supplied; `sanitize` defaults
`monitor: -1` (line 357). The frontend **never sets `monitor`** (confirmed: no `monitor`
producer anywhere in `frontend/src`).
- Trigger: host picks a non-primary monitor, or a single **window**, or a **browser tab**
  in the `getDisplayMedia` picker (`useDisplayCapture.ts:27`).
- Wrong behavior: moves *and* clicks are injected onto the primary monitor's geometry,
  landing nowhere near the captured surface → "clicks do nothing." For a shared window/tab
  there is no mapping at all; coordinates are meaningless.
- Fix: detect/choose the captured surface (`getDisplaySurface`/`displaySurface` +
  a monitor picker) and pass the correct `monitor` index; for window/tab capture, capture
  the window rect and offset input to it (or restrict sharing to full monitors).

### 2.3 Wheel scroll throws on one direction and is mis-scaled (P2)
`input-controller.js:240-243`: `$delta = -[int]$cmd.deltaY; mouse_event(WHEEL,0,0,[uint32]$delta,0)`.
- `[uint32]` of a negative value throws in PowerShell ("Value too small for UInt32"),
  caught by the outer `try` and silently dropped. So scrolling in one direction (whichever
  makes `$delta` negative) does **nothing**; only the other direction scrolls.
- Even when it works, raw `deltaY` (often 3–100 px) is passed where Windows expects
  multiples of `WHEEL_DELTA` (120), so a notch scrolls a tiny fraction of a line.
- Fix: cast via signed→unsigned two's complement (`[uint32]([int]$delta -band 0xFFFFFFFF)`
  or build the DWORD explicitly) and scale to `±120` steps.

### 2.4 Shifted/symbol keys lose their shift state (`-band 0xFF`) (P2)
`input-controller.js:249-251` and `260-262`: for a 1-char key, `VkKeyScan(ch) -band 0xFF`
keeps only the virtual-key and **discards the high-byte shift/ctrl/alt state**.
- Trigger: a client that emits a composed character as `e.key` without a matching physical
  modifier event — e.g. Mac `Option`-produced glyphs, or any layout where a symbol needs
  shift but the browser reports the symbol directly.
- Wrong behavior: `@` (VkKeyScan returns "2" + shift) is injected as `2`; capitals rely
  entirely on a separately-transmitted `Shift` keydown surviving in order. Symbols/accents
  come out wrong.
- Fix: honor the high byte — synthesize the shift/ctrl/alt keydown around the VK when
  `VkKeyScan` reports those flags.

### 2.5 Keyboard input dies in fullscreen (focus leaves the container) (P2)
Key listeners are bound to the `.client-live` container (`usePointerCapture.ts:95-96`),
which must be the focus/target. `useFullscreen.ts:16` calls
`document.documentElement.requestFullscreen()`, moving the fullscreen root (and typically
focus) to `<html>` — an **ancestor** of the container. Keydown then targets `<html>` and
never reaches the container's bubble-phase listener.
- Wrong behavior: after entering fullscreen the keyboard stops working (mouse still fine).
- Fix: attach key listeners to `window`, or fullscreen the container itself and re-focus it.

### 2.6 Early control-channel clicks can be dropped (P2)
`App.tsx:111-112`: down/up are sent only if `channels.control.readyState === 'open'`, else
silently dropped. If a user clicks in the brief window after the cursor channel opens but
before the control channel opens, moves work but the click is lost — a milder, transient
echo of the main symptom. Buffer or briefly retry down/up until control opens.

---

## 3. Video Quality

### 3.1 The Resolution dropdown does nothing (P1)
`HostView.tsx:93-100` and `App.tsx:27` feed `settings.resolution` ('1080p'|'1440p'|'4K')
into `useWebRTC`, but the hook **never reads `resolution`** — `setEncoderCaps`
(`useWebRTC.ts:59-67`) only sets `maxBitrate`/`maxFramerate`, and capture is hard-pinned
to 4K (`useDisplayCapture.ts:16-25`, ideal/max 3840×2160). There is no
`scaleResolutionDownBy` and no capture-resolution change.
- Wrong behavior: choosing "1080p" to improve a weak-link session has zero effect; the
  host keeps encoding 4K frames. On a hotspot the encoder is starved → blocky, low-fps
  output — the "very poor quality" report.
- Fix: map the resolution setting to `scaleResolutionDownBy` on the sender encoding (and/or
  re-`applyConstraints` the capture track) so 1080p/1440p actually reduce the encoded size.

### 3.2 `contentHint = 'detail'` + 4K forces maintain-resolution degradation (P1)
`useDisplayCapture.ts:30-32` sets `videoTrack.contentHint = 'detail'`, which biases WebRTC
to `degradationPreference: maintain-resolution`. Combined with forced 4K and no downscale,
under bandwidth pressure the stack keeps 4K resolution and instead collapses framerate and
raises the quantizer → smeary, few-fps desktop.
- Fix: on constrained links prefer `maintain-framerate` or `balanced`, and cap capture/encode
  resolution (see 3.1) so the encoder isn't asked to paint 4K over a few Mbps.

### 3.3 Codec preference (AV1 → HEVC → VP9 first) can force slow software encoding (P1)
`useWebRTC.ts:34` prefers `AV1 → H265 → VP9 → VP8 → H264`, applied at
`applyVideoCodecPreferences` (36-54).
- In practice Chrome exposes AV1 as **software** for WebRTC and does not expose HEVC send;
  VP9 4K@60 software encoding is CPU-bound. Ranking these above H264 pushes negotiation
  toward a codec the host must encode in software at 4K@60 → low real fps, high latency,
  poor quality — even though hardware H264 would look far better in real time.
- Fix: prefer hardware-friendly real-time codecs (H264 baseline/VP8, or AV1 only when a
  hardware AV1 encoder is confirmed), and/or gate the preference on measured encode fps.

### 3.4 `setEncoderCaps` sets `maxFramerate` from settings but never resolution scale (P2)
`useWebRTC.ts:59-67` writes `maxBitrate`/`maxFramerate` only. With `params.encodings[0]`
having no `scaleResolutionDownBy`, the bitrate cap alone can't rescue a starved 4K encode
(see 3.1). The fair-share floor (`BANDWIDTH_FLOOR_MBPS = 4`, line 74) is also applied
blindly regardless of the true uplink, which can oversubscribe a hotspot with N secondaries.

### 3.5 Battery degrade on the host is one-way and never restores (P2)
`App.tsx:49-53`: on `battery.shouldDegrade` the host is forced to `fps:30, bitrateMbps:10`
via `setSettings`, but nothing ever restores the prior settings when the host is plugged
back in or rises above threshold.
- Wrong behavior: a laptop host that dips below 15% once is stuck at 10 Mbps/30 fps for the
  rest of the session — a permanent, unexplained quality drop.
- Fix: restore prior settings when `!shouldDegrade`, or apply the cap non-destructively.

---

## 4. Extend / Regions

### 4.1 Extend mode is completely dead from the UI (P1, feature non-functional)
`App.tsx:32-38` calls `useWebRTC(roomId, isHost, localStream, settings, hostToken)` — the
6th `extend` arg is omitted, so it defaults `false` (`useWebRTC.ts:104`). `assignRegions`
(184-194) therefore always emits `FULL_REGION`, and there is no extend toggle in `HostView`.
- Wrong behavior: the entire region-tiling / video-wall path (`assignRegions`, VideoStage
  `cropStyle`, the region control message, and the `sendInput` region remap in `App.tsx:97-99`)
  is inert. "Extend display does nothing" because nothing ever turns it on.
- Fix: either wire an extend toggle through to `useWebRTC(extend=…)` or remove the dormant
  region machinery. Note the WebRTC "extend" (cropping one shared surface into columns) is a
  *different* feature from the VDD/`displayswitch /extend` OS extend (Area 5) — today neither
  is reachable/working.

### 4.2 Region remap is correct only under `object-fit: fill`, but mirror uses `contain` (P2)
`App.tsx:97-99` maps client coords into the assigned region assuming the video fills the
stage. In FULL/mirror mode the stage uses `object-fit: contain` (see 2.1), so even if
regions were enabled the remap composes with the letterbox error. Fixing 2.1 is prerequisite.

---

## 5. Virtual Display Driver (VDD)

### 5.1 Root cause it "does nothing": unsigned sample driver won't install on stock Windows (P1, partly inherent)
`scripts/Install-VirtualMonitor.ps1` downloads `ge9/IddSampleDriver` (unsigned) and runs
`pnputil /add-driver … /install`. Without test-signing mode Windows refuses to load it, so
no virtual display is enumerated and `Configure-VirtualDisplay.ps1 Get-VDDStatus` reports
`Present = false`. The script now reports this truthfully (good), but the net effect remains
"the VDD section does nothing" on any normal machine.
- Fix: ship a properly signed IDD driver, or clearly gate the feature behind a documented
  test-signing setup. This is largely inherent to using an unsigned sample driver.

### 5.2 Elevated VDD operations never return their real result (P1)
`backend/lib/idd-controller.js:11-13` runs install/enable/disable via
`Start-Process powershell -Verb RunAs -Wait …`. The elevated child runs in a **separate**
process whose stdout is not piped back; the outer `exec` captures nothing, so
`parseOutput` yields `{ success: true, output: '' }` regardless of the child's real
`{success:false,error:…}` JSON or a UAC cancellation.
- Trigger: click "Install driver" / "Enable virtual display."
- Wrong behavior: `DisplayControls.tsx:34-46` always shows "Virtual display driver
  initialized." even on total failure or UAC-denied; `res.data` is `undefined` so
  `refreshStatus` (23-26) can't update `installed/present`. The UI lies about success.
  (The non-elevated `Status` call *does* return real data, so state only updates from that
  separate poll — masking the failure further.)
- Fix: have the elevated child write its JSON result to a temp file and read it back after
  `-Wait`, or use a named pipe; surface the real success/error to the client.

### 5.3 `displayswitch /extend` extends onto nothing when no second display exists (P1)
`server.js:216-233` (`/api/vdd/configure` with `displayMode: extend`) and
`Configure-VirtualDisplay.ps1 Enable` both run `displayswitch.exe /extend`. With no VDD or
physical second monitor present (see 5.1), Windows has nothing to extend onto, so the call
is a no-op — "extend does nothing." Fix depends on 5.1.

### 5.4 SpatialConfigurator drag is decorative — not wired to anything (P2)
`DisplayControls.tsx:124-129` renders `<SpatialConfigurator>` **without** an
`onLayoutChange` handler. `SpatialConfigurator.tsx:54-58` computes a layout on drop and
calls `onLayoutChange?.(…)`, but with no prop it's a no-op. Dragging the "Extended" box
changes nothing on the host, the backend, or the region assignment. Either wire the layout
to real monitor-arrangement / region assignment, or label it as a non-functional mockup.

### 5.5 `parseOutput` treats any non-JSON stdout as success (P2)
`idd-controller.js:34-45` and `bluetooth-controller.js:15-24`: when no `{…}` is found in
stdout the result is `{ success: true, output }`. A script that errors to stderr but prints
a warning to stdout is reported as success. Combined with 5.2 this makes the VDD panel
optimistic about failures.

---

## 6. Lifecycle / Cleanup / State

### 6.1 Client clipboard sync & wake lock silently fail on the (insecure) client origin (P2)
Clients load over `http://<lanIP>:<port>` (insecure context). `navigator.clipboard`
(`useClipboardSync.ts:16-19,33-35`, `peer-io.ts:99-112`) and `navigator.wakeLock`
(`useWakeLock.ts:7`) require a secure context, so on Safari-over-LAN-http they throw and
are swallowed. Clipboard sync and screen-wake simply never work for clients — with no
indication. Tied to 1.2 (you can't just switch to HTTPS without breaking signaling).

### 6.2 Host encoder settings only apply to already-connected peers; late joiners miss them (P2)
`useWebRTC.ts:515-518` re-runs `redistributeBandwidth` on settings change over the current
`peersRef`. A secondary that connects afterward gets caps from `createHostPeer`'s initial
`redistributeBandwidth` (259) — fine — but if capture was stopped/restarted, a peer created
while `localStream` was null gets **no video track** and the `replaceTrack` effect (504-512)
only swaps existing senders, never adds a track. That secondary shows a black screen.
- Fix: (re)add the track (renegotiate) for peers that were created without one.

### 6.3 Flapping client leaves a dead host-peer entry until the old socket closes (P2)
A client that reconnects gets a new peerId (`room-registry.js:130`), so the host's
`peersRef` briefly holds both the dead and new entries (dead one cleared only on the old
socket's `peer-left`). Transient memory/`peerCount` inflation; self-heals. Low impact.

### 6.4 Host clipboard broadcast requires manual `readText` permission and focus (P2)
`useWebRTC.ts:486-500` reads the OS clipboard on `copy`. On the host browser this needs
clipboard-read permission and document focus; when denied it silently no-ops. Acceptable but
undiscoverable.

---

## 7. Backend Robustness

### 7.1 Elevated `exec` string-builds a shell command with the script path (P2)
`idd-controller.js:11-13` interpolates `scriptPath`/`args` into a `powershell -Command
"Start-Process … -ArgumentList '…"${scriptPath}"…'"` string via `exec`. `args` are
integer-coerced (safe), and `scriptPath` is derived from `__dirname` (not user input), so
this isn't remotely exploitable today, but it is brittle (spaces/quotes in an install path
would break it) and inconsistent with the safe `execFile` used elsewhere
(`server.js:226`). Prefer `execFile`/argument arrays throughout.

### 7.2 Input injection rate limit is generous but shared with joins (P2)
`server.js:276` gives each socket `RateLimiter(300, 500)` for *all* messages including
high-rate pointer moves; `server.js:303` additionally consumes the **per-IP HTTP** limiter
(`RateLimiter(20,50)`, line 41) on every `join`. The per-IP HTTP limiter is also consumed by
static/API traffic; a burst of joins plus normal API calls from one NAT'd IP (a hotspot with
several devices shares one public IP, but here it's the LAN IP) could 429 legitimate joins.
Low impact on a small LAN; note for larger deployments.

### 7.3 PowerShell injector: `Start-Sleep 10ms` inside the command loop serializes input (P2)
`input-controller.js:231-232,237-238` (`click`/`rightclick`) block the single injector
process for 10 ms each. Since one persistent PowerShell serves *all* secondaries' input,
rapid clicking or multiple clients contend on one serialized stdin loop, adding latency
spikes. The primary click path uses separate mousedown/mouseup (no sleep), so this mainly
affects the `click`/`rightclick` opcodes. Minor.

### 7.4 Legacy `scripts/Inject-Input.ps1` is dead code (P2)
The persistent injector embeds its own `PS_SCRIPT` in `input-controller.js`;
`scripts/Inject-Input.ps1` is referenced nowhere. Dead; remove to avoid confusion.

### 7.5 Rooms are reaped mid-session with no peer notification (P1 — see 1.5)
`room-registry.js:216-225` `sweep()` deletes expired rooms without emitting any signal;
peers' `_roomId` then dangles and input/relay silently fail. Notify peers before reaping.

---

## Prioritized fix list

### P0 — fix first (blocks core use)
1. **2.1 Coordinate mapping** — normalize pointer input against the actual displayed video
   rect, not the `100vw×100vh` container. `object-fit: contain` letterboxing is why clicks
   miss while moves "work." This is the single highest-impact fix for "can't click."
2. **1.1 Add a TURN server** — STUN-only will fail outright on many cellular/hotspot NATs;
   without it the whole session can't establish. (P0 specifically for the tested
   hotspot scenario.)

### P1 — major
3. **2.2 Inject to the correct monitor/surface** — stop assuming primary; pass the captured
   monitor index (and handle window/tab capture) so input lands where it's shown.
4. **3.1 / 3.2 / 3.3 Make quality controls real** — apply the Resolution setting via
   `scaleResolutionDownBy`, stop forcing 4K + maintain-resolution on weak links, and reorder
   codecs toward hardware-friendly real-time encoding. Directly addresses "poor quality."
5. **1.3 Client recovery on host reconnect** — recreate the client pc on a new-host offer /
   terminal state so a host blip doesn't require a manual refresh.
6. **1.5 / 7.5 Room-TTL kills input at 30 min** — extend `expiresAt` on activity (or only
   expire empty rooms) and notify peers before reaping.
7. **4.1 Extend mode is dead** — either wire the `extend` flag through `useWebRTC` and a UI
   toggle, or remove the dormant region code so the feature isn't advertised-but-inert.
8. **5.2 VDD elevated results are fabricated success** — read the elevated child's real
   result; **5.1/5.3** VDD/extend need a signed driver to do anything at all.
9. **1.2 ws/wss vs plain-HTTP signaling** — resolve the TLS mismatch so an HTTPS deployment
   (needed for Safari client features) doesn't break signaling.

### P2 — minor / edge (batch)
2.3 wheel direction crash & scaling · 2.4 shift/symbol VK loss · 2.5 fullscreen keyboard
focus · 2.6 early control-channel click drop · 3.5 one-way host battery degrade · 5.4
SpatialConfigurator not wired · 5.5/7.1 optimistic parseOutput & string-built exec · 6.1
insecure-origin clipboard/wakelock · 6.2 black screen for peers created without a track ·
7.3 click opcode sleeps · 7.4 dead Inject-Input.ps1.
