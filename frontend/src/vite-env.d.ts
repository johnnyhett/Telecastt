/// <reference types="vite/client" />

// Optional deployment configuration. See src/lib/env.ts for how each is used.
interface ImportMetaEnv {
  /** JSON RTCIceServer[] that replaces the default ICE list wholesale. */
  readonly VITE_ICE_SERVERS?: string;
  /** Comma-separated TURN URLs appended to the default STUN list. */
  readonly VITE_TURN_URLS?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
