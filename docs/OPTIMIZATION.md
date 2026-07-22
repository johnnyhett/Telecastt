# Telecastt — Optimization Technologies & Improvements

> Engineering-grade research doc for the **web-first, PC-to-PC extended-display** direction:
> one primary PC's desktop extended across **two or more** secondary PCs, each secondary
> acting as an additional display that shows a **different region** of the extended desktop.
> Low latency and high resolution/refresh are the goals.
>
> **Scope note:** This is a research/recommendation document. It does **not** modify any
> source. Every recommendation is tied to what exists today in `frontend/` and `backend/`.
> Claims are grounded in 2025–2026 sources, cited inline as URLs.
>
> **Status:** Research complete. **Date:** 2026-07-22.

---

## 0. What exists today (the baseline we are optimizing)

Read the code before the theory. The current pipeline:

| Concern | Current implementation | File | Consequence for the new direction |
| :-- | :-- | :-- | :-- |
| Topology | Single `RTCPeerConnection`; host `addTrack`s one capture stream | `frontend/src/hooks/useWebRTC.ts` | One host → one stream → one client. No 1→N. |
| Signaling | Room hard-capped at **2 peers**; offer/answer/ICE **broadcast** to "the other" socket (no target peer id) | `backend/server.js` (`room.clients.size >= 2`, the relay loop) | Structurally blocks 3+ devices. Must be fixed first. |
| Capture | `getDisplayMedia` @ `{fps ideal 60/max 144, 3840×2160}`, `contentHint='detail'` | `frontend/src/hooks/useDisplayCapture.ts` | Good defaults. User picks the surface in the browser picker. |
| Latency tuning | `playoutDelayHint = 0` **and** `jitterBufferTarget = 0`, hardcoded in `ontrack` | `useWebRTC.ts` | Correct instinct, but permanent `0` is risky under real jitter (see §4). |
| Codec | **No** `setCodecPreferences` anywhere — whatever SDP negotiates (usually VP8/VP9/H.264) | — | Leaving compression efficiency on the table for screen content (see §2). |
| Bitrate/fps cap | `encodings[0].maxBitrate/maxFramerate` from `streamSettings` | `useWebRTC.ts` | Single-encoding; no simulcast/SVC. Fine for now. |
| Input relay | `relayInput()` sends over the **WebSocket signaling** channel, not the data channel | `useWebRTC.ts` → `backend/server.js` `input-inject` | Extra hop through the Node server; couples input to signaling uptime (see §4.6). |
| Rendering | Plain `<video autoplay playsInline muted>`; `srcObject` set imperatively | `frontend/src/components/VideoStage.tsx` | Already the low-latency path. Do **not** "upgrade" to canvas (see §6). |
| Virtual display | Windows IDD via PowerShell + `displayswitch.exe /extend\|/clone\|/external` | `backend/lib/idd-controller.js`, `server.js` | One virtual display, one topology switch. No per-secondary regions yet. |
| Layout UI | Drag-to-arrange `SpatialConfigurator` | `frontend/src/components/SpatialConfigurator.tsx` | Good UI groundwork for a multi-region extended desktop. |

The single most important fact: **the current signaling + peer model physically cannot do
"two or more secondary PCs."** Everything else in this document is secondary to lifting that
2-peer cap into an addressable 1→N topology.

---

## 1. Multi-peer streaming architecture (1 host → N clients, each a *different* region)

This is not classic broadcast. In a webinar, N viewers want the **same** stream, so an SFU is
an obvious win. Here each secondary PC wants a **different region** of the extended desktop.
That changes the math, so reason about it carefully.

### The three options

**(a) Full mesh — N peer connections from the host.**
The host opens one `RTCPeerConnection` per secondary and sends each a distinct video track
(the crop/region for that display). This is the smallest change from today's code: the host
already owns the offer/answer flow; you replicate it per peer.

- **Pros:** No new server component. True P2P, DTLS-SRTP end to end, lowest possible hop
  count on a LAN. Each region is independently encoded at its native resolution.
- **Cons:** The host encodes and paces **N independent streams**, each with its own encoder
  instance, ICE agent, DTLS session, and GCC congestion controller. Browser encoder count is
  limited and CPU/GPU-bound; 2–3 regions at 1440p60 is realistic on a strong host, but this
  does not scale gracefully and the host's uplink congestion control for the N streams is
  uncoordinated. Renegotiation and reconnection logic multiplies per peer.

