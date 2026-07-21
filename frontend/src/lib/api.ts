import { API_BASE } from './env';

export interface NetworkInfo {
  localIp: string;
  allIps: Array<{ interfaceName: string; address: string; type: string }>;
  isBluetoothActive: boolean;
}

export interface RoomInfo {
  roomId: string;
  hostToken: string;
  expiresAt: number;
}

export interface VddStatus {
  success: boolean;
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
  vddStatus: () => request<VddStatus>('/api/vdd/status'),
  vddInstall: () => request<{ success: boolean }>('/api/vdd/install', { method: 'POST' }),
  vddEnable: () => request<{ success: boolean }>('/api/vdd/enable', { method: 'POST' }),
  vddDisable: () => request<{ success: boolean }>('/api/vdd/disable', { method: 'POST' }),
  vddConfigure: (body: Record<string, unknown>) =>
    request<{ success: boolean; error?: string }>('/api/vdd/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
};
