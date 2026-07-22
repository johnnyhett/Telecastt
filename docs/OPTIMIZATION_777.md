# Telecastt — The 777: Optimization, Latency & Architecture

> A deep-tech roadmap for **latency, throughput, architecture, and innovative technologies** —
> web-first, PC-to-PC. Complements the product roadmap (`MASTER_PLAN.md`) and the grounded
> research (`OPTIMIZATION.md`). This is the *performance* charter.
>
> **On "777":** 7 Pillars × 7 Phases = 49 real improvements, sequenced. Each phase must move a
> measurable number (latency, bitrate, jank, join time) — no numerology padding, because
> inventing 777 trivial tasks would bury the ten that matter. **Last updated:** 2026-07-22.

**Legend:** 🟢 shippable in-browser now · 🟡 needs Host Companion / new infra · 🔴 hard / research ·
🧪 innovative / experimental · ✅ already shipped on this branch.

**North-star metric:** *motion-to-photon* — the milliseconds from a mouse move on a secondary
to the corresponding pixel changing on it. Everything below is judged against that number and
its p95, plus bitrate-per-quality and join-to-first-frame.

---

## PILLAR I — Transport & Protocol Spine
_Move bits with the least latency and overhead the browser allows._

- **I.1 — Split input into an unreliable, unordered lane.** Today the `control` channel is
  `ordered: true` (reliable) → head-of-line blocking under loss stalls the cursor. Send
  pointer-moves on an **unreliable/unordered** channel with sequence numbers + last-wins
  coalescing; keep key/button down-up on the reliable lane. 🟢
- **I.2 — WebTransport (HTTP/3 / QUIC) datagrams** as an alternate input/telemetry path where
  supported, with graceful fallback to data channels. QUIC's no-HOL datagrams suit real-time
  input. 🧪🟡
- **I.3 — SCTP tuning per stream** — distinct channels for input / clipboard / files with
  tuned `maxRetransmits` / `maxPacketLifeTime` (input: 0 retransmits; files: reliable). 🟢
- **I.4 — Binary signaling.** The repo already ships an unused `binary-protocol.js`; put it to
  work — compact binary framing over `wss://` shrinks signaling and speeds join. 🟢
- **I.5 — ICE fast-path.** Prioritize host/prflx candidates on LAN, treat TURN as last resort,
  tune `iceCandidatePoolSize`, and handle mDNS `.local` candidates so LAN pairs connect
  directly without a relay hop. 🟡
- **I.6 — Pre-warm the connection.** Gather ICE + build the offer *before* the secondary scans
  the QR, so join→first-frame collapses. 🟢
- **I.7 — Congestion feedback surfaced.** Expose transport-cc / GCC estimates to the app so the
  ABR controller (Pillar VI) reacts to the real send-rate ceiling. 🟡

---

## PILLAR II — Codec & Encoding
_Fewest bits per pixel of screen content, at the lowest encode latency._

- **II.1 — Codec preference ladder AV1→HEVC→VP9→H.264.** ✅ shipped. Next: runtime capability
  probe + per-link selection (a weak secondary may prefer HW-H.264 over SW-AV1).
- **II.2 — AV1 SVC / temporal layers** via `scalabilityMode` (e.g. `L1T3`), so a slow secondary
  drops a layer instead of dragging the whole mesh down. 🔴
- **II.3 — Screen-content-coding tuning.** `contentHint='text'` for terminals/docs vs `'detail'`
  for mixed; exploit palette / intra-block-copy where the encoder exposes it. 🟢
- **II.4 — Dirty-rectangle / delta encoding via Encoded Transforms** (insertable streams):
  transmit only changed regions of a mostly-static desktop — often a several-fold bitrate cut. 🧪🔴
- **II.5 — WebCodecs custom pipeline.** Drive `VideoEncoder`/`VideoDecoder` directly with
  hardware accel, low-latency mode, and explicit GOP control — bypassing the default WebRTC
  encoder when you need frame-level latency control. 🧪🔴
- **II.6 — Per-region encoding for the extended wall.** Encode each secondary's crop as its own
  lean stream instead of one full-desktop stream (ties to Pillar V.2). 🔴
- **II.7 — Adaptive keyframes.** On-demand PLI, long-term reference frames, keyframe only on
  scene change — kill the periodic-IDR bandwidth spikes on static screens. 🟡

---

## PILLAR III — The Latency Pipeline (motion-to-photon)
_Instrument it, then shave every millisecond._

- **III.1 — Measure motion-to-photon** with an on-screen test pattern + input timestamping;
  make it a first-class metric, not a guess. 🟢
- **III.2 — `requestVideoFrameCallback` render loop** — frame-accurate presentation, React fully
  off the video path. 🟢
- **III.3 — Adaptive jitter strategy.** Keep `jitterBufferTarget=0` on a clean LAN (the project's
  zero-latency law), but *sense* loss/jitter and let it breathe only when a link genuinely needs
  it — bounded and reversible. 🟡
- **III.4 — Input coalescing + prediction.** `getCoalescedEvents()`, emit at display cadence, and
  client-side predictive smoothing under loss. 🟢
- **III.5 — Zero-copy frame path.** Transferable `OffscreenCanvas`, `VideoFrame`→GPU texture with
  no CPU blit. 🟡
- **III.6 — Decode-to-display pacing** that avoids double-buffer stalls at high refresh. 🟡
- **III.7 — Cold-start latency** — pre-warmed PC (I.6) + forced fast first keyframe so the first
  frame lands in well under a second. 🟢

---

