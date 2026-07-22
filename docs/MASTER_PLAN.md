# Telecastt — Master Plan: A Web App on Steroids

> _"Screens unchained."_ — This document is the honest, engineering-grade roadmap for
> turning Telecastt from what it **is** today into what it **wants to be**: the most
> capable **web-based** cross-ecosystem second-screen + remote-control + continuity
> product possible — installable as a PWA, no App Store gatekeepers, running on every
> device that has a modern browser.
>
> **Direction (decided):** Web-first, **PC ↔ PC first**. The primary use case is two (or
> more) **desktop/laptop computers** working as one — one PC's screen extended or mirrored
> onto another, controlled with the second PC's own mouse and keyboard, with files and
> clipboard flowing between them. Phones/tablets are a later nice-to-have, not the focus.
> We are **not** shipping native store apps; we push the browser to its limits and package
> as an installable PWA. The only non-browser piece is the tiny local **Host Companion**
> server (already in `backend/`) that performs OS-level input injection on the host PC.
>
> **Status:** Planning. **Last updated:** 2026-07-22. **Owner:** @johnnyhett

---

## 0. Ground Truth (read this first)

A plan that lies about the starting point produces a schedule that lies about the finish
line. So, precisely what exists **today**:

| Layer | Reality today | Not yet true |
| :-- | :-- | :-- |
| **Client** | React + TypeScript + Vite **web app** running in a browser tab | No native iOS/iPadOS/Android app; no App Store presence |
| **Host** | A **browser tab** capturing the screen via `getDisplayMedia()` | No background desktop agent; capture stops when the tab closes |
| **Transport** | WebRTC P2P (video track + reliable data channels), Node/`ws` signaling on `:3001` | No STUN/TURN configured for real-world NAT; LAN-only in practice |
| **Input** | Client → data channel → host tab → server → **Windows-only** PowerShell (`InjectTouchInput`, `SetCursorPos`, `keybd_event`) | No macOS or Linux injection; no on-screen keyboard; no touch-mode auto-switch |
| **Files** | **Text clipboard only**, over a data channel | No file/folder transfer; no drag-and-drop; no rich clipboard (images) |
| **Display control** | Windows PowerShell scripts for VDD + `displayswitch.exe` + Bluetooth PAN | Windows-only; no real resolution/refresh negotiation between peers |
| **"Native" C++** | `native/src/*.cpp` are **non-functional stubs** (`framebuffer-capture.cpp` stores `"Dummy data"`) | Nothing compiles/links them; they are aspirational sketches |
| **Security** | CSPRNG room codes, origin allow-list, per-IP rate limit, room TTL, payload clamping | No TLS by default, no end-to-end auth beyond room membership, no signed builds |
| **Legal** | README claims MIT | **No `LICENSE` file exists** |

**The single most important architectural truth:** the current product is a *browser
capability shim*. Every "OS-level" feature is bounded by what a browser tab is allowed to
do. The web-first bet is that a **modern browser is now enough** for the experience we
want — WebRTC, Screen Capture, Pointer Events, the File System Access API, the async
Clipboard, WebCodecs, Web Share, Wake Lock, and installable PWAs cover the overwhelming
majority of the vision. The two things a browser genuinely cannot do — inject input into
the host OS and provision a virtual display — stay in the **Host Companion** (the local
`backend/` server), which is still just "run a small program on the PC you want to
control." Client devices (iPad, phone, laptop) need **nothing installed** beyond opening a
URL or adding the PWA to their home screen.

---

## 1. Hard Truths & Constraints (so we design around reality, not against it)

These are the walls. We build doors, not dents.

1. **AirDrop is closed.** AirDrop is Apple-proprietary (AWDL + a private protocol). You
   **cannot** AirDrop between a Windows PC and an iPad. "AirDrop-level" is achievable — but
   as **our own** encrypted P2P transfer over the existing WebRTC data channel (+ optional
   local mDNS discovery), not by riding Apple's rails. We will match the *experience*, not
   the *mechanism*.
2. **The browser is a sandbox — and that's the whole game now.** A web client cannot read
   the filesystem silently, run background daemons, or grab OS input. It **can**: capture
   multi-touch and pen via Pointer Events, present our own on-screen keyboard, open files
   via the File System Access API / file picker, read-write the clipboard (with a user
   gesture), stream via WebRTC, and install as a full-screen PWA. Some APIs are Chromium-only
   (File System Access); Safari/Firefox get graceful fallbacks (download + upload). We design
   for the capability floor and progressively enhance.
