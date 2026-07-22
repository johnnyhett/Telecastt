<div align="center">
  <img src="assets/logo.png" alt="Telecastt Logo" width="160" style="border-radius: 20px; filter: drop-shadow(0 0 30px rgba(56, 189, 248, 0.4)); margin-bottom: 15px;" />

  <h1>TELECASTT</h1>
  <p><em>"Screens unchained — turn any spare computer into an extra screen for your main PC."</em></p>

  <p>
    <a href="#overview">Overview</a> &bull;
    <a href="#use-cases">Use cases</a> &bull;
    <a href="#what-it-does">Features</a> &bull;
    <a href="#architecture">Architecture</a> &bull;
    <a href="#quickstart">Quickstart</a> &bull;
    <a href="#development--testing">Development</a> &bull;
    <a href="#security">Security</a> &bull;
    <a href="#roadmap">Roadmap</a>
  </p>
</div>

---

## Overview

**Telecastt** turns one or more spare computers into extra screens for your main PC — in the
browser, across operating systems. Your **primary PC** shares its screen over WebRTC; each
**secondary PC** either **mirrors** the whole desktop or shows a **different tiled region** of
it (an extended wall), and can drive the host with its own mouse and keyboard. Quality adapts
per screen to each link, and the whole thing runs peer-to-peer on your LAN.

**Web-first:** a secondary needs nothing but a browser (and can be installed as a PWA). The
only thing you install is a small **host companion** on the PC you want to share — that's what
performs OS-level input injection and display provisioning.

> Telecastt is an active, honest work-in-progress. What works today is described below; what
> doesn't yet is called out just as plainly in [Honest scope](#honest-scope).

<!-- A short demo GIF lives here once recorded — see docs/DEMO.md for the storyboard.
     ![Telecastt demo](assets/demo.gif) -->

---

## Use cases

- **A second monitor, instantly.** Set a laptop beside your desktop, hit **Extend**, and the
  desktop spills onto it — no cables, no dock.
- **Reuse an old PC as a display.** Turn a spare machine into a dashboard, chat, or reference
  screen for your main rig.
- **Control from across the room.** Drive your desktop from a laptop on the couch — its own mouse
  and keyboard included.
- **Present without dongles.** Mirror your screen into any nearby computer's browser.
- **Cross-OS by default.** A secondary is just a browser, so a Mac or Linux laptop can be a screen
  for your Windows PC today (host companions for more OSes are on the roadmap).

---

## What it does

- 🖥️ **Multi-PC by design.** One primary → **N secondary PCs**, each its own peer connection
  (a mesh). Add or drop a screen without disturbing the others.
- 🧩 **Mirror or Extend.** Mirror the full desktop to every screen, or **Extend** — tile the
  desktop into a wall where each secondary shows a distinct region. One-click toggle on the host.
- 🕹️ **Remote control.** Drive the host from any secondary; input maps to the correct region and
  absolute position. Held keys/buttons are safely released if a secondary drops mid-action.
- 📶 **Adaptive quality.** Per-secondary bitrate/framerate that **senses the network** (RTT,
  jitter, received FPS) **and battery**, with the host **fair-sharing** its bitrate budget across
  all connected screens.
- ⚡ **Low-latency input.** Pointer moves ride a dedicated **unreliable** data channel (no
  head-of-line blocking under packet loss), are paced to the display refresh, and carry a live
  **RTT** readout in the on-stream telemetry.
- 📋 **Clipboard sync.** Text clipboard shared between host and secondaries.
- 🎞️ **Codec-smart.** Prefers modern screen-content codecs (**AV1 → HEVC → VP9**) to spend the
  fewest bits on a mostly-static desktop.
- 🔒 **Authenticated pairing.** CSPRNG room codes + QR join, an authenticated host, rate-limited
  signaling, **host-only** OS input injection, and token-gated device-control endpoints.

---

## Honest scope

Because trust matters more than hype:

| Area | Status |
| :-- | :-- |
| Multi-PC mesh, mirror/extend, remote control, adaptive quality, clipboard | ✅ Works today, in-browser, over LAN |
| OS input injection + virtual-display provisioning | 🪟 **Windows host companion** (Win32 `InjectTouchInput` / `SetCursorPos` / `keybd_event`); IDD virtual-display scripts are **experimental**. macOS/Linux injection is planned |
| Extend-mode tiling | ✅ Vertical-column auto-tiling; regions map to fill each screen (some aspect stretch). True OS-level extension across machines needs N virtual displays (planned) |
| Transport security | ⚠️ WebRTC media/data are DTLS-SRTP encrypted, but **signaling is plain `ws://` by default** on the LAN — TLS/`wss://` is on the roadmap |
| Cross-NAT / internet use | ⚠️ STUN only today; a **TURN** relay is needed for firewalled/WAN links (planned) |
| File transfer, rich (image) clipboard | 🚧 Not yet |
| Native mobile/desktop store apps | ❌ Not planned — this is a web-first PWA |

