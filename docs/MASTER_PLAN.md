# Telecastt — Master Plan: From Web Prototype to Native App Store Product

> _"Screens unchained."_ — This document is the honest, engineering-grade roadmap for
> turning Telecastt from what it **is** today into what it **wants to be**: a native,
> cross-ecosystem second-screen + remote-control + continuity product on the App Store
> and Google Play.
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
do. To deliver the vision, the center of gravity must move from the browser to **two real
native surfaces**: a **desktop Host Agent** (runs in the background, captures at the OS
level, injects input at the OS level) and **native mobile clients** (real touch, real
on-screen keyboard, real system integration, App Store distribution).

---

## 1. Hard Truths & Constraints (so we design around reality, not against it)

These are the walls. We build doors, not dents.

1. **AirDrop is closed.** AirDrop is Apple-proprietary (AWDL + a private protocol). You
   **cannot** AirDrop between a Windows PC and an iPad. "AirDrop-level" is achievable — but
   as **our own** encrypted P2P transfer over the existing WebRTC data channel (+ optional
   local mDNS discovery), not by riding Apple's rails. We will match the *experience*, not
   the *mechanism*.
2. **iOS is a sandbox.** An iOS/iPadOS app **cannot** silently drive another device, run
   arbitrary background daemons, or reach into the filesystem freely. It can: capture touch,
   present an on-screen keyboard, use the Files/Share sheet, ReplayKit for its own screen,
   Multipeer Connectivity / Network.framework for local transport, and Universal Links. The
   iPad is a superb **client/controller**; it is a constrained **host**.
3. **WebRTC has a ceiling.** True 4K @ 120/144 Hz over WebRTC is bandwidth- and
   codec-bound. Realistic targets: **1080p60 effortlessly, 1440p60 on good LAN, 4K30–60 with
   hardware H.264/HEVC/AV1 and a strong link.** "4K144" is a marketing number, not a LAN
   guarantee. We negotiate capabilities and degrade gracefully instead of promising physics
   we can't deliver.
4. **Apple review scrutinizes remote-control / screen-mirroring apps.** Expect entitlement
   review, privacy-manifest requirements, and rejection risk for anything that looks like it
   controls another user's device without consent. Design consent + provenance in from day one.
5. **OS input injection is privileged everywhere.** Windows works via User32 (already done).
   macOS requires **Accessibility** + (for capture) **Screen Recording** permissions and is
   sandbox-hostile. Linux is split between **X11** (`XTest`) and **Wayland** (`libei`/portals).
   Each is a separate real implementation, not a flag.
6. **"Liquid Glass" (iOS 26) is a native material.** You get the real thing only in a native
   SwiftUI app on iOS 26+. On web you can *approximate* it (backdrop-filter, layered blur,
   specular highlights) but it will never be the system material. Honesty: native shell for
   the real look; web stays a beautiful approximation.

---

## 2. The Target Architecture

```
                        ┌───────────────────────────────────────────────┐
                        │             DESKTOP HOST AGENT                 │
                        │  (Windows / macOS / Linux — Rust core)         │
                        │  • OS screen capture (DXGI / ScreenCaptureKit  │
                        │    / PipeWire)                                 │
                        │  • HW encode (NVENC / VideoToolbox / VAAPI)    │
                        │  • OS input injection (User32 / CGEvent / libei)│
                        │  • Virtual display, clipboard, file endpoints  │
                        │  • Local mDNS advertise + secure pairing       │
                        └───────────────────┬───────────────────────────┘
                                            │  WebRTC (DTLS-SRTP) media + data
                          ┌─────────────────┼─────────────────┐
                          │        Signaling + TURN relay      │  (only when P2P fails)
                          │     (stateless, E2E-opaque)        │
                          └─────────────────┼─────────────────┘
       ┌────────────────────────┬───────────┴───────────┬────────────────────────┐
   ┌───▼──────────┐   ┌─────────▼─────────┐   ┌──────────▼────────┐   ┌───────────▼─────┐
   │ iOS / iPadOS │   │  Android (Kotlin  │   │  macOS / Windows  │   │  Web (PWA,      │
   │  (SwiftUI)   │   │   + Compose)      │   │   desktop client  │   │  fallback)      │
   │  real touch, │   │  real touch,      │   │  (Tauri/native)   │   │  no-install     │
   │  Pencil, OSK │   │  Material You     │   │                   │   │  demo path      │
   └──────────────┘   └───────────────────┘   └───────────────────┘   └─────────────────┘
```

