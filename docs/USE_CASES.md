# Telecastt — Use-Case & Edge-Case Matrix

Rigorous QA/reliability analysis of the current codebase (read-only). Every
"current behavior" cell cites real code. Severity scale:

- **P0** — core promised capability is broken, or a crash/critical-security defect.
- **P1** — a major feature is broken/unreliable or an abuse vector exists, with no user workaround.
- **P2** — degraded experience or edge failure that has a workaround.
- **P3** — minor, cosmetic, or rare.

## TL;DR architecture reality check

The backend was refactored to a genuine **multi-peer** model
(`backend/lib/room-registry.js`: one host + N clients, host authenticated by
token, per-peer routing with `data.to` and `from`-stamping). **The frontend was
not.** `frontend/src/hooks/useWebRTC.ts` still holds a **single**
`RTCPeerConnection` (`pcRef`, line 40), a single `control` channel and a single
`clipboard` channel (lines 83–85). The server only kicks off negotiation when a
room reaches exactly two peers (`backend/server.js:302`). So the product's
headline promise — *one primary desktop extended across TWO OR MORE secondaries,
each an independently-controllable surface* — **does not work today beyond a
single secondary.** Most P0s below are facets of this single gap.

Second structural gap: the host shares **one** `getDisplayMedia` surface
(`useDisplayCapture.ts:27`) and adds those exact tracks to the one peer
connection (`useWebRTC.ts:79–85`). Even if N connections existed, every
secondary would receive the **identical** surface — there is no per-secondary
region cropping. "Each secondary is its own display region" is unimplemented at
the media layer.

Third: input is injected against the whole **virtual desktop** because the
per-monitor `monitor` index is never populated (`useHostInputRelay.ts:6–22`
builds the inject payload and omits `monitor`; `input-controller.js:360` then
defaults it to `-1`, and `:185–188` maps normalized coords across the entire
`VirtualScreen`). Coordinate mapping to a specific secondary's region is absent.

---

## 1. Connection lifecycle

### 1.1 Client (secondary) disconnects
- **Trigger:** a secondary closes its tab / loses Wi-Fi.
- **Expected:** host keeps serving remaining secondaries; the departed surface is dropped cleanly; that client's held keys/buttons are released.
- **Current:** `ws.on('close')` → `registry.leave(peer)`; if the room survives it broadcasts **both** `peer-disconnected` and `peer-left` to *every* remaining peer (`server.js:324–332`). In `useWebRTC`, `peer-disconnected` unconditionally tears down and rebuilds the single PC (`useWebRTC.ts:203–208`). With one secondary this is acceptable; with 2+ it nukes healthy sessions (see 1.8). No key/button release occurs anywhere (see §3.2).
- **Severity:** P1 (P0 in multi-peer).
- **Fix:** stop broadcasting a bare `peer-disconnected`; deliver `peer-left {peerId}` only, and have the client tear down **only** the matching per-peer connection (requires the per-peer refactor). Inject synthetic key/button-up for that peer on leave.

### 1.2 Host (primary) disconnects
- **Trigger:** host tab closes or process dies.
- **Expected:** secondaries see "host offline", stop input, and auto-recover when the host returns.
- **Current:** host's close removes it; `hostId` cleared (`room-registry.js:191–199`); survivors get `peer-disconnected` → rebuild PC and sit in `disconnected` (`useWebRTC.ts:203–208`). The signaling WS stays open, so if the host rejoins and the room hits 2 peers again, `ready` re-fires (`server.js:302`) and negotiation restarts. Works for the 2-peer case; the client shows raw `DISCONNECTED` with no "host left" copy.
- **Severity:** P2.
- **Fix:** surface an explicit "Host disconnected — waiting for reconnect" state; freeze last frame instead of black.

### 1.3 Reconnection after transient WS drop
- **Trigger:** brief network blip on the signaling socket.
- **Expected:** transparent reconnect, media preserved.
- **Current:** exponential backoff, max 5 retries, cap 16 s (`useWebRTC.ts:20, 244–257`); rejoins with role/token (`:228–233`). The media PC is **not** rebuilt on WS reconnect (only on `roomId` change), so an established SRTP flow can survive a pure signaling blip. But a reconnecting peer is issued a **new** `peerId` every time (`room-registry.js:130`), so from the host's side it looks like a brand-new secondary — fine for 2-peer, state-leaking for N-peer. After `MAX_RETRIES` the only recovery is a manual refresh.
- **Severity:** P2.
- **Fix:** allow a client to resume its prior `peerId` via a short-lived resume token; keep retrying (with longer backoff) rather than dead-ending at 5.