## PILLAR IV — Rendering, GPU & Display
_Put the GPU to work; keep hardware decode on._

- **IV.1 — WebGPU/WebGL compositor** for the client surface: GPU crop/scale each secondary's
  region (ties to extended display), no CPU blit. 🧪🟡
- **IV.2 — WebGPU compute post-processing** — text-aware sharpening / optional upscaling. 🧪🔴
- **IV.3 — Guard hardware decode** — avoid the `color-space` RTP extension and codec choices that
  silently drop Chrome onto software decode. 🟢
- **IV.4 — True high-refresh presentation** — align rVFC to a 120/144 Hz panel; avoid vsync
  mismatch stutter. 🟡
- **IV.5 — HDR / wide-gamut passthrough** (BT.2020) with tone-mapping fallback. 🔴
- **IV.6 — Per-secondary DPI/scale awareness** — crisp text on hi-DPI secondaries. 🟡
- **IV.7 — Optional AI upscaling** (WebGPU/WebNN) for low-bandwidth links — opt-in, measured. 🧪🔴

---

## PILLAR V — Scaling Architecture (1→N and beyond)
_From a LAN mesh to a tunable topology._

- **V.1 — Host mesh (`Map<peerId, RTCPeerConnection>`).** ✅ shipped. Next: **hybrid** — keep the
  mesh for LAN; add an optional self-hosted **SFU** (mediasoup/LiveKit) for many-viewer / WAN
  fan-out. 🔴
- **V.2 — Per-secondary region streams** — encode N crops rather than broadcasting the full
  desktop to everyone (bandwidth ∝ what each screen actually shows). 🔴
- **V.3 — Web Workers + WASM hot paths** — protocol codec, region math, hashing off the main
  thread. 🟡
- **V.4 — `SharedArrayBuffer` ring buffers** between worker and renderer for jank-free hand-off
  (requires cross-origin isolation headers). 🧪🟡
- **V.5 — Native capture Host Companion (Rust)** — DXGI / ScreenCaptureKit / PipeWire + NVENC as
  an optional high-performance path beyond `getDisplayMedia`. 🔴
- **V.6 — Multi-virtual-display (IDD)** provisioning for *true* OS extension — N virtual monitors,
  one per secondary. 🔴🟡
- **V.7 — Role-aware degradation** — viewer vs controller; a weak secondary drops an SVC layer
  (II.2) instead of stalling the group. 🟡

---

## PILLAR VI — Adaptive Intelligence
_The stream should tune itself to the network, the content, and the device._

- **VI.1 — Network-sensing ABR 2.0** — an RTT/loss/queue-depth controller per link, replacing the
  battery-only governor. 🟡
- **VI.2 — Content-aware encoding** — detect static vs. scrolling/video regions and spend bitrate
  where motion actually is. 🔴
- **VI.3 — Device-pressure adaptation** — the Compute Pressure API + Battery + Device Memory drive
  quality on constrained secondaries. 🧪🟢
- **VI.4 — Client→host quality requests** over the data channel — fixes today's no-op where a
  client's battery-degrade never reaches the host encoder. 🟢
- **VI.5 — Predictive input & frame reprojection** under loss (client-side extrapolation). 🔴
- **VI.6 — Fair bandwidth budgeting** across the mesh so the host splits the uplink sensibly among
  secondaries. 🟡
- **VI.7 — On-device ML (WebNN)** for scene-change detection / bitrate prediction — innovative,
  always measured against the simple heuristic before it ships. 🧪🔴

---

## PILLAR VII — Measurement, Observability & Regression Gates
_You cannot optimize what you don't measure — and you must not let it regress._

- **VII.1 — Perf telemetry pipeline** — per-session latency/fps/bitrate/loss/jitter to a local
  dashboard, opt-in export. 🟢
- **VII.2 — Automated latency harness** — headless Chromium (Playwright) measures motion-to-photon
  on every change. 🟡
- **VII.3 — Network chaos matrix** — `tc`/toxiproxy loss/jitter/reorder/NAT profiles as a gate. 🟡
- **VII.4 — A/B experiment framework** — codec/transport/jitter strategies compared on real
  metrics, not vibes. 🟡
- **VII.5 — Regression budget** — CI fails if p95 motion-to-photon or bitrate-per-quality
  regresses past a threshold. 🟡
- **VII.6 — Opt-in real-user monitoring** to catch field issues the lab misses. 🟡
- **VII.7 — Frame-pipeline tracing** — Chrome tracing + WebCodecs timing flamegraphs to locate
  stalls. 🟢

---

## Highest-leverage first (impact ÷ effort)

1. **I.1 unreliable input lane** + **III.4 coalescing/prediction** — biggest felt-latency win, pure web. 🟢
2. **III.1 motion-to-photon instrumentation** — so every later change is provable, not guessed. 🟢
3. **VI.4 client→host quality requests** + **VI.1 network-sensing ABR** — the stream finally adapts. 🟡
4. **II.4 dirty-rectangle encoding (Encoded Transforms)** — several-fold bitrate cut on desktops. 🧪🔴
5. **V.2 per-region streams** — the architecture that makes the extended wall cheap at scale. 🔴

**Innovative bets worth prototyping:** WebTransport datagrams (I.2), WebCodecs custom pipeline
(II.5), WebGPU compositor + upscaling (IV.1/IV.2/IV.7), and WebNN adaptation (VI.7). Each is
gated behind a measurement (Pillar VII) so we adopt it only when the number moves.

_Sequencing rule: never optimize blind. Land Pillar VII.1–VII.2 early so every other phase ships
with a before/after motion-to-photon number attached._
