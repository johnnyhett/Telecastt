import { API_BASE } from './env';

export interface NetworkInfo {
  localIp: string;
  isBluetoothActive: boolean;
}

/**
 * Every device-control endpoint answers with this shape. `success` now reflects
 * what the PowerShell script actually reported — including a declined UAC prompt
 * or a driver Windows refused to load — so the UI must surface it rather than
 * assume a non-throwing call means the operation worked.
 */
export interface DeviceResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface RoomInfo {
  roomId: string;
  hostToken: string;
  expiresAt: number;
}

export interface VddStatus extends DeviceResult {
  data?: { Installed: boolean; Present: boolean; Status: string; InstanceId: string | null };
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// The host's room token authenticates privileged device-control endpoints
// (virtual display, Bluetooth). Set once when a host session starts; cleared on
// disconnect. Only host sessions ever call those endpoints.
let hostToken: string | null = null;
export function setHostToken(token: string | null): void {
  hostToken = token;
}
function hostHeaders(): Record<string, string> {
  return hostToken ? { 'X-Telecastt-Host-Token': hostToken } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON response */
  }

  if (!res.ok) {
    const record = (body ?? {}) as Record<string, unknown>;
    const message =
      (typeof record.message === 'string' && record.message) ||
      (typeof record.error === 'string' && record.error) ||
      `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

export const api = {
  networkInfo: () => request<NetworkInfo>('/api/network-info'),
  createRoom: () => request<RoomInfo>('/api/create-room'),
  validateRoom: (code: string) =>
    request<{ valid: boolean; status?: string; clientCount?: number }>(
      `/api/validate-room/${encodeURIComponent(code)}`
    ),
  vddStatus: () => request<VddStatus>('/api/vdd/status', { headers: hostHeaders() }),
  vddInstall: () => request<DeviceResult>('/api/vdd/install', { method: 'POST', headers: hostHeaders() }),
  vddEnable: () => request<DeviceResult>('/api/vdd/enable', { method: 'POST', headers: hostHeaders() }),
  vddDisable: () => request<DeviceResult>('/api/vdd/disable', { method: 'POST', headers: hostHeaders() }),
  vddConfigure: (body: Record<string, unknown>) =>
    request<DeviceResult>('/api/vdd/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...hostHeaders() },
      body: JSON.stringify(body),
    }),
};