### 1.4 Network flip (Wi-Fi ↔ Ethernet)
- **Trigger:** host or secondary changes active interface; local IP changes.
- **Expected:** ICE re-gathers, media resumes within seconds.
- **Current:** ICE restart is only attempted on connection state `failed`, and **only by the host** (`useWebRTC.ts:122–129`). WebRTC often parks in `disconnected` for 10–30 s before declaring `failed`, so a flip stalls noticeably. A client-side flip never triggers a restart (client never calls `iceRestart`). No `stun`-only path survives a NAT rebinding without a relay (see 1.5).
- **Severity:** P2.
- **Fix:** trigger `iceRestart` on `disconnected` after a short debounce, on **both** ends; consider `RTCPeerConnection.restartIce()`.

### 1.5 NAT / firewall, no TURN configured
- **Trigger:** host and secondary on different networks / symmetric NAT / restrictive firewall.
- **Expected:** relay fallback keeps the session alive.
- **Current:** `ICE_SERVERS` contains **STUN only** (`env.ts:12–20`). No TURN. On symmetric NAT or blocked UDP, ICE finds no candidate pair and the connection `fail`s with no fallback. Product is billed "PC-to-PC" but only reliably works same-LAN.
- **Severity:** P1 (for any cross-network use).
- **Fix:** ship a TURN server (coturn) with credentials; add `turns:` (TLS/443) for hostile firewalls.