3. **WebRTC has a ceiling.** True 4K @ 120/144 Hz over WebRTC is bandwidth- and
   codec-bound. Realistic targets: **1080p60 effortlessly, 1440p60 on good LAN, 4K30–60 with
   hardware H.264/HEVC/AV1 and a strong link.** "4K144" is a marketing number, not a LAN
   guarantee. We negotiate capabilities and degrade gracefully instead of promising physics
   we can't deliver.
4. **No App Store means no gatekeeper — but also no store trust signals.** We win on
   zero-install and instant updates; we must earn trust ourselves via HTTPS, a clear consent
   model, and a visible "someone is controlling this PC" indicator on the host. Distribution
   is a URL + "Add to Home Screen," not a review queue.
5. **OS input injection is privileged everywhere.** This lives in the Host Companion, not the
   browser. Windows works via User32 (already done). macOS requires **Accessibility** + (for
   capture) **Screen Recording** permissions. Linux splits between **X11** (`XTest`) and
   **Wayland** (`libei`/portals). Each host OS is a separate real implementation in the
   companion, not a flag.
6. **"Liquid Glass" (iOS 26) is a native material we can only *approximate* on web** — and
   that approximation can be gorgeous. Layered `backdrop-filter`, specular edge highlights,
   depth, and spring motion get us most of the way. We commit to a best-in-class web glass
   system rather than pretending to be the OS material.

---

## 2. The Target Architecture

```
                        ┌───────────────────────────────────────────────┐
                        │        HOST COMPANION  (host PC only)          │
                        │  Node core today → Windows / macOS / Linux     │
                        │  • Serves the web app (host role)              │
                        │  • Screen capture via browser getDisplayMedia  │
                        │    (native capture optional, later)            │
                        │  • OS input injection (User32 / CGEvent / libei)│
                        │  • Virtual display, clipboard, file endpoints  │
                        └───────────────────┬───────────────────────────┘
                                            │  WebRTC (DTLS-SRTP) media + data
                          ┌─────────────────┼─────────────────┐
                          │        Signaling + TURN relay      │  (only when P2P fails)
                          │     (stateless, E2E-opaque)        │
                          └─────────────────┼─────────────────┘
       ┌────────────────────────┬───────────┴───────────┬────────────────────────┐
   ┌───▼──────────┐   ┌─────────▼─────────┐   ┌──────────▼────────┐   ┌───────────▼─────┐
   │  iPad / iOS  │   │      Android      │   │  macOS / Windows  │   │   Smart TV /    │
   │   (Safari    │   │   (Chrome PWA)    │   │   laptop browser  │   │   any browser   │
   │    PWA)      │   │                   │   │                   │   │                 │
   │  ONE web app — installable, no store, real touch + OSK, files, clipboard         │
   └──────────────┴───────────────────────┴───────────────────────┴─────────────────┘
```

Every client is the **same web app** — one codebase, installable as a PWA, zero store
friction. The Host Companion is the only thing anyone installs, and only on the PC being
controlled.

**Key decisions (proposed, open for your approval):**
- **Keep WebRTC as the transport** — DTLS-SRTP encryption, NAT traversal, congestion
  control, and data channels for free. Add real **STUN + TURN**.
- **Installable PWA** — service worker, web app manifest, offline shell, home-screen install,
  full-screen standalone display.
- **A typed wire protocol** (`frontend/src/lib/protocol` or a shared package) — versioned
  messages for input, clipboard, files, display, pairing. One source of truth for host + client.
- **Progressive enhancement** — Chromium-only APIs (File System Access) enhance the
  experience; Safari/Firefox get functional fallbacks so nothing hard-breaks.

---

## 3. The 777 Roadmap

You asked for a "777-phase" plan. Here is the honest interpretation, and why:

Literally inventing 777 discrete tasks would manufacture make-work and bury the ten things
that actually matter — which directly violates this repo's own charter (`GEMINI.md`:
_"I do not rush… I am immaculate… structural integrity over fast completion"_). Padding a
plan to hit a numerology target is the opposite of immaculate.