See [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md) and [`docs/OPTIMIZATION_777.md`](docs/OPTIMIZATION_777.md)
for the full roadmap, plus [`docs/USE_CASES.md`](docs/USE_CASES.md) and
[`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md) for the edge-case and security analyses.

---

## Architecture

```
                 ┌──────────────────────────────────────────────┐
                 │      PRIMARY PC (host + host companion)       │
                 │  • Browser: getDisplayMedia screen capture    │
                 │  • Node signaling server (:3001)              │
                 │  • Win32 input injection (host companion)     │
                 │  • Manages one connection per secondary       │
                 └───────────────────┬──────────────────────────┘
                                     │  WebRTC (DTLS-SRTP) video + data channels
        ┌────────────────────────────┼────────────────────────────┐
   ┌────▼──────────┐        ┌─────────▼────────┐         ┌──────────▼──────┐
   │  Secondary 1  │        │   Secondary 2    │   ...   │   Secondary N   │
   │ (any browser) │        │  (any browser)   │         │  (any browser)  │
   │ region + input│        │  region + input  │         │  region + input │
   └───────────────┘        └──────────────────┘         └─────────────────┘
```

- **Transport:** WebRTC — DTLS-SRTP media, reliable `control`/`clipboard` channels, and an
  unreliable `cursor` channel for low-latency pointer moves. Node + `ws` broker signaling.
- **Roles:** the host holds a `Map<peerId, RTCPeerConnection>`; each secondary is a single
  connection back to the host, addressed by peer id.
- **Adaptation:** secondaries send quality requests over their control channel; the host caps
  each sender independently and fair-shares the total bitrate budget.

### Project structure

```
telecastt/
├── backend/            # Node signaling server + Windows host companion
│   ├── server.js       #   Express + ws signaling, rate limiting, device APIs
│   ├── lib/            #   room-registry (multi-peer), input-controller, idd-controller, ...
│   └── test/           #   unit tests  (npm test)
├── frontend/           # React + TypeScript + Vite web app (both host & client roles)
│   └── src/
│       ├── hooks/      #   useWebRTC (the mesh), usePointerCapture, useDisplayCapture, ...
│       ├── components/ #   HostView, ClientView, VideoStage, ControlDock, ...
│       └── lib/        #   peer-io, api, types, env
├── scripts/            # Windows PowerShell helpers (virtual display, input, Bluetooth PAN)
├── docs/               # roadmaps, optimization, use-case matrix, security audit, demo
└── assets/             # brand logo
```

---

## Quickstart

You need the repo on your **primary PC** (Windows for input injection) and any device with a
browser as a **secondary**, on the same network.

**1. Start the host companion + signaling server**
```bash
cd backend
npm install
npm start          # signaling + input injection on port 3001
```

**2. Launch the web app**
```bash
cd frontend
npm install
npm run dev        # served with --host so other devices can reach it
```

**3. Host your screen**
- On the **primary PC**, open the app, click **Initialize Host**, and pick the screen/window to
  share. A room code + QR appear.

**4. Connect a secondary**
- On another PC, open `http://<PRIMARY-LAN-IP>:5173` (or scan the QR) and enter the code.
- Repeat for more secondaries.

**5. Mirror or Extend**
- In the host's **Display mode**, choose **Mirror** (all screens show the whole desktop) or
  **Extend** (the desktop tiles across your secondaries). Control the host from any secondary.

> Tip: several browser APIs (screen capture, clipboard) require a secure context. On the LAN,
> `localhost` is fine on the host; for secondaries, serve over HTTPS or use the host's IP as
> allowed by your browser. TLS-by-default is on the roadmap.

---

## Development & testing

Requirements: **Node 18+** (20 recommended). Install per package.

**Backend**
```bash
cd backend
npm install
npm test      # unit tests: binary protocol, rate limiter, room registry, input sanitizer
npm start     # signaling server + host companion (port 3001)
```

**Frontend**
```bash
cd frontend
npm install
npm run dev        # dev server (Vite, --host so other devices can reach it)
npm run build      # production build
npx tsc --noEmit   # type-check
npm run lint       # oxlint
```

Everything above passes clean. The backend tests run **cross-platform** — OS input injection
degrades gracefully when it can't spawn (e.g. off Windows), so you can develop and test the app
on any OS; only the actual OS-level injection needs a Windows host.

---

## Security

Telecastt injects OS input, so it treats authorization seriously:

- **Authenticated host** — the host proves itself with a per-room token on join; a reconnecting
  host reclaims its slot instead of being locked out.
- **Host-only injection** — only the authenticated host peer may drive OS input over the socket;
  a joined secondary cannot inject directly.
- **Rate-limited signaling** — per-connection message limits and per-IP throttling on join blunt
  flooding and room-code brute forcing.
- **Token-gated device control** — virtual-display / Bluetooth endpoints (incl. an elevated
  driver install) require the host token, closing drive-by CSRF.
- **Sanitized input** — every remote input payload is coerced to a fixed, allow-listed, clamped
  shape before it reaches the injector (no shell, no command injection).
- **Origin allow-list** — signaling accepts only same-machine / private-LAN origins.

Known gap: signaling is plain `ws://` on the LAN by default — see
[`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md) for the full audit and remediation plan
(TLS, host-approval consent, longer codes).

---

## Tech

| Component | Stack |
| :--- | :--- |
| **Frontend** | React 19, TypeScript, Vite, WebRTC, installable PWA |
| **Backend** | Node.js, Express, WebSocket (`ws`), token-bucket rate limiter |
| **Host companion** | Win32 User32 interop (`InjectTouchInput`, `SetCursorPos`, `keybd_event`) |
| **Transport** | WebRTC DTLS-SRTP media + data channels; STUN |

---

## Roadmap

Highlights (full plans in [`docs/`](docs/)):

- Extended-display: grid tiling, drag-to-arrange layouts, per-region input mapping to real monitors.
- Transport: TLS/`wss://` by default, TURN for cross-NAT, host-approval consent, longer codes.
- Continuity: file/folder transfer, rich (image) clipboard.
- Performance: motion-to-photon instrumentation, dirty-rectangle encoding, WebGPU compositor.
- Reach: macOS/Linux host companion.

---

## License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE).