### 1.6 Room expiry mid-session
- **Trigger:** session exceeds the 30-minute TTL (`server.js:91`, `room-registry.js:54`).
- **Expected:** warn before expiry; offer to extend; on expiry, tell the user clearly.
- **Current:** `sweep()` silently deletes the room (`room-registry.js:203–212`) with **no notification to connected peers**. P2P media may keep flowing (it's independent of the signaling room), but `canInject` starts returning false (`:179–182`) so input dies silently, and any reconnect attempt now 404s. Users experience "the video is up but nothing responds" with zero explanation.
- **Severity:** P1.
- **Fix:** push an `expiring-soon` warning (~2 min out) and a hard `session-expired` message; support host-initiated extension by resetting `expiresAt`.

### 1.7 Simultaneous joins (race)
- **Trigger:** two secondaries submit the same code at once near capacity.
- **Expected:** deterministic accept/reject; no over-subscription.
- **Current:** `validateRoom` (HTTP) and `join` (WS) both check capacity independently (`room-registry.js:93, 126–128`). Two clients can both pass HTTP validation, but the authoritative capacity check happens at `join`, so the (N+1)th is cleanly rejected with 409. Correct.
- **Severity:** P3.
- **Fix:** none required; optionally reflect the race in the UI copy ("Room filled up — try again").

### 1.8 Three or more peers joining
- **Trigger:** a 2nd secondary joins an active host+secondary room.
- **Expected:** the new secondary negotiates its own connection and becomes a second display surface.
- **Current:** **Broken.** `ready` fires only at `peers.size === 2` (`server.js:302`), so the 3rd peer never triggers negotiation and never receives an offer. The frontend ignores the `joined`/`peer-joined`/`peer-left` messages entirely — `handleSignal` has no case for them (`useWebRTC.ts:142–209`). Even the host's offer has no `to` field, so it broadcasts to all clients; multiple answers then clobber the host's single `pcRef` via repeated `setRemoteDescription` (`:177–187`).
- **Severity:** **P0** — this is the core product promise.
- **Fix:** per-peer connection map on the host (one PC + control channel per secondary), keyed by `peerId`; host offers to each `peer-joined` target using `data.to`; server should signal per-peer readiness rather than a single size-gated `ready`.

### 1.9 Stale host reconnection
- **Trigger:** host's socket half-dies; host reopens before the server reaps the old socket.
- **Expected:** new host takes over; old ghost evicted.
- **Current:** handled in the registry — presenting the valid token evicts the stale host (`room-registry.js:118–124`), covered by test 5. **But** the evicted socket is never told (`server.js:281–305` ignores `result.evicted`), so a zombie host tab believes it is still connected while its input is silently dropped (`canInject` false).
- **Severity:** P2.
- **Fix:** send an `evicted`/`superseded` message to `result.evicted` and have that client surface it and stop capture.

---

## 2. Multi-secondary extended display

### 2.1 Assigning a distinct region to each secondary
- **Trigger:** two secondaries should show the left and right halves of the extended desktop.
- **Expected:** host sends a different crop/stream to each.
- **Current:** **Unimplemented.** One `getDisplayMedia` surface is captured (`useDisplayCapture.ts:27`) and its tracks are added to the one shared PC (`useWebRTC.ts:79–85`). Every secondary receives the identical picture. `SpatialConfigurator.tsx` lets the user *drag boxes around* but its `onLayoutChange` is never wired to anything (`DisplayControls.tsx:119–124` passes no handler) — it's a cosmetic diagram.
- **Severity:** **P0** (core feature).
- **Fix:** per-secondary media: either capture the full virtual desktop once and crop per peer (canvas/`CropTarget`/`RTCRtpScriptTransform`), or run one capture+encode per assigned region; bind the spatial layout to real region assignment.

### 2.2 Resolution / DPI mismatch between PCs
- **Trigger:** host monitor 3840×2160 @150% DPI; secondary panel 1920×1080.
- **Expected:** input lands on the correct host pixel regardless of DPI.
- **Current:** the injector computes absolute pixels from `System.Windows.Forms.Screen`/`VirtualScreen` bounds (`input-controller.js:172–188`). PowerShell/WinForms is typically **System-DPI-aware**, so on a per-monitor-DPI or >100% scaled setup the reported bounds and `SetCursorPos` (physical pixels) disagree, producing a cursor offset that grows with scaling. Aspect handled by normalization, DPI is not.
- **Severity:** P2.
- **Fix:** mark the injector process **Per-Monitor-DPI-Aware v2**; compute against physical pixel bounds; validate on a mixed-DPI rig.

### 2.3 Mismatched aspect ratios
- **Trigger:** 16:9 host region viewed on a 16:10 or portrait secondary.
- **Expected:** letterbox and keep the pointer mapping correct.
- **Current:** the client normalizes against the video element's `getBoundingClientRect` (`usePointerCapture.ts:33–38`). If CSS stretches the `<video>` (no explicit `object-fit` guarantee in `VideoStage`), normalized coords map to the stretched box, not the letterboxed content, so clicks drift near the edges.
- **Severity:** P2.
- **Fix:** enforce `object-fit: contain` and normalize against the rendered content rect (account for letterbox bars), not the element rect.

### 2.4 A secondary joins/leaves mid-session
- **Trigger:** add/remove a display surface live.
- **Expected:** hot-plug: others unaffected.
- **Current:** join mid-session past 2 peers does not negotiate (§1.8); leave broadcasts `peer-disconnected` that resets *everyone* (§1.1). So hot-plug is broken in both directions.
- **Severity:** **P0**.
- **Fix:** per-peer lifecycle (see 1.8/2.1).

### 2.5 Coordinate mapping across multiple regions
- **Trigger:** secondary B (right region) clicks; input must hit the host's right monitor.
- **Expected:** normalized coords resolve against B's assigned monitor/region.
- **Current:** `monitor` is never set on the inject payload (`useHostInputRelay.ts:6–22`), so it defaults to `-1` and every click maps across the **entire** virtual desktop bounding box (`input-controller.js:181–188`). With multiple monitors this lands input in the wrong place.
- **Severity:** **P0/P1** (core feature).
- **Fix:** carry a per-secondary `monitor`/region descriptor from the layout assignment through `toInject` into the injector; the injector already supports a `monitor` index (`:181–184`).

### 2.6 Ordering of displays
- **Trigger:** user rearranges which secondary is left vs right.
- **Expected:** persisted, reflected in region assignment and input routing.
- **Current:** `SpatialConfigurator` maintains local drag state only; nothing persists or propagates (`SpatialConfigurator.tsx:54–59` calls an `onLayoutChange` that the parent never provides).
- **Severity:** P2 (blocked on 2.1/2.5 anyway).
- **Fix:** wire layout → region map → per-peer stream + input monitor index; persist to localStorage/room state.

---

## 3. Input / control

### 3.1 Secondary input while host is also using its own mouse
- **Trigger:** host moves its physical mouse while a secondary drives input.
- **Expected:** independent control that doesn't fight the host cursor.
- **Current:** desktop secondaries use **mouse** pointers, so `toInject` emits `mousedown/mouseup/move` (`useHostInputRelay.ts:11–18`), which the injector executes via `SetCursorPos`+`mouse_event` (`input-controller.js:208–235`) — i.e. it **hijacks the one physical cursor.** The touch path (which avoids cursor hijack) is only taken for `pointerType === 'touch'`. So host and secondary fight over a single cursor.
- **Severity:** P1.
- **Fix:** route secondary mouse input through the touch-injection path (or a virtual pointer) so it doesn't move the host's real cursor; or explicitly document single-cursor control and lock the host out during remote control.

### 3.2 Key (or mouse button) stuck down on disconnect
- **Trigger:** secondary holds Shift / left-button, then disconnects or the tab is hidden.
- **Expected:** host auto-releases everything that peer was holding.
- **Current:** **Unhandled.** Down events are injected (`input-controller.js:247–270, 211–219`), but on disconnect there is no synthetic key/button-up anywhere — `peer-disconnected` just rebuilds the PC (`useWebRTC.ts:203–208`) and the injector has no per-peer release logic. Result: stuck modifier/button on the host desktop.
- **Severity:** P1.
- **Fix:** track pressed keys/buttons per peer on the host; on `peer-left`/channel-close inject key-up/mouse-up for all held inputs; add a "release all" injector command.

### 3.3 Modifier keys and combos
- **Trigger:** Ctrl+C, Alt+Tab, Win, Ctrl+Shift+Esc, non-US layouts.
- **Expected:** faithful forwarding.
- **Current:** individual `keydown`/`keyup` with `e.key` over the reliable ordered channel (`usePointerCapture.ts:75–83`), mapped by `VK_MAP` or `VkKeyScan` (`input-controller.js:247–270`). Ordered delivery preserves combo sequencing. **But:** (a) browser/OS-reserved combos (Ctrl+W/T, Alt+Tab, Win, Ctrl+Shift+Esc) are swallowed by the client's browser/OS and never sent; (b) `VkKeyScan` result is masked with `-band 0xFF` (`:253, 265`), discarding the shift-state high byte, so shifted symbols depend entirely on a separately-forwarded Shift; (c) `e.key` is layout-resolved on the client but `VkKeyScan` uses the **host** layout — mismatched keyboard layouts yield wrong characters.
- **Severity:** P2.
- **Fix:** send `e.code` (physical) alongside `e.key`; map scancodes directly; document non-forwardable OS shortcuts; consider a "send Ctrl+Alt+Del/Win" affordance.

### 3.4 Multiple secondaries sending input at once
- **Trigger:** two secondaries type/click simultaneously.
- **Expected:** arbitration (one controller at a time) or per-region isolation.
- **Current:** **No arbitration.** `server.js:314–318` injects from **any** peer that passes `canInject` (mere room membership). All inputs collapse onto the single host cursor/keyboard, interleaving unpredictably.
- **Severity:** P1.
- **Fix:** a control-ownership model (request/grant, or per-region routing via `monitor`); only the owner of a region may inject to it.

### 3.5 Focus / coordinate mapping to the right monitor
- **Trigger:** secondary clicks expecting its own region to receive focus.
- **Expected:** input targets that region's monitor.
- **Current:** all input targets the whole virtual screen (§2.5). Keyboard also requires the client container to hold DOM focus (`usePointerCapture.ts:45`, `App.tsx:79–81`); tabbing away silently stops key capture with no indicator.
- **Severity:** P1 (shared with 2.5).
- **Fix:** as 2.5; add a "click to regain control" overlay when focus is lost.

### 3.6 Non-Windows host (injection is Windows-only)
- **Trigger:** host runs macOS/Linux.
- **Expected:** graceful degradation or platform support.
- **Current:** the injector spawns `powershell` (`input-controller.js:281`). On non-Windows the spawn `error` is caught so the server doesn't crash (`:315–320`), but injection silently no-ops — secondaries can view but never control, with no user-facing explanation. The VDD/Bluetooth controllers are likewise Windows-only PowerShell (`idd-controller.js`, `bluetooth-controller.js`).
- **Severity:** P2.
- **Fix:** detect platform; disable/annotate control UI on non-Windows; add a mac/Linux injection backend (e.g. via native module) if cross-platform is a goal.

---

## 4. Streaming quality

### 4.1 Low bandwidth
- **Trigger:** secondary on a slow link.
- **Expected:** encoder adapts down.
- **Current:** capture requests up to 4K/144 (`useDisplayCapture.ts:16–25`); host caps bitrate/framerate from the settings dropdown only (`useWebRTC.ts:300–310`). WebRTC's own congestion control will reduce quality, but there is no per-secondary adaptation and the client cannot signal its own constraints.
- **Severity:** P2.
- **Fix:** let each secondary report link stats and request a target; drive `setParameters` per peer.

### 4.2 High latency / packet loss
- **Trigger:** lossy link.
- **Expected:** stay responsive.
- **Current:** receiver tuned for freshness (`playoutDelayHint`/`jitterBufferTarget = 0`, `useWebRTC.ts:103–106`) — good for interactivity but amplifies visible loss/jerkiness with no FEC/retransmit tuning. Input travels a **reliable ordered** channel (`:83`), so under loss input queues and lags rather than dropping stale moves.
- **Severity:** P2.
- **Fix:** consider an unreliable/max-retransmit channel for high-frequency pointer-move (keep down/up/keys reliable); enable video FEC where available.

### 4.3 A slow secondary dragging down the others
- **Trigger:** one weak secondary.
- **Expected:** isolation — others unaffected.
- **Current:** today there's only one shared PC so quality is effectively global; once multi-peer exists, per-peer `setParameters` is required or REMB from the slowest peer will throttle a shared encoder. Design not yet in place (`useWebRTC.ts` single sender).
- **Severity:** P1 (once multi-peer lands).
- **Fix:** independent encodings per peer (simulcast or per-peer encoder).

### 4.4 Battery / thermal
- **Trigger:** secondary on low battery.
- **Expected:** reduce demand.
- **Current:** `useBatteryAware` flips `settings` to 30fps/10Mbps (`App.tsx:46–52`), but `settings` is only fed to `useWebRTC` when `isHost` (`App.tsx:37`). On a **client** the change is a local no-op — it never reaches the host encoder. The comment "Degrade stream on low client battery" is aspirational; the mechanism is missing.
- **Severity:** P2.
- **Fix:** send a "degrade" request from the low-battery secondary over the control channel; host applies per-peer caps.

### 4.5 4K / high refresh
- **Trigger:** 4K @144.
- **Expected:** negotiated to a sane target.
- **Current:** ideal 4K/144 requested (`useDisplayCapture.ts:16–19`); combined with a 100 Mbps cap this can overwhelm modest secondaries; no downscale per receiver.
- **Severity:** P2.
- **Fix:** per-peer resolution/framerate targets; default conservative and scale up.

---

## 5. Files & clipboard

### 5.1 File transfer (any size)
- **Trigger:** user drags a file onto a secondary.
- **Expected:** chunked, resumable transfer with progress.
- **Current:** **Entirely unimplemented.** No file-transfer code exists in the frontend (no drop handler, no chunking, no file data channel). A product requirement is absent.
- **Severity:** P1 (feature gap).
- **Fix:** add a dedicated file data channel with chunking, backpressure (`bufferedAmountLowThreshold`), integrity hash, and a resume protocol.

### 5.2 Interrupted transfer
- **Trigger:** connection drops mid-file.
- **Expected:** resume or clean failure.
- **Current:** N/A — no transfer exists.
- **Severity:** P1 (blocked on 5.1).
- **Fix:** chunk-acked protocol with resume offset.

### 5.3 Clipboard of images / files (text-only today)
- **Trigger:** copy an image or file.
- **Expected:** sync richer clipboard types.
- **Current:** `useClipboardSync` handles **text only** via `readText`/`writeText` (`useClipboardSync.ts:14–38`). Images/files are ignored.
- **Severity:** P2.
- **Fix:** use the async `ClipboardItem` API for `image/*`; gate large payloads through the file channel.

### 5.4 Privacy: whole clipboard auto-exfiltrated on copy
- **Trigger:** user copies anything (e.g. a password) anywhere while the room is open.
- **Expected:** clipboard shares only on intent, ideally scoped.
- **Current:** on **any** window `copy` event the hook reads the **entire** clipboard and pushes it to the peer with no confirmation (`useClipboardSync.ts:14–20`), and it's active whenever `mode !== 'landing'` (`App.tsx:64`). A copied secret silently lands on the other machine's clipboard.
- **Severity:** P2 (privacy).
- **Fix:** make clipboard sync opt-in / manual ("send clipboard" button), or at least a toggle and a visible indicator; never auto-broadcast on every copy.

### 5.5 Cross-OS line endings
- **Trigger:** copy CRLF text between Windows and mac/Linux.
- **Expected:** normalized to the receiver's convention.
- **Current:** raw text copied verbatim (`useClipboardSync.ts:19, 34`); no EOL normalization.
- **Severity:** P3.
- **Fix:** normalize on write per receiver OS.

### 5.6 Concurrent transfers
- **Trigger:** two secondaries send files at once.
- **Expected:** independent, fair.
- **Current:** N/A (no transfer, single shared clipboard channel).
- **Severity:** P2 (blocked on 5.1 + multi-peer).
- **Fix:** per-peer channels; the `ts` monotonic guard (`useClipboardSync.ts:31`) is a global last-writer-wins that will drop concurrent clipboard updates once multiple peers exist.

---

## 6. Security / abuse

### 6.1 Room-code guessing
- **Trigger:** attacker brute-forces codes.
- **Expected:** guessing is infeasible / throttled.
- **Current:** 32-char ambiguity-free alphabet, 6 chars → ~1.07×10⁹ combos, CSPRNG (`room-registry.js:26–35`). `validate-room` is throttled by the per-IP token bucket (20/s, burst 50; `server.js:42`). Rooms expire in 30 min. Reasonably strong, but there's no per-code lockout and `validate-room` leaks existence + `status` + `clientCount` (`server.js:151–157`), aiding enumeration.
- **Severity:** P3.
- **Fix:** tighten the validate limiter, add a global failed-attempt limiter, and stop returning peer counts on validate.

### 6.2 Malicious client flooding input
- **Trigger:** a joined secondary blasts `input-inject` messages.
- **Expected:** server-side rate limiting.
- **Current:** the token-bucket limiter is Express-only middleware (`server.js:60–67`); **WebSocket messages are not rate limited at all.** Once joined, a client can flood `input-inject` (`server.js:314–318`), each event writing to the PowerShell injector's stdin (`input-controller.js:386`). Only `maxPayload` (256 KB/message, `server.js:77`) bounds size, not rate → host CPU/cursor DoS.
- **Severity:** P1.
- **Fix:** per-connection WS rate limiter on `input-inject` (reuse `RateLimiter`); coalesce moves; drop when over budget.

### 6.3 Oversized payloads
- **Trigger:** attacker sends huge messages.
- **Expected:** rejected.
- **Current:** WS `maxPayload: 256*1024` (`server.js:77`) and Express `json limit 256kb` (`server.js:34`) cap size. Inject payload fields are coerced/clamped (`input-controller.js:335–362`). Good.
- **Severity:** P3.
- **Fix:** none material; consider a smaller cap for signaling messages specifically.

### 6.4 Origin spoofing / allow-list bypass
- **Trigger:** a drive-by page or sandboxed context tries to open the signaling socket / control endpoints.
- **Expected:** only trusted LAN/localhost origins.
- **Current:** allow-list regex on HTTP CORS and WS `verifyClient` (`server.js:20–33, 80`). Two soft spots: (a) **`Origin: null` is trusted** — `isTrustedOrigin` returns `true` for any falsy origin (`server.js:23`), and sandboxed iframes / some webviews send `Origin: null`, so such a context is granted access; (b) hostname/mDNS access (`http://host.local`) is **not** matched by the IP-only regex, so legitimate `.local` access is *rejected*, breaking the app while an attacker who can present a private-IP origin is allowed.
- **Severity:** P2.
- **Fix:** don't blanket-trust `null` origin for state-changing/WS paths; add an allow-listed hostname mechanism for legitimate `.local`/DNS access.

### 6.5 Unauthenticated device-control endpoints (noted, adjacent)
- **Trigger:** any device on the LAN POSTs `/api/vdd/install`, `/api/vdd/enable`, `/api/bluetooth/enable`, etc.
- **Expected:** only the authenticated host may drive device control.
- **Current:** these endpoints have **no room/token check** (`server.js:165–245`) — they're gated solely by the LAN origin allow-list. `install` runs `Start-Process -Verb RunAs` (UAC-elevated) (`idd-controller.js:11–13, 51–53`). Any LAN peer (or a `null`-origin context per 6.4) can trigger a UAC prompt / driver install / display topology change on the host.
- **Severity:** P1 (abuse) — likely overlaps SECURITY_AUDIT scope.
- **Fix:** require the host token on all `/api/vdd/*` and `/api/bluetooth/*` calls; bind them to the host session.

---

## 7. UX / edge

### 7.1 Browser autoplay policy
- **Trigger:** stream arrives without a prior user gesture.
- **Expected:** graceful tap-to-play.
- **Current:** handled — `VideoStage` mutes and retries, showing a "Tap to start" affordance on `play()` rejection (`VideoStage.tsx:16–27, 48–54`).
- **Severity:** P3. **Side effect:** the video is force-`muted` (`:21, 47`) permanently, so **shared audio is never audible** even after playback starts.
- **Fix:** after the first user gesture, offer an unmute control so audio can play.

### 7.2 Permission denied (screen capture / clipboard)
- **Trigger:** user cancels the capture picker or denies clipboard.
- **Expected:** clear recovery.
- **Current:** capture cancel returns null and aborts host start (`useDisplayCapture.ts:46`, `App.tsx:88`) — no explicit "you cancelled" message, just no-op. Clipboard denial is swallowed silently (`useClipboardSync.ts:21, 35`).
- **Severity:** P2.
- **Fix:** distinguish cancel vs error; toast "Screen sharing was cancelled"; surface clipboard-permission state.

### 7.3 No secure context (HTTP vs HTTPS)
- **Trigger:** host opens the app at `http://192.168.x.x:PORT` (not localhost); secondary joins over the same HTTP QR link.
- **Expected:** APIs work or a clear warning.
- **Current:** URLs derive from page protocol (`env.ts:5–10`) and the client join URL from the host's protocol (`env.ts:28–32`). On a non-localhost **HTTP** origin, `getDisplayMedia` (host) and `navigator.clipboard` (both) are unavailable (insecure context) — host capture fails outright, clipboard sync silently dies. WebRTC itself still works, so the failure is confusing (video works, capture/clipboard don't). No warning is shown.
- **Severity:** P2.
- **Fix:** detect `window.isSecureContext` and warn; ship an HTTPS story (self-signed/mkcert or a tunnel) for LAN.

