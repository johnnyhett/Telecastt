<div align="center">
  <img src="assets/logo.png" alt="Telecastt Logo" width="200" style="border-radius: 20px; margin-bottom: 20px;" />
  
  <h1>TELECASTT</h1>
  <p><strong>Enterprise Stream Control Protocol</strong></p>

  [![React](https://img.shields.io/badge/React-18.x-2563eb?style=flat-square&logo=react)](#)
  [![Vite](https://img.shields.io/badge/Vite-4.x-60a5fa?style=flat-square&logo=vite)](#)
  [![Node.js](https://img.shields.io/badge/Node.js-20.x-1e293b?style=flat-square&logo=nodedotjs)](#)
  [![WebSockets](https://img.shields.io/badge/WebSockets-Raw_ws-0f172a?style=flat-square&logo=socketdotio)](#)
</div>

---

## Overview

Telecastt is a high-performance WebRTC application engineered to seamlessly extend a Windows desktop environment to any browser-enabled device. 

By leveraging native OS-level EDID spoofing combined with hardware-accelerated WebRTC and a custom network topology manager, Telecastt delivers enterprise-grade performance and uncompromising video fidelity across local area networks.

## Architecture

- **Hardware-Accelerated Capture:** Utilizes strict `resizeMode: "none"` constraints to prevent browser-level downscaling, enforcing hardware encoder prioritization (H.264/VP8).
- **Automated IDD Provisioning:** Includes a robust PowerShell deployment script for seamless installation and configuration of an open-source Windows Indirect Display Driver (IDD).
- **Secure Signaling:** A lightweight, pure-WebSocket Node.js signaling server utilizing Cryptographically Secure Pseudorandom Number Generators (CSPRNG) for room authentication.
- **Dynamic Topology Control:** A native Command Center UI that allows administrators to manually configure display positioning, hardware resolution constraints, refresh rate governance, and target bitrate throttling.

## Installation & Deployment

### 1. Virtual Display Provisioning (Windows Host)
Telecastt requires a virtual monitor to extend the desktop environment.
1. Launch PowerShell with **Administrator privileges**.
2. Execute the provisioning script:
   ```powershell
   .\scripts\Install-VirtualMonitor.ps1
   ```
3. Navigate to **Windows Display Settings**, select **Extend these displays**, and configure the virtual monitor to match your required enterprise topology.

### 2. Signaling Server Deployment
The Node.js WebSocket server is required to broker the peer-to-peer connection.
```bash
cd backend
npm install
npm start
```

### 3. Client Interface Deployment
```bash
cd frontend
npm install
npm run build
npm run dev
```

### 4. Connection Protocol
1. On the **Host Machine**, navigate to `http://localhost:5173`. 
2. Select **Initialize Host Node** and select the designated Virtual Monitor to capture.
3. A secure 6-character **Session ID** will be generated and displayed in the Command Center.
4. On the **Client Device**, navigate to the Host's local network IP address (e.g., `http://192.168.1.50:5173`), enter the Session ID, and select **Connect to Host** to initiate the secure stream.

## License
Distributed under the MIT License.
 