**Key decisions (proposed, open for your approval):**
- **Host Agent core in Rust** — one portable core, thin per-OS shims for capture/inject.
  (Alternative: keep Node for orchestration, Rust/C++ only for the hot paths.)
- **Keep WebRTC as the transport** — it already gives us DTLS-SRTP encryption, NAT
  traversal, congestion control, and data channels for free. Add real **STUN + TURN**.
- **A shared wire protocol** (`packages/protocol`) — versioned, typed messages for input,
  clipboard, files, display, pairing — consumed by web, Swift (via codegen), and Kotlin.
- **Native shells own the "OS-level" magic**; the web app remains the zero-install fallback.

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

### PILLAR VI — Native Shells & Store Launch
_"An actual app on the App Store and Google Play." This is the productization pillar._

- **VI.1 — Protocol package.** Extract the wire protocol into `packages/protocol` with
  codegen for TS + Swift + Kotlin. One source of truth for every client. 🟡
- **VI.2 — iOS / iPadOS app (SwiftUI).** WebRTC (`libwebrtc`/`WebRTC.xcframework`), native
  touch + Pencil, on-screen keyboard, Files/Share integration, background/PiP where allowed,
  **iOS 26 Liquid Glass** materials. 🔴
- **VI.3 — Android app (Kotlin + Compose).** WebRTC, Material You / Material 3 Expressive,
  NSD discovery, Storage Access Framework for files, foreground-service transport. 🔴
- **VI.4 — Desktop Host Agent app.** Package the Rust core as a signed installer
  (Windows MSIX, macOS notarized `.pkg`, Linux AppImage/Flatpak); menubar/tray UX;
  auto-start; auto-update. 🔴🔒
- **VI.5 — Store compliance.** Privacy manifests (Apple), data-safety form (Google),
  age rating, export-compliance (encryption), screenshots, listing copy, entitlements. 🔒
- **VI.6 — Beta & release rails.** TestFlight + Play Internal Testing, staged rollout,
  crash/ANR reporting, phased release with kill-switch. 🟡
- **VI.7 — Submission & review.** Anticipate remote-control review scrutiny with a demo
  account, consent walkthrough, and clear "you control your own devices" framing. Submit,
  iterate on rejections, launch. 🔒🔴

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
4. **Weeks 8–14 — Pillar VI** native shells (iOS first — the iPad is the hero device),
   built on the extracted protocol package.
5. **Continuous — Pillar VII** design system + stress testing woven through every phase.

**Definition of done for "an app on the stores":** Pillar VI.7 green, which depends on
II (secure transport), III (real capture), IV (cross-OS control), and VII.4/VII.6
(accessibility + stress gates). Everything ladders to that.

---

## 5. The First Concrete Slice (proposed for immediate execution)

To respect this repo's "Plan First → approval → surgical execution" law, I'm **not** going
to sprawl a 40-file rewrite in one turn. I propose starting with a tight, high-value,
**ships-today-in-the-browser** slice that de-risks two of your seven asks:

- **Touch-Mode auto-detection + on-screen keyboard + touch marks** (Pillar IV.1/IV.2) — so
  an iPad controlling a PC feels like a tablet, not a mouse. Pure web, works on every OS now.
- **Cross-OS file transfer over the WebRTC data channel** (Pillar V.1) — the first real
  "AirDrop-level" capability, with chunking, progress, and integrity checks.

Both are additive, low-risk, fully testable, and directly visible. From there we climb the
critical path above.

---

## 6. Open Decisions (need your call)

1. **Host Agent language:** Rust core (recommended) vs. extend Node vs. C++?
2. **First native platform:** iOS/iPadOS first (recommended — it's your hero use case) vs.
   Android vs. desktop agent?
3. **TURN hosting:** self-host `coturn` vs. managed (Twilio/Cloudflare) for launch?
4. **Business/licensing:** stay MIT open-source, or dual-license for the store apps?
5. **Scope of v1 launch:** "second screen + remote control" only, or include file transfer
   in the first store release?

---

_This plan is a living document. It will be wrong in specifics and right in shape; we update
it as reality teaches us. Nothing here is too little — but everything here is real._