So **777 = 7 Pillars × 7 Phases**, each phase carrying a focused cluster of real work
(≈7 where warranted). Forty-nine phases, sequenced foundation → GA. Every phase must
**improve something real and shippable** — your rule, honored literally. Trivia is folded
into the phase it belongs to instead of being spun into filler.

**Legend:** 🟢 achievable now · 🟡 needs native shell / new infra · 🔴 hard / research · 🔒 security-gated

---

### PILLAR I — Foundation & Truth
_Make the thing we already have correct, honest, tested, and safe before we build on it._

- **I.1 — Repo hygiene & honesty.** Add real `LICENSE` (MIT, per README claim). Reconcile
  README claims with reality (mark native C++ as "experimental sketches"). Add
  `CONTRIBUTING.md`, `SECURITY.md`, issue/PR templates. 🟢
- **I.2 — CI/CD spine.** GitHub Actions: `tsc --noEmit`, oxlint, backend unit tests,
  `npm audit`, format check on every PR. No merge without green. 🟢
- **I.3 — Test coverage floor.** Expand `backend/test` (rooms, rate limit, sanitizer, TTL
  sweeper) + add frontend hook tests (Vitest) for `useWebRTC` state machine. Target ≥70%
  on core modules. 🟢
- **I.4 — Config & secrets.** `.env` scaffolding, typed config loader, no hardcoded ports,
  ICE server config surfaced. 🟢
- **I.5 — Observability.** Structured logging (pino), request IDs, a `/healthz` and
  `/metrics` endpoint, opt-in anonymous error reporting. 🟢
- **I.6 — Deterministic builds & versioning.** Lockfile CI, SemVer, `CHANGELOG.md`,
  reproducible build manifest (the `build-deterministic.ps1` idea, made cross-platform). 🟢
- **I.7 — Cross-platform dev harness.** `docker-compose` for signaling + TURN; make the
  Windows-only assumptions explicit and guarded so the server runs cleanly on macOS/Linux
  for development. 🟢

---

### PILLAR II — The Transport Spine
_Connections that survive the real internet, real NAT, and hostile networks._

- **II.1 — STUN/TURN.** Stand up `coturn` (or hosted), wire ICE config end-to-end,
  document self-host. Without this, P2P fails across most real networks. 🟡🔒
- **II.2 — Signaling hardening.** Move signaling to WSS (TLS), add per-socket auth tokens,
  message schema validation, and back-pressure. 🔒
- **II.3 — Session & pairing model.** Replace "6-char room" with a proper session: short
  code **for humans** + strong pairing secret **for machines**; SPAKE2/PAKE-style mutual
  auth so a leaked room code alone can't drive your PC. 🔒🔴
- **II.4 — Reconnection & roaming.** Graceful ICE restart, network-change survival
  (Wi-Fi ↔ cellular), resumable sessions with the same pairing. 🟡
- **II.5 — Multi-device rooms.** Lift the hard 2-peer cap into an explicit topology
  (1 host → N viewers; roles: controller vs. viewer). 🟡
- **II.6 — E2E trust.** Verify DTLS fingerprints out-of-band via the pairing channel;
  show a "verified" state so users know the pipe isn't MITM'd. 🔒🔴
- **II.7 — Transport telemetry.** RTT, loss, jitter, chosen candidate type (host/srflx/relay)
  surfaced in-app for diagnosis and adaptive decisions. 🟡

---

### PILLAR III — Pixels: Capture, Codec & Display
_Real screens, real resolutions, real refresh rates — negotiated, not promised._

- **III.1 — Native host capture.** Desktop Host Agent captures at the OS layer: DXGI
  Desktop Duplication (Win), ScreenCaptureKit (macOS 14+), PipeWire (Linux/Wayland).
  Frees us from the browser tab's limits. 🟡🔴
- **III.2 — Hardware encode.** NVENC / AMF / QuickSync / VideoToolbox / VAAPI with
  software fallback; per-frame keyframe control for fast recovery. 🔴
- **III.3 — Capability negotiation.** Peers exchange supported resolutions/refresh/codecs
  (H.264 → HEVC → AV1) and pick the best both can do. This is how "full resolutions and
  refresh rates" becomes real instead of aspirational. 🟡
- **III.4 — Adaptive bitrate 2.0.** Replace the battery-only governor with a controller
  driven by RTT/loss/queue depth + battery + thermal state. 🟡
- **III.5 — Virtual display, done right.** Ship/bundle a signed Indirect Display Driver on
  Windows; investigate BetterDisplay-style virtual displays on macOS. True "extend" mode
  with correct DPI/scaling. 🔴🔒
- **III.6 — HDR & color.** Color-accurate path (BT.709/2020), optional HDR passthrough
  where the codec + both displays support it. 🔴
- **III.7 — Per-monitor & region streaming.** Choose which monitor/region to send;
  crop/letterbox correctly; hi-DPI aware coordinate mapping. 🟡

---

### PILLAR IV — Control: Touch, Keyboard & Pointer
_"Control my entire PC from the iPad by touch." Make it feel native on every OS._

- **IV.1 — Touchscreen auto-detect & mode switch.** Detect touch capability
  (`pointer: coarse`, `maxTouchPoints`, pointer events) and switch the client into
  **Touch Mode**: larger targets, touch marks/ripples, gesture affordances — on **all** OSs.
  Fully achievable in the web client today. 🟢
- **IV.2 — On-screen keyboard.** A first-class virtual keyboard overlay (letters, numbers,
  modifiers, arrows, function row, OS/Cmd key) that injects to the host — essential for
  iPad-as-controller. Native shells use the system keyboard where possible. 🟢🟡
- **IV.3 — Gesture language.** Tap = click, two-finger scroll, pinch-zoom passthrough,
  three-finger swipe = app switch, long-press = right-click, trackpad-mode (relative)
  vs. touch-mode (absolute). 🟡
- **IV.4 — macOS injection.** `CGEventPost` for mouse/keyboard behind the Accessibility
  permission; the macOS half of parity. 🔴🔒
- **IV.5 — Linux injection.** X11 `XTest` + Wayland `libei`/portal path. 🔴🔒
- **IV.6 — Pencil / stylus & precision.** Pressure + tilt passthrough (Apple Pencil,
  S-Pen) for drawing apps; sub-pixel pointer precision. 🟡🔴
- **IV.7 — Input safety & latency.** Coalesce/interpolate moves, predict under loss,
  hard "release all inputs" panic key, and a **consent/attention indicator on the host**
  whenever remote input is active. 🟢🔒

---

### PILLAR V — Continuity: Files, Folders & Clipboard
_The "AirDrop-level" pillar — our own encrypted equivalent that actually crosses ecosystems._

- **V.1 — File transfer over data channel.** Chunked, back-pressured, resumable file
  send/receive over a dedicated reliable data channel, with integrity hashing and progress.
  Works Windows↔iPad↔Android↔Mac today because it rides our own P2P pipe. 🟢
- **V.2 — Drag-and-drop & Share Sheet.** Drag files onto the video to send to the host;
  drag from host to client; integrate the iOS/Android system Share Sheet in native shells. 🟡
- **V.3 — Folder & multi-file.** Directory trees, batching, conflict handling, mid-flight
  cancel/resume. 🟡
- **V.4 — Rich clipboard.** Extend text-only sync to images, files, and HTML, with a
  format-negotiation handshake and size guards. 🟢
- **V.5 — Local discovery.** mDNS/Bonjour + Multipeer (iOS) / NSD (Android) so nearby
  devices appear automatically — the "it just knows my iPad is here" moment. 🟡🔴
- **V.6 — Transfer security.** Per-file consent prompts, sender identity display, malware
  hooks/opt-in scanning, and a transfer log. AirDrop's "who is this from?" done right. 🔒
- **V.7 — Continuity UX.** A unified "Nearby / Sent / Received" surface; universal
  clipboard toast; "handoff" of the current context between devices. 🟡

---

### PILLAR VI — PWA & Web-Native Superpowers
_"An actual app" — without a store. Make the web app installable, offline-capable, and as
close to native as the browser allows._

- **VI.1 — Typed protocol module.** Extract the wire protocol into one versioned, typed
  module consumed by both host and client roles. One source of truth for input, clipboard,
  files, display, pairing messages. 🟢
- **VI.2 — Installable PWA.** Real web app manifest (icons, theme color, `display:
  standalone`, orientation), upgrade the existing `service-worker.js` to a proper offline
  app-shell + versioned cache, and an "Add to Home Screen" prompt. 🟢
