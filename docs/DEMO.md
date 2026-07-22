# Telecastt — Demo Storyboard

A ~20-second loop that shows the one thing worth a screenshot: **one primary PC extended
across two secondary PCs**. Record it once, drop the file at `assets/demo.gif`, and uncomment
the image line near the top of the root `README.md`.

## What you need
- 1 primary PC (Windows, for input injection) running `backend` + `frontend`.
- 2 secondary devices with a browser on the same LAN (laptops are perfect).
- A screen recorder (OBS, ScreenToGif on Windows, or Kap on macOS).

## The 20-second shot list

| Time | On screen | Why it lands |
| :-- | :-- | :-- |
| 0:00–0:03 | Primary PC: click **Initialize Host**, pick the desktop. Room code + QR appear. | Zero-config start. |
| 0:03–0:07 | Secondary #1 scans the QR / types the code → its screen fills with the host desktop. | "It just connected." |
| 0:07–0:10 | Secondary #2 joins the same way. Host badge shows **Connected · 2 screens**. | Multi-PC, live. |
| 0:10–0:13 | On the host, flip **Display mode → Extend**. The two secondaries snap to the **left/right halves** of the desktop. | The wall — the money shot. |
| 0:13–0:17 | Drag a window across the primary; it slides from Secondary #1 into Secondary #2. | Proof it's one continuous desktop. |
| 0:17–0:20 | Grab a secondary's mouse and click something on the host; the on-stream **Latency (ms)** readout is visible. | Control + low latency. |

## Capture tips
- Record at 1280×720, cap the GIF at ~12–15 fps and < 10 MB so it loads on GitHub.
- Put the three machines in one camera/screen frame if you can (a phone on a tripod over all
  three screens is more convincing than a screen capture of one).
- Keep the desktop wallpaper clean and high-contrast so the tiling reads clearly.

## Fallback if you only have 2 PCs
Do the same shot with **one** secondary: connect, then toggle Mirror ↔ Extend to show the
region crop change, and demonstrate remote control. Still compelling; just note "2-PC demo."

## After recording
```bash
# put the file here, then:
git add assets/demo.gif
# uncomment the ![Telecastt demo](assets/demo.gif) line in README.md
git commit -m "docs: add demo GIF"
```
