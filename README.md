<div align="center">
  <img src="assets/logo.png" alt="Telecastt Logo" width="160" style="border-radius: 20px; filter: drop-shadow(0 0 30px rgba(56, 189, 248, 0.4)); margin-bottom: 15px;" />
  
  <h1>TELECASTT</h1>
  <p><em>“Screens unchained. Beyond ecosystems, beyond wires — turn any glass into your extended horizon.”</em></p>

  <p>
    <a href="#overview">Overview</a> &bull;
    <a href="#key-features">Key Features</a> &bull;
    <a href="#architecture">Architecture</a> &bull;
    <a href="#quickstart">Quickstart</a> &bull;
    <a href="#security">Security</a> &bull;
    <a href="#license">License</a>
  </p>
</div>

---

## Overview

**Telecastt** is a high-performance WebRTC display matrix platform engineered to seamlessly extend a desktop environment to any device with a web browser — breaking down walled ecosystems across iPhone, iPad, Android, Mac, Windows, and Linux.

By combining native Windows User32 Touch Injection (`InjectTouchInput`), automated Virtual Display Driver (VDD) provisioning, bidirectional WebRTC data channel clipboard synchronization, and a Cinema Dark Pro command matrix dashboard, Telecastt provides an unchained multi-monitor experience with remote touch and KVM control.

---

## Key Features

- ⚡ **Native Windows Touch Control:** Employs Win32 `InjectTouchInput` to inject native touch contacts on extended displays without snatching or moving your host PC's physical mouse cursor.
- 🖥️ **Virtual Display Driver (VDD):** Automated Virtual Display Driver setup with UAC administrative elevation and automatic Windows `displayswitch.exe` desktop extension topology.
- 📱 **Cross-Ecosystem Compatibility:** Seamlessly connect iPhones, iPads, Android smartphones, tablets, laptops, and smart TVs into a unified display matrix.
- 📋 **Live Clipboard Synchronization:** Real-time bidirectional text clipboard sync over WebRTC data channels between host and client devices.
- 🎛️ **Spatial Layout Manager:** Drag-and-drop 2D monitor layout configurator for positioning secondary displays (left, right, above, below) relative to the primary host PC.
- 🔋 **Battery-Aware Adaptive Quality:** Automatic framerate and bitrate governor that scales stream parameters down when client device battery is constrained.
- 🖼️ **Picture-in-Picture & Fullscreen Lock:** Support for OS-level floating Picture-in-Picture windows and landscape orientation locking.
- 🔒 **Cryptographic Session Pairing:** CSPRNG-generated room authentication codes and high-density QR code scanning with embedded brand telemetry.

---

## Architecture

```
                       ┌──────────────────────────────────────┐
                       │           Host Desktop (PC)          │
                       │  - WebRTC Hardware Media Capture     │
                       │  - Win32 InjectTouchInput Controller │
                       │  - Virtual Display Driver (VDD)      │
                       └──────────────────┬───────────────────┘
                                          │
                                WebSocket Signaling (Port 3001)
                                WebRTC Peer-to-Peer Data Channels
                                          │
    ┌─────────────────────────────────────┴─────────────────────────────────────┐
    │                                                                           │
┌───▼──────────────────────┐   ┌──────────────────────────┐   ┌─────────────────▼────────┐
│   iOS / iPadOS (Safari)   │   │  Android (Chrome/Firefox)│   │  macOS / Linux Client    │
│  - Native Touch Receiver │   - Multi-Touch Gestures     │   - Floating PiP Window      │
│  - Live Clipboard Sync   │   - Battery Adaptive Quality │   - Telemetry Dashboard      │
└──────────────────────────┘   └──────────────────────────┘   └──────────────────────────┘
```

---

## Quickstart

### 1. Start the Signaling Server
```bash
cd backend
npm install
npm start
```
*The signaling server starts on port `3001`.*

### 2. Launch the Web Command Center
```bash
cd frontend
npm install
npm run dev
```
*Access the host dashboard at `http://localhost:5173`.*

### 3. Connect a Secondary Screen
1. On your **Host PC**, open `http://localhost:5173` and click **Initialize Host Matrix**.
2. Scan the generated QR Code or enter the 6-character Session ID on any client device (e.g. `http://<HOST-IP>:5173`).
3. (Optional) In the Command Center, click **Install Driver** to enable true Extended Display Mode via Windows UAC elevation.

---

## Technical Specifications

| Component | Stack / Protocol |
| :--- | :--- |
| **Frontend** | React, TypeScript, Vite, WebRTC API |
| **Backend** | Node.js, Express, WebSocket (`ws`), Rate Limiter |
| **Input Controller** | Win32 User32 C# Interop (`InjectTouchInput`, `SetCursorPos`, `keybd_event`) |
| **Display Provisioning** | Windows Indirect Display Driver (IDD) & `displayswitch.exe` |
| **Encryption** | WebRTC DTLS 1.3, CSPRNG Session Tokens |

---

## Security

- **Session Isolation:** Room codes are generated using cryptographically secure random bytes with strict 2-peer limits per room.
- **Per-IP Rate Limiting:** Token-bucket rate limiting prevents brute-force room validation attacks.
- **Process Pipe Isolation:** Native input injection executes via persistent stdin stream isolation to avoid process-spawning overhead and memory leaks.

---

## License

Distributed under the MIT License. See `LICENSE` for more information.