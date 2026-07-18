<div align="center">
  <img src="https://img.shields.io/badge/Telecastt-144Hz_Zero_Latency-7B61FF?style=for-the-badge" alt="Telecastt Banner" />
  <h1>Telecastt 🔮</h1>
  <p><strong>Turn any web browser into an ultra-low latency, 144Hz 4K second monitor.</strong></p>

  [![React](https://img.shields.io/badge/React-18.x-61DAFB?style=flat-square&logo=react)](#)
  [![Vite](https://img.shields.io/badge/Vite-4.x-646CFF?style=flat-square&logo=vite)](#)
  [![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?style=flat-square&logo=nodedotjs)](#)
  [![WebSockets](https://img.shields.io/badge/WebSockets-Raw_ws-000000?style=flat-square&logo=socketdotio)](#)
  [![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#)
</div>

---

## ✨ Overview

Telecastt is a state-of-the-art WebRTC application designed to extend your Windows desktop to any device with a web browser (iPad, MacBook, Android, or another PC) without the need for expensive hardware HDMI dummies. 

By leveraging native **OS-level EDID spoofing** combined with **hardware-accelerated WebRTC** and a **zero-jitter-buffer** architecture, Telecastt achieves performance that rivals native cables: up to **4K resolutions** at **144Hz+** with imperceptible latency.

## 🚀 The Secret Sauce

* **Zero-Latency WebRTC:** Aggressively bypasses traditional WebRTC jitter buffers (`playoutDelayHint = 0`) to render frames the exact millisecond they hit the network.
* **4K & 144Hz Native Capture:** Prevents browser downscaling via strict `resizeMode: "none"` constraints and prioritizes hardware encoders (H.264/VP8).
* **Dark Glassmorphism UI:** A sleek, performance-first user interface built with native CSS `cubic-bezier` spring physics (no bloated animation libraries).
* **Automated Virtual Driver:** Bundled with a PowerShell script to seamlessly install and configure an open-source Windows Indirect Display Driver (IDD).

## 🛠️ Installation & Setup

### 1. Install the Virtual Display (Windows Host Only)
To extend your desktop, Windows requires a monitor. Telecastt automates the creation of a virtual one.
1. Open PowerShell as **Administrator**.
2. Run the included setup script:
   ```powershell
   .\scripts\Install-VirtualMonitor.ps1
   ```
3. Open Windows Display Settings, select **Extend these displays**, and set the virtual monitor to your desired resolution and refresh rate (up to 4K / 144Hz).

### 2. Run the Signaling Server
The lightweight Node.js WebSocket server is required to broker the peer-to-peer connection.
```bash
cd backend
npm install
npm start
```

### 3. Start the Web App
```bash
cd frontend
npm install
npm run dev
```

### 4. Connect
1. On your **Host PC**, navigate to `http://localhost:5173`. Click **Share Display** and select the Virtual Monitor you just created.
2. A 6-character secure room code will be generated.
3. On your **Client Device** (e.g., iPad), navigate to your Host PC's local IP address (e.g., `http://192.168.1.50:5173`), enter the room code, and experience zero-latency casting!

## 🔮 The "Project 777" Roadmap
Telecastt is actively evolving. We are executing the massive **777-Phase Master Plan** to turn this into the ultimate universal casting platform. Upcoming features include:
* **WebCodecs API Rewrite:** Bypassing the `<video>` element entirely for raw GPU frame rendering.
* **Remote Peripherals:** Sub-millisecond WebRTC DataChannels for mouse and keyboard passthrough.
* **Tauri/Rust Desktop Client:** A native host application for silent system-tray operation and automated monitor lifecycle management.

## 📄 License
This project is licensed under the MIT License.