- **VI.3 — Deep web-platform integration.** File System Access API (open/save without
  round-trips on Chromium), Web Share + Share Target, `EyeDropper`, Wake Lock (already
  present), Screen Orientation lock, `navigator.clipboard` rich types, Badging API. Each with
  a graceful fallback. 🟢🟡
- **VI.4 — Host Companion packaging.** Turn `backend/` into a one-click installer per OS
  (Windows service/tray, macOS `launchd` helper, Linux systemd) with auto-start and
  self-update — so "run it on the PC you want to control" is frictionless. 🟡🔒
- **VI.5 — HTTPS & trust.** Ship TLS by default (self-signed CA for LAN or an automated cert
  flow) so Screen Capture, Clipboard, and PWA install all work — many of these APIs require a
  secure context. 🔒
- **VI.6 — Cross-browser matrix.** Verified support tiers for Chrome/Edge, Safari
  (iOS/macOS), Firefox; feature-detect and degrade; a public compatibility table. 🟢
- **VI.7 — Update & telemetry rails.** Versioned releases, in-app "update available" prompt
  driven by the service worker, opt-in crash/usage telemetry, staged rollout via cache
  versioning. 🟢

---

### PILLAR VII — Soul: Design, Delight & Resilience
_"The most beautiful UI/UX known to man" — and the stress-testing that keeps it standing._

- **VII.1 — Design system.** Formalize tokens (the existing `theme.css` is a strong start)
  into a documented system: color, type scale, spacing, motion (`cubic-bezier` springs),
  elevation, glass materials — shared across web + native intent. 🟢
- **VII.2 — Liquid Glass / Material You dialects.** Web = layered specular glass
  approximation; iOS = real Liquid Glass; Android = Material You dynamic color. One soul,
  three native accents. 🟡
- **VII.3 — Onboarding & first-run.** A 60-second "pair your first screen" flow with QR,
  nearby-discovery, and a guided permission walkthrough per OS. 🟢
- **VII.4 — Accessibility.** WCAG AA, full keyboard nav, VoiceOver/TalkBack labels,
  reduced-motion, dynamic type, high-contrast. Non-negotiable for store quality. 🟢
- **VII.5 — Internationalization.** Externalize strings, RTL support, locale-aware
  formatting. 🟢
- **VII.6 — Stress & chaos testing.** Your point 5, made concrete: automated soak tests
  (24h sessions), network chaos (loss/jitter/NAT flips via `tc`/toxiproxy), fuzz the input
  sanitizer & protocol decoder, multi-device matrix, thermal/battery extremes, reconnection
  storms. A documented **use-case matrix** with a pass/fail gate. 🟡🔴
- **VII.7 — Polish & motion.** Micro-interactions, haptics (native), empty/loading/error
  states designed with the same care as the happy path, 60fps everywhere. 🟢

---

## 4. Sequencing (what actually happens, in order)

The pillars are parallel tracks; here's the honest critical path:

1. **Weeks 1–2 — Pillar I** (truth, tests, CI, LICENSE) + **IV.1/IV.2** (touch-mode +
   on-screen keyboard in the web client — visible wins that work today).
2. **Weeks 3–5 — Pillar II** (STUN/TURN, WSS, real pairing) + **V.1/V.4** (file transfer +
   rich clipboard — the "AirDrop-level" experience, browser-to-browser first).
3. **Weeks 6–10 — Pillar III** (native Host Agent capture core in Rust) + **III.3**
   (capability negotiation for real resolution/refresh).
4. **Weeks 8–12 — Pillar VI** PWA hardening (installable, offline, HTTPS, deep web APIs) +
   **VI.4** Host Companion one-click installers.
5. **Continuous — Pillar VII** design system + stress testing woven through every phase.

**Definition of done for "an app on steroids":** an installable PWA that works across the
browser matrix (VI.2/VI.6), over the real internet (Pillar II), with cross-OS control
(Pillar IV) and AirDrop-equivalent transfer (Pillar V), meeting the accessibility + stress
gates (VII.4/VII.6). Everything ladders to that.

---

## 5. The First Concrete Slice (PC ↔ PC)

To respect this repo's "Plan First → approval → surgical execution" law, we advance in tight,
verifiable increments rather than a 40-file rewrite. The PC-to-PC path:

1. **Multi-peer foundation (Pillar II.5).** Lift the hard 2-peer room cap into a real
   topology: **one host PC → N client PCs**, with per-peer addressed signaling (each message
   carries a target peer id instead of being broadcast to "the other one"). Backward-compatible
   and fully unit-testable on the server before any UI change. _This is the first step and the
   thing that makes "two or more PCs" literally true._
2. **Host multi-connection UI.** The host command center shows every connected PC, each with
   its own display mode (extend / duplicate / second-screen) and live telemetry.
3. **PC control polish.** The second PC already drives the host with its own mouse + physical
   keyboard today; harden cursor precision, multi-monitor coordinate mapping, and a relative
   "trackpad" mode.
4. **Continuity across PCs (Pillar V).** File/folder transfer + rich clipboard over the data
   channel — the cross-machine "AirDrop-equivalent," PC-to-PC first.

### Progress log (this branch)

Shipped and verified (backend suite 16/16 green; frontend `tsc` + `oxlint` clean):

- ✅ **Multi-peer signaling core** — `backend/lib/room-registry.js`: a WebSocket-agnostic,
  unit-tested (`test/room-registry.test.js`, 11 tests) room/peer manager supporting one host
  → N clients with per-peer **addressed** routing (`data.to` / `from`), replacing the hard
  2-peer broadcast model. `server.js` refactored onto it; cap raised to a configurable
  `MAX_PEERS_PER_ROOM` (default 8).
- ✅ **Host mesh (frontend)** — `useWebRTC.ts` now manages a `Map<peerId, RTCPeerConnection>`,
  one connection per secondary PC: offers addressed per peer, routes answers/ICE by `from`,
  tears down per-peer on `peer-left` (one secondary leaving no longer disturbs the others).
  Per-secondary input relay + clipboard via `lib/peer-io.ts`; `HostView` shows the live
  connected-secondary count. The single-secondary case is the exact N=1 slice.
- ✅ **Host authentication** — the host now proves itself with the room token on join;
  reconnecting hosts evict their own stale socket instead of being locked out.
- ✅ **Codec preferences** — host prefers AV1 → HEVC → VP9 for screen content (bitrate win).
- ✅ **Input dock bug fix** — clicking the floating control dock no longer injects a phantom
  click onto the host (`[data-tc-ui]` events are ignored by the capture surface).
- ✅ **Project hygiene** — added the missing MIT `LICENSE`; aligned `backend` license.
- ✅ **Research** — `docs/OPTIMIZATION.md` (streaming/codec/latency), plus a use-case matrix
  and security audit (in progress via analysis agents).

**The next step — extended-display regions.** With the mesh in place, every secondary now
receives the host stream and (today) shows the whole surface — i.e. a mirror wall. To make it a
true *extended* wall where each secondary shows a **different region**, the host assigns each
peer a rectangle of the (virtual) desktop and the secondary crops to it client-side; the
decorative `SpatialConfigurator` gets wired to drive those assignments, and per-region input
coordinate mapping populates the injector's `monitor` index. True OS-level extension across
machines still requires N virtual displays on the host via the IDD Companion (Windows), as
documented in `docs/OPTIMIZATION.md §5`.

**Validation note.** The mesh compiles and lints clean, and its per-peer logic is identical to
the (browser-tested) single-secondary path — but the 2+ secondary behavior itself should be
validated on a real multi-PC setup. That's the highest-value thing to test next.

Also queued from the audit/use-case docs: TLS/`wss://` by default, an explicit host-approval
step before a secondary can control, longer room codes, and file transfer.

---

## 6. Open Decisions (need your call)

1. **Host Companion evolution:** keep the current Node server and harden it (fastest), or
   later rewrite the hot paths (capture/inject) in Rust for a real native host?
2. **TURN hosting:** self-host `coturn` vs. managed (Twilio/Cloudflare) for internet use?
3. **HTTPS-on-LAN strategy:** self-signed CA the user trusts once, an mkcert-style flow, or
   tunnel through a hosted origin? (Several web APIs require a secure context.)
4. **Licensing:** confirm MIT (add the missing `LICENSE`) or something else.
5. **v1 "steroids" scope:** which capabilities make the first polished release — remote
   control + touch, file transfer, rich clipboard, PWA install — all of it, or a subset?

---

_This plan is a living document. It will be wrong in specifics and right in shape; we update
it as reality teaches us. Nothing here is too little — but everything here is real._
