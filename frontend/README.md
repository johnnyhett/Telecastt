# Telecastt Frontend

The web application for Telecastt — built with React, TypeScript, and Vite.

## Architecture

- **Host Command Center (`CommandCenter.tsx`)**: Controls room signaling, stream configuration (bitrate/fps/resolution), Virtual Display Driver installation, and Spatial Layout management.
- **Client Video Surface (`VideoSurface.tsx`)**: High-performance WebRTC video player with autoplay policy handling and tap-to-stream overlay.
- **Input Capture (`useInputCapture.ts`)**: Serializes touch, mouse, keyboard, and scroll events for real-time transmission over WebRTC data channels.
- **Native Touch Injection**: Translates touch contacts into Win32 native touch injection payloads.

## Scripts

```bash
npm run dev      # Start Vite development server
npm run build    # Build production bundle to dist/
npm run preview  # Preview production build
```