### 7.4 Mobile browsers
- **Trigger:** join from a phone.
- **Expected:** usable viewing/control surface.
- **Current:** touch is captured via Pointer Events (`usePointerCapture.ts:40–65`) and maps to native touch injection — reasonable. But `getDisplayMedia` (hosting) is unsupported on most mobile browsers, and fullscreen/PiP support is spotty; `useBatteryAware` uses the non-standard Battery API (absent on iOS/Firefox, guarded at `useBatteryAware.ts:13`).
- **Severity:** P2.
- **Fix:** treat mobile as client-only; feature-detect and hide unsupported controls.

### 7.5 PWA offline / stale cache
- **Trigger:** service worker serves cached responses.
- **Expected:** app shell cached; **dynamic API never cached**.
- **Current:** the SW is cache-first for **all** GET requests (`service-worker.js:24–37`, `return cached || fetched`). It caches any successful GET response, including the cross-origin **API GETs** — `/api/create-room` and `/api/validate-room` are `GET` (`api.ts:52–53`, `server.js:142, 151`). A cached `create-room` response means a **stale room code + hostToken can be replayed**, and `validate-room` can return stale status. This is a correctness/security defect, not just staleness.
- **Severity:** P1.
- **Fix:** network-only for `/api/*` (and any cross-origin) requests; scope the cache to same-origin static assets; version-bust on deploy.

### 7.6 Reconnect dead-end UX
- **Trigger:** 5 failed WS retries.
- **Expected:** actionable recovery.
- **Current:** shows "Connection lost. Please refresh to try again." and stops (`useWebRTC.ts:246–248`). Manual refresh only.
- **Severity:** P3.
- **Fix:** a "Retry" button that restarts signaling without a full reload.

---

## Prioritized Top-15 to fix first

| # | Issue | Cat | Sev | Anchor |
|---|-------|-----|-----|--------|
| 1 | **Multi-secondary unsupported on the frontend** — single `pcRef`/control/clipboard channel; can't serve 2+ secondaries | 1.8, 2.1 | **P0** | `useWebRTC.ts:40, 83–85` |
| 2 | **3rd+ peer never negotiates** — `ready` gated on exactly 2 peers; `joined`/`peer-joined` ignored | 1.8 | **P0** | `server.js:302`; `useWebRTC.ts:142–209` |
| 3 | **Per-secondary region streaming missing** — all clients get the same shared surface; spatial layout unwired | 2.1, 2.6 | **P0** | `useWebRTC.ts:79–85`; `DisplayControls.tsx:119–124` |
| 4 | **Per-monitor input mapping missing** — `monitor` never set; input hits whole virtual desktop | 2.5, 3.5 | **P0/P1** | `useHostInputRelay.ts:6–22`; `input-controller.js:181–188` |
| 5 | **`peer-disconnected` broadcast resets every client** — one leave nukes all sessions | 1.1, 2.4 | **P0 (multi)** | `server.js:324–332`; `useWebRTC.ts:203–208` |
| 6 | **No WS rate limiting on `input-inject`** — a joined client floods the host injector (DoS) | 6.2 | **P1** | `server.js:314–318` (limiter is HTTP-only `:60–67`) |
| 7 | **No input arbitration / mouse hijack** — any client injects; secondary mouse fights the host cursor | 3.1, 3.4 | **P1** | `server.js:314–318`; `input-controller.js:208–235` |
| 8 | **No TURN** — cross-NAT/firewall sessions fail with no relay | 1.5 | **P1** | `env.ts:12–20` |
| 9 | **Stuck keys/buttons on disconnect** — held inputs never released on the host | 3.2 | **P1** | (absent) `useWebRTC.ts:203–208` |
| 10 | **Service worker caches dynamic API GETs** — stale/replayed room code + hostToken | 7.5 | **P1** | `service-worker.js:24–37`; `api.ts:52–53` |
| 11 | **Room hard-expires at 30 min, silently** — no warning, no extension, no expiry notice | 1.6 | **P1** | `server.js:91`; `room-registry.js:203–212` |
| 12 | **File sharing entirely unimplemented** (product requirement) | 5.1, 5.2 | **P1** | (absent) |
| 13 | **Unauthenticated VDD/Bluetooth control** — any LAN origin triggers UAC install/topology change | 6.5 | **P1** | `server.js:165–245`; `idd-controller.js:11–13` |
| 14 | **Clipboard privacy + type gap** — whole clipboard auto-exfiltrated on every copy; text-only | 5.3, 5.4 | **P2** | `useClipboardSync.ts:14–38`; `App.tsx:64` |
| 15 | **Insecure-context & origin gaps** — HTTP LAN breaks capture/clipboard; `Origin: null` trusted; `.local` rejected; client battery-degrade is a no-op | 7.3, 6.4, 4.4 | **P2** | `env.ts:5–10`; `server.js:23`; `App.tsx:37, 46–52` |

---

### Cross-cutting recommendation

Items 1–5 are one project: refactor the host side of `useWebRTC` to a **per-peer
connection map** (a PC + control channel per `peerId`), drive negotiation from
`peer-joined`/`peer-left` with targeted `data.to` signaling (the registry
already supports this), and carry a per-secondary **region + monitor descriptor**
from the (currently decorative) `SpatialConfigurator` through to both the media
crop and the injector's `monitor` index. Until that lands, Telecastt is a solid
**single**-secondary mirror/extend tool, not the multi-surface product the
backend refactor and README promise.