**(b) SFU (mediasoup / LiveKit / Janus) — host publishes N tracks, server routes track *i* to client *i*.**
An SFU is a *selective forwarding* unit: it forwards chosen RTP packets to chosen
subscribers. It does **not** require every subscriber to get the same stream. The host
publishes N region-tracks **once** to the SFU; the SFU forwards region-track *i* to secondary
*i* only. The SFU reads layer/stream IDs and "forwards a subset per receiver," which is
exactly the different-region-per-client case
(https://www.digitalsamba.com/blog/svc-vs-simulcast-in-webrtc,
https://getstream.io/resources/projects/webrtc/architectures/sfu/).

- **Pros:** Host maintains **one** transport (one ICE/DTLS/GCC context), not N. Adding a 4th
  or 5th secondary costs the host almost nothing — the SFU fans out. Congestion control and
  reconnection are centralized and battle-tested. mediasoup reports 40–100 ms end-to-end and
  is the leanest option; a single worker handles hundreds of consumers
  (https://www.forasoft.com/learn/video-streaming/articles-streaming/sfu-comparison-mediasoup-janus-livekit-jitsi-pion,
  https://webrtc.ventures/2026/06/open-source-webrtc-media-servers/).
- **Cons:** A real server process to run, deploy, and secure — on a **LAN-first, self-hosted**
  product that today ships a tiny Node signaler, that is a meaningful operational jump. On a
  LAN it adds one hop (host → SFU → client) versus mesh's zero, i.e. a small, usually
  sub-millisecond, latency tax for a large scaling win. The SFU would naturally live **inside
  the Host Companion** (co-located on the primary PC) so the extra hop stays on localhost.
- **Which one:** LiveKit if you want batteries-included SDKs and clustering; **mediasoup** if
  you want a lean, embeddable C++/Node SFU you drive from the existing Node backend and you're
  willing to own more wiring. For Telecastt, mediasoup co-located in the Host Companion is the
  natural fit (same Node runtime as `backend/server.js`).

**(c) Simulcast / SVC.**
Simulcast (encode several resolution layers, SFU forwards the best per client) and SVC
(one layered stream, forward a subset of layers) solve a *different* problem: **one source,
heterogeneous receivers**. That is not the primary need here — each secondary wants a distinct
region, not a different quality of the same region. Simulcast becomes relevant only as a
**secondary** feature: e.g., a secondary on weak Wi-Fi drops to a lower spatial layer of its
own region, or a "mirror/duplicate" mode where several clients genuinely share one region.
For screen content, prefer **temporal** scalability (L1T2/L1T3) over spatial — "sharpness
trumps FPS" for text/UI
(https://www.forasoft.com/learn/video-streaming/articles-streaming/simulcast-svc-sfu).

### Recommendation

- **Phase 1 (now): addressable mesh.** Fix the signaling first — give every peer an id and
  route offer/answer/ICE to a **target** peer instead of broadcasting to "the other one"
  (`backend/server.js`). Then let the host hold a `Map<peerId, RTCPeerConnection>`, one region
  track per peer. This makes "two or more secondaries" literally true with **no new server
  component**, and matches the incremental path already written in `MASTER_PLAN.md` §5.
- **Phase 2 (when N > ~3 or CPU-bound): mediasoup SFU inside the Host Companion.** Move the
  fan-out off the host's browser encoders. Keep the same region-per-track model; the SFU just
  routes track *i* → client *i*. This is the scalable endgame and also unlocks recording,
  server-side transcode-to-fallback-codec, and coordinated congestion control.

The honest trade: mesh is the right **first** move (cheap, P2P, LAN-optimal); the SFU is the
right **second** move (scales past the host's encoder budget). Don't build the SFU until the
mesh's encoder/CPU ceiling is the actual bottleneck.

---

## 2. Codecs for screen content

Screen content (text, sharp edges, large flat regions, mostly-static frames with small
dirty rectangles) is a different beast from camera video. The codec choice matters more here
than almost anywhere else.

### The contenders (2025–2026 reality)

| Codec | Screen-content strength | Browser encode/decode (WebRTC) | Notes |
| :-- | :-- | :-- | :-- |
| **H.264** | Baseline; no dedicated screen tools | Universal HW encode+decode everywhere | The safe floor. Always negotiate as fallback. |
| **VP9** | Better than H.264; has some SCC tooling | SW encode broad; HW decode common | Solid middle ground; default in much of Chrome's stack. |
| **AV1** | **Best-in-class.** Dedicated Screen Content Coding (palette mode, intra block copy) | SW encode since Chrome M90 (tuned for low-bitrate RTC); HW **decode** now widespread; HW **encode** only on newer Intel Arc / Snapdragon | The screen-sharing codec. See numbers below. |
| **H.265/HEVC** | Strong; HW-accelerated | **New in 2025:** Chrome 136+ and Safari 18+ send/receive over WebRTC **when HW present**; **Edge does not send** | Good where AV1 HW encode is absent but HEVC HW encode exists (many Intel/NVIDIA/Apple GPUs). |

Sources: https://webrtc.ventures/2026/04/should-you-still-consider-av1-codec-in-your-webrtc-architecture/,
https://visionular.ai/av1-decoding-and-hardware-ecosystem-the-future-of-video-delivery/,
https://chromestatus.com/feature/5153479456456704,
https://learn.microsoft.com/en-us/answers/questions/5880331/h-265-hevc-not-published-sent-via-webrtc-chrome-su,
https://getstream.io/resources/projects/webrtc/advanced/codecs/.

### Why screen-content-coding tools matter

AV1's SCC tools (palette mode for limited-color UI regions, intra block copy for repeated
patterns like text glyphs and window chrome) are unique among shipping codecs. With SCC
enabled, screen content compresses to roughly the **100–500 kbps** range — a level no other
standard reaches for the same visual quality
(https://visionular.ai/av1-screen-content-coding/,
https://www.forasoft.com/learn/video-encoding/articles/av1-state-2026). For a mostly-static
extended desktop (documents, IDEs, dashboards), AV1 can cut bitrate several-fold versus H.264
at equal sharpness, which directly buys headroom for higher resolution/refresh on the same
link.

### Hardware encode is the catch

- **AV1 decode** in hardware is effectively ubiquitous on 2023+ silicon and every major
  browser plays it (https://www.forasoft.com/learn/video-encoding/articles/av1-state-2026).
- **AV1 encode** in hardware is still limited (newer Intel Arc, some Snapdragon). Chrome's
  **software** AV1 encoder is real and tuned for RTC, but software-encoding a 1440p60+ screen
  in real time costs meaningful CPU on the host — acceptable for one region, questionable for
  N regions in a browser tab.
- **HEVC encode** in hardware is broadly available (Intel QuickSync, NVIDIA NVENC, Apple
  VideoToolbox, AMD) — which is why HEVC is a pragmatic *hardware* alternative to AV1 on hosts
  that lack AV1 HW encode, now that Chrome 136+/Safari 18+ can send it.

### What WebRTC negotiates today, and what to do

Telecastt currently sets **no** codec preference, so it takes whatever the browsers agree on
(commonly VP8/VP9/H.264). Concrete move: call `setCodecPreferences()` /
`RTCRtpSender.setParameters()` on the video transceiver with an ordered preference:

```
AV1  →  H.265/HEVC (if both peers report HW)  →  VP9  →  H.264 (universal fallback)
```

Detect support with `RTCRtpSender.getCapabilities('video')` and negotiate per pair. On a host
without AV1/HEVC hardware encode, fall to VP9 rather than software-AV1 for N regions.

### Realistic resolution / refresh / bitrate expectations

Consistent with `MASTER_PLAN.md` §1.3, and honest about physics:

| Link | Realistic target (per region) | Notes |
| :-- | :-- | :-- |
| Gigabit **wired LAN** | 1440p60 comfortably; 4K60 with HW HEVC/AV1 | The sweet spot for this product. |
| Good **Wi-Fi 6 LAN** | 1080p60 effortless; 1440p60 with a strong AP | Jitter, not bandwidth, becomes the limiter (see §4). |
| **Internet** (via TURN) | 1080p30–60 | Bandwidth- and loss-bound; AV1 SCC helps most here. |
| Marketing "**4K144**" | Not a WebRTC LAN guarantee | Encoder throughput + link headroom rarely both hold. |

For *N* secondaries, divide the host's encode budget and uplink by N. Two 1440p60 regions is a
reasonable ceiling for browser-based host encode; more regions is the trigger to move to
native capture (§5) or an SFU (§1).

---

## 3. WebCodecs + WebTransport (custom pipeline) vs the standard WebRTC media stack

### What it is

Instead of `addTrack` + SRTP + the browser's jitter buffer, you build the pipeline yourself:
`getDisplayMedia` → `MediaStreamTrackProcessor` → **WebCodecs** `VideoEncoder` (hardware
accelerated) → your own framing → **WebTransport** (HTTP/3 / QUIC datagrams) or a raw
`RTCDataChannel` → `VideoDecoder` → paint. You own every buffer.

### The genuine upside

- **Lowest achievable pipeline latency.** With no negotiated jitter buffer and your own pacing,
  a minimal WebCodecs pipeline can be tuned into the single-digit-tens-of-ms range — lower than
  a conservatively-buffered WebRTC path
  (https://fsjs.dev/comparing-webcodecs-and-webrtc-which-should-you-choose/).
- **Total control** of keyframe cadence, per-frame QP, region/dirty-rect encoding, and
  transport reliability (partial reliability / unreliable datagrams for video, reliable for
  input).
- **WebTransport/QUIC** avoids head-of-line blocking across streams and scales fan-out better
  than P2P WebRTC if you later centralize
  (https://www.nanocosmos.net/blog/webrtc-latency/, and MoQ over QUIC matches WebRTC sub-second
  latency while scaling far past it).

### The honest downsides

- **You rebuild what WebRTC gives free:** congestion control (GCC), bandwidth estimation,
  NACK/retransmit, FEC, pacing, DTLS-SRTP encryption, and NAT traversal. Getting congestion
  control wrong means you either starve or flood the link — WebRTC's GCC is years of tuning you
  would be discarding.
- **WebTransport does not traverse NAT like ICE does.** It needs a reachable HTTP/3 server. On a
  LAN that's fine (the Host Companion is the server); across the internet you lose WebRTC's
  peer-to-peer hole punching.
- **A copy tax:** `getDisplayMedia` frames still originate from the browser compositor;
  WebCodecs adds an encode/decode you control but not necessarily a *faster* capture than the
  native WebRTC path, which can keep frames on the GPU.

### When it's worth it for Telecastt

- **Not yet, for the LAN WebRTC media path.** With `playoutDelayHint`/`jitterBufferTarget`
  already near zero and `contentHint='detail'` set, the standard stack is already close to the
  floor for LAN. Rebuilding congestion control to shave a few ms is poor ROI while the 2-peer
  cap (§1) and codec preference (§2) are unaddressed.
- **Yes, later, in two specific cases:** (1) the **input/control** path — a WebTransport or
  data-channel control plane with your own framing is a clean upgrade over relaying input
  through the signaling WebSocket (§4.6); (2) if Telecastt moves to a **native Host Agent**
  capturing via DXGI/ScreenCaptureKit (`MASTER_PLAN.md` III.1), WebCodecs-style framing pairs
  naturally with native hardware encode and per-region dirty-rect updates.

**Verdict:** Keep WebRTC media for now. Treat WebCodecs+WebTransport as the architecture you
graduate to *with* native capture, not as a near-term latency patch.

---

## 4. Latency reduction on the current WebRTC path

These are the cheap, high-value knobs — most are code-local to `useWebRTC.ts` and
`useDisplayCapture.ts`.

### 4.1 Jitter buffer / playout delay — refine the current `0`

Telecastt hardcodes `playoutDelayHint = 0` **and** `jitterBufferTarget = 0` on every receiver.
The instinct (prefer freshness over smoothness for an interactive display) is right, and
setting these to minimum is exactly how you strip decoder-side buffering
(https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpReceiver/jitterBufferTarget). **But**
the same practitioners who optimize browser remote-desktop warn that *forcing* the target to a
hard `0` continuously causes **stutter** when the buffer legitimately needs to grow to absorb a
jitter spike — you trade smoothness away even on frames where you didn't need to
(https://github.com/selkies-project/selkies/issues/157). Recommendation:

- On a **clean wired LAN**, `0` is fine — keep it.
- On **Wi-Fi / internet**, use a **small adaptive target** (e.g. start ~0, allow it to rise to
  tens of ms under measured jitter, decay back) rather than pinning `0`. Drive it from the
  jitter you already compute in the telemetry poller. This removes the "hard-zero stutter" case
  without giving up the low-latency default.

### 4.2 RTP header extensions (SDP munging or transceiver config)

From the same remote-desktop optimization work:

- **Enable** `transport-wide-cc` (GCC bandwidth estimation), `abs-send-time`, and the
  `playout-delay` extension. These make congestion control and latency hints actually function.
- **Avoid** the `color-space` RTP extension — it has been observed to **disable hardware
  decoding in Chrome** (https://github.com/selkies-project/selkies/issues/157). Free latency
  and CPU by not sending it.

### 4.3 NACK / PLI / FEC tuning

- **NACK** (retransmit lost packets) is on by default and worth keeping for screen content —
  a lost slice of text is very visible, and on a low-RTT LAN a retransmit arrives fast.
- **PLI/FIR** (picture-loss → keyframe request): keep, but see keyframe strategy below.
- **FEC** (forward error correction, e.g. ulpfec/flexfec) adds redundancy = bandwidth overhead
  and a little latency. On a **clean LAN it's mostly wasted**; enable it only on lossy Wi-Fi /
  internet legs. Don't blanket-enable.

### 4.4 Keyframe strategy

Screen content is mostly static with small dirty regions, so **keyframes are expensive and
rare-by-nature** — but a dropped keyframe stalls the whole picture until the next one. Strategy:

- Long GOP / infrequent scheduled keyframes (let the encoder send intra only on real scene
  change), **plus** fast PLI-driven keyframes on actual loss. Avoid periodic keyframe spam —
  it wastes the bitrate AV1/HEVC SCC just saved you.
- When a secondary reconnects or unfreezes, request an immediate keyframe (PLI) so it recovers
  in one RTT instead of waiting for the schedule.

### 4.5 Capture constraints & `contentHint`

- `contentHint='detail'` is already set — correct for mixed desktop content. Consider
  `'text'` for secondaries that are pure document/terminal regions (it biases the encoder even
  harder toward spatial sharpness over frame rate)
  (https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/contentHint).
- `frameRate: { ideal: 60, max: 144 }` is reasonable. For **mostly-static** regions, a lower
  *floor* isn't needed — screen encoders already send fewer frames when nothing changes;
  the `max:144` only matters for high-refresh regions actually doing motion (see §6).
- Keep `width/height { ideal:3840, max:3840 }` but remember the **user still picks the surface**
  in the browser picker — the constraint caps, it doesn't select (§5).

### 4.6 Move input off the signaling WebSocket onto the data channel

Today `relayInput()` sends `{type:'input-inject'}` over the **signaling WebSocket**, which the
Node server then hands to `inputController.injectInput` (`backend/server.js`). Two costs: an
extra hop through the server on every mouse move, and input that dies if the signaling socket
blips. The `control` **RTCDataChannel** already exists (created in `useWebRTC.ts`) but isn't
used for input. Moving input to that channel gives you **direct P2P input** (no server hop,
lower and more consistent latency) and decouples control from signaling. Coalesce mouse-move
events to the frame rate and keep the channel `ordered:true` (already the case). This is one of
the highest latency-per-effort wins available and touches only the client relay path plus one
host handler.

### 4.7 Congestion control & pacing

Leave **GCC** (Google Congestion Control) on — it's the reason WebRTC survives real links, and
rebuilding it (see §3) is a large project. Ensure `transport-wide-cc` is negotiated (§4.2) so
GCC has the feedback it needs. Don't set `maxBitrate` so low that the pacer starves a region,
nor so high that a burst of dirty frames floods a shared Wi-Fi AP serving all N secondaries.

---

## 5. Extended-display specifics — making each secondary show a distinct region

This is the crux of the new direction, and it's where **the browser genuinely can't do it
alone** — the Host Companion (or native code) is mandatory.

### The core browser constraint

A web page **cannot** pick which monitor/region to capture. `getDisplayMedia` always shows the
user a picker, and "the browser doesn't offer the option to pre-select a specific window or
screen by design"
(https://developer.chrome.com/docs/web-platform/screen-sharing-controls,
https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia). `monitorTypeSurfaces`
only hints whether whole-monitor options appear in the picker; it can't auto-select one. So the
browser can capture *a* display the user chose, but it cannot programmatically fan a desktop
into N regions.

### Two architectures for "each secondary = a different region"

**Architecture A — one large virtual desktop, each client crops.**
The host provisions **one** big virtual display (say 3840×2160 spanning the intended layout),
captures it once, and each secondary receives a **cropped** sub-rectangle. Cropping options:

- **Client-side crop:** send the whole frame to each secondary and crop with CSS
  `object-fit`/transform or a canvas draw. Simple, but you pay to transmit the full desktop to
  every client (bandwidth ∝ N × full-desktop), wasteful for large N.
- **Sender-side crop via Region Capture:** Chromium's Region Capture / `RestrictionTarget`
  can crop a captured surface to an element region, but it's tab/element-oriented, not an
  arbitrary "monitor sub-rect to a peer" primitive — a poor fit for arbitrary desktop regions.
- **Per-region tracks:** encode N crops on the host and send region *i* to client *i* (this is
  the region-per-track model from §1). Best bandwidth, most host encode cost.

**Architecture B — N virtual displays, one per secondary (recommended).**
The host provisions **N virtual displays** (one per secondary PC), lets the OS arrange them as
an extended desktop via the `SpatialConfigurator` layout, captures each independently, and
streams virtual-display *i* → secondary *i*. Each secondary gets a native-resolution,
natively-composited region; the OS does the "which window is on which display" work for free,
and the user drags real windows onto the secondary they want. This is the true "extend my
desktop across these PCs" experience.

### OS support for provisioning multiple virtual displays

- **Windows — solid.** The **Indirect Display Driver (IDD/IddCx)** model exists precisely for
  "virtual monitors not attached to a GPU output," and open-source drivers
  (`VirtualDrivers/Virtual-Display-Driver`, `IddSampleDriver`) support **multiple** hot-pluggable
  virtual monitors
  (https://learn.microsoft.com/en-us/windows-hardware/drivers/display/indirect-display-driver-model-overview,
  https://github.com/VirtualDrivers/Virtual-Display-Driver). Telecastt already ships single-VDD
  IDD control (`idd-controller.js`). The upgrade is: install a **signed** IDD that exposes **N**
  virtual monitors at chosen resolutions/refresh, one per secondary — a real but well-trodden
  path. Signing/driver-trust is the main friction (`MASTER_PLAN.md` III.5, 🔴🔒).
- **macOS — fragile.** Virtual displays exist via the **private** `CGVirtualDisplay`
  CoreGraphics API (used by BetterDisplay, `node-mac-virtual-display`). It works today but is
  unsanctioned and "Apple could change or remove it," and there are already
  macOS 26 (Tahoe) regressions in adjacent CoreGraphics display APIs
  (https://github.com/waydabber/betterdisplay,
  https://github.com/enfp-dev-studio/node-mac-virtual-display,
  https://betterdisplay.dev/). Treat macOS multi-virtual-display as best-effort, not a
  guarantee.
- **Linux — possible, fragmented.** Headless/virtual outputs via the DRM/KMS "writeback" or a
  virtual GPU, or an Xorg dummy driver / a PipeWire-fed virtual output on Wayland. Doable for a
  determined native agent; not a browser capability.

### What the browser *can* vs *cannot* do here — stated plainly

| Task | Browser alone | Needs Host Companion / native |
| :-- | :-- | :-- |
| Capture a surface the user picks | ✅ `getDisplayMedia` | — |
| Auto-select a specific monitor/region | ❌ (picker is mandatory) | ✅ native capture (DXGI/SCK/PipeWire) |
| Provision virtual displays | ❌ | ✅ IDD (Win) / CGVirtualDisplay (mac) / DRM (Linux) |
| Crop a received frame per client | ✅ (CSS/canvas) | — |
| Encode N region tracks efficiently | ⚠️ limited by browser encoders | ✅ native HW encode (NVENC/QSV/VT) |
| Inject mouse/keyboard into host OS | ❌ | ✅ (already: User32; later CGEvent/libei) |

**Bottom line:** the extended-display feature is fundamentally a **Host Companion** feature.
The browser renders and controls; provisioning the N displays and (ideally) capturing/encoding
them lives in the companion. On Windows this is a signed multi-monitor IDD; elsewhere it's
weaker and should be scoped honestly.

---

## 6. Frontend rendering performance

Good news: the current renderer is already the fast path. Don't regress it.

### `<video>` beats canvas for this workload

The plain `<video>` element in `VideoStage.tsx` hands decoded frames straight to the GPU
compositor — no JS in the per-frame path. Routing frames through `OffscreenCanvas`/WebGL
would **add** a decode→texture→draw round trip and at least one extra frame of latency, and
canvas processing is best-effort with no guarantee every frame is drawn
(https://web.dev/articles/requestvideoframecallback-rvfc). **Only** reach for
canvas/WebGL/WebGPU if you need per-pixel work the compositor can't do (client-side region
cropping with letterboxing, color transforms, overlays). For straight display, `<video>`
wins.

### `requestVideoFrameCallback` — use it for measurement, not for the render path

`video.requestVideoFrameCallback()` fires when a frame is actually presented and carries rich
metadata (presentation time, `presentedFrames`, expected display time)
(https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback).
Great for **accurate** fps/dropped-frame telemetry (better than the 1 Hz `getStats` poll in
`useWebRTC.ts`) and for input-to-photon measurement. It is **not** a lower-latency way to
paint — it runs on the main thread and can be a vsync late relative to actual compositing
(https://web.dev/articles/requestvideoframecallback-rvfc). Use it to *measure*, keep `<video>`
to *display*.

### Keep React off the video path (it already is — protect it)

`VideoStage` sets `srcObject` imperatively via a ref and never re-renders on frames — correct.
The one caveat is per-frame telemetry: don't push high-frequency stats into React state (that
re-renders the tree). The existing 1 Hz interval is fine; if you adopt rVFC telemetry, batch it
to ~1 Hz before it touches state, or keep it in a ref and read it on a timer.

### High-refresh (120/144 Hz) considerations

- The secondary's own panel refresh caps the *displayable* rate; there's no point encoding a
  region at 144 fps for a 60 Hz secondary. Negotiate the target fps to `min(source refresh,
  panel refresh, link headroom)`.
- `requestVideoFrameCallback` is clamped to the **lesser** of the video's rate and the browser's
  rate, so on a 144 Hz panel a 60 fps stream still only fires callbacks at 60
  (https://web.dev/articles/requestvideoframecallback-rvfc).
- The `desynchronized` canvas hint reduces latency **only** for the canvas path
  (https://developer.chrome.com/blog/desynchronized) — irrelevant while you stay on `<video>`.
- For genuinely high-motion high-refresh regions (gaming on a secondary), the encoder
  throughput and link (§2) are the ceiling, not the DOM.

---

## 7. Prioritized recommendations for Telecastt

Ranked by **(impact ÷ effort)** — do the top items first. "Impact" is latency/quality/scaling
gain; "Effort" is engineering cost given the current code.

| # | Recommendation | Impact | Effort | Where |
| :-- | :-- | :-- | :-- | :-- |
| 1 | **Addressable 1→N signaling.** Add per-peer ids; route offer/answer/ICE to a target peer; lift the 2-peer cap. Nothing else about "two or more secondaries" works until this ships. | 🟥 Critical (unblocks the whole direction) | Low–Med | `backend/server.js`, `useWebRTC.ts` |
| 2 | **Move input to the `control` data channel.** Direct P2P input, drop the server hop, decouple from signaling. | 🟧 High (input latency + robustness) | Low | `useWebRTC.ts` relay + host handler |
| 3 | **Set codec preferences: AV1 → HEVC(HW) → VP9 → H.264.** Feature-detect via `getCapabilities`; huge bitrate win on screen content = more headroom for res/refresh. | 🟧 High (quality/bandwidth) | Low–Med | `useWebRTC.ts` transceiver setup |
| 4 | **Adaptive jitter target instead of hard `0`.** Keep `0` on clean LAN; let it breathe on Wi-Fi/internet to kill jitter-spike stutter. | 🟨 Med (smoothness under real jitter) | Low | `useWebRTC.ts` `ontrack` |
| 5 | **RTP extension hygiene.** Ensure `transport-wide-cc`/`abs-send-time`/`playout-delay` on; **drop `color-space`** to keep HW decode. | 🟨 Med (CC works; HW decode preserved) | Low | SDP/transceiver config |
| 6 | **Region-per-peer capture model (mesh).** Host holds `Map<peerId, pc>`, one region track each; wire it to `SpatialConfigurator`. | 🟧 High (the actual feature) | Med | `useWebRTC.ts`, host UI |
| 7 | **Windows multi-monitor IDD (signed).** Provision **N** virtual displays, one per secondary — Architecture B. The real "extend across PCs" experience. | 🟥 Critical for the vision | High (driver signing) | `idd-controller.js`, native |
| 8 | **rVFC-based telemetry.** Accurate fps/dropped-frame/latency metrics; feeds the adaptive jitter target (#4) and ABR. | 🟨 Med (visibility → tuning) | Low | `VideoStage.tsx`, telemetry |
| 9 | **FEC only on lossy legs; smart keyframes (long GOP + PLI-on-loss).** Stop wasting bitrate on clean LAN; fast recovery on reconnect. | 🟨 Med | Low–Med | transceiver / encoder params |
| 10 | **mediasoup SFU in the Host Companion.** Only when the host's browser encoders are the bottleneck (N high-res regions). Routes track *i* → client *i*; centralizes CC. | 🟩 High at scale | High | new server component |
| 11 | **Native capture + WebCodecs/WebTransport.** The endgame with a native Host Agent (DXGI/SCK/PipeWire + NVENC/QSV/VT). Not a near-term latency patch. | 🟩 High long-term | Very High | native agent |

### The honest sequencing

1. **This week:** #1, #2, #3, #4, #5 — all code-local, all high-value, no new infrastructure.
2. **Next:** #6 (region-per-peer mesh) + #8 (rVFC telemetry) → "two or more secondaries" is
   real and measurable.
3. **Then:** #7 (multi-monitor IDD) → true native extended desktop on Windows.
4. **Later, only when needed:** #10 (SFU) when host encoders saturate; #11 (native capture +
   WebCodecs) as the performance ceiling-raiser paired with the native agent.

---

## Appendix — what is genuinely NOT achievable in a browser

State the walls so nobody plans against them:

- **No programmatic monitor/region selection** — `getDisplayMedia` always shows a picker; the
  page cannot auto-pick a screen (https://developer.chrome.com/docs/web-platform/screen-sharing-controls).
- **No virtual-display provisioning from a page** — needs an OS driver (IDD / CGVirtualDisplay /
  DRM) in the Host Companion.
- **No OS input injection from a page** — already correctly in the companion (`input-controller.js`).
- **No guaranteed AV1/HEVC hardware *encode* in-browser** — decode is broad, encode depends on
  host silicon; plan a VP9/H.264 fallback.
- **No NAT hole-punching for WebTransport** — unlike WebRTC's ICE; WebTransport needs a
  reachable server, which is fine on LAN (the companion) but not peer-to-peer across the
  internet.
- **`<video>` is already the lowest-latency renderer** — canvas/WebGL only adds latency unless
  you need per-pixel work.

---

## Sources

- AV1 state / screen content: https://www.forasoft.com/learn/video-encoding/articles/av1-state-2026 · https://visionular.ai/av1-screen-content-coding/ · https://visionular.ai/av1-decoding-and-hardware-ecosystem-the-future-of-video-delivery/ · https://webrtc.ventures/2026/04/should-you-still-consider-av1-codec-in-your-webrtc-architecture/ · https://www.red5.net/blog/av1-webrtc-streaming/
- H.265/HEVC in WebRTC: https://chromestatus.com/feature/5153479456456704 · https://learn.microsoft.com/en-us/answers/questions/5880331/h-265-hevc-not-published-sent-via-webrtc-chrome-su · https://groups.google.com/a/chromium.org/g/blink-dev/c/3h8lL8a377c
- Codec support overview: https://getstream.io/resources/projects/webrtc/advanced/codecs/
- SFU comparison: https://www.forasoft.com/learn/video-streaming/articles-streaming/sfu-comparison-mediasoup-janus-livekit-jitsi-pion · https://webrtc.ventures/2026/06/open-source-webrtc-media-servers/
- Simulcast / SVC / SFU forwarding: https://www.digitalsamba.com/blog/svc-vs-simulcast-in-webrtc · https://getstream.io/resources/projects/webrtc/architectures/sfu/ · https://www.forasoft.com/learn/video-streaming/articles-streaming/simulcast-svc-sfu
- WebCodecs vs WebRTC / WebTransport / MoQ: https://fsjs.dev/comparing-webcodecs-and-webrtc-which-should-you-choose/ · https://www.nanocosmos.net/blog/webrtc-latency/ · https://www.videosdk.live/developer-hub/webrtc/webrtc-low-latency
- Jitter buffer / playout delay / RTP-ext tuning (browser remote desktop): https://github.com/selkies-project/selkies/issues/157 · https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpReceiver/jitterBufferTarget · https://developer.mozilla.org/en-US/docs/Web/API/RTCInboundRtpStreamStats/jitterBufferTargetDelay
- getDisplayMedia constraints: https://developer.chrome.com/docs/web-platform/screen-sharing-controls · https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia · https://groups.google.com/a/chromium.org/g/blink-dev/c/t3kqlI58U8Q
- Windows IDD virtual displays: https://learn.microsoft.com/en-us/windows-hardware/drivers/display/indirect-display-driver-model-overview · https://github.com/VirtualDrivers/Virtual-Display-Driver · https://github.com/roshkins/IddSampleDriver
- macOS virtual displays: https://github.com/waydabber/betterdisplay · https://github.com/enfp-dev-studio/node-mac-virtual-display · https://betterdisplay.dev/
- Frontend rendering / rVFC / desynchronized: https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback · https://web.dev/articles/requestvideoframecallback-rvfc · https://developer.chrome.com/blog/desynchronized · https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/contentHint

_This document is research and recommendation only. No source files were modified in its
creation._
