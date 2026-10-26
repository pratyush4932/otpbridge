export interface ForwardMessagePayload {
  id: string;
  packageName: string;
  title?: string;
  serviceName?: string;
  carrierTag?: string;
  otpCode: string;
  bodySnippet?: string;
  timestamp: number;
}

export interface ForwardMessageResult {
  delivered: boolean;
  queued: boolean;
  receiverOffline?: boolean;
  duplicate?: boolean;
  messageId: string;
}

export interface StartPairingResult {
  pairingId: string;
  pairingToken: string;
  serverUrl: string;
  expiresAt: number;
  receiverDevice: {
    id: string;
    token?: string;
  };
}

export interface CompletePairingResult {
  success: boolean;
  senderDevice: {
    id: string;
    token: string;
    pairedWithReceiverId: string;
  };
}

export interface DeviceStatusResult {
  device: {
    id: string;
    role: 'sender' | 'receiver';
    name: string;
    createdAt: number;
    lastSeenAt: number;
    isPaired: boolean;
  };
  partner: {
    id: string;
    role: string;
    name: string;
    lastSeenAt: number;
  } | null;
}

const DEFAULT_HEADERS: Record<string, string> = {
  'ngrok-skip-browser-warning': 'true',
  'User-Agent': 'OTPBridgeApp/1.0'
};

export const ApiClient = {
  async checkHealth(serverUrl: string): Promise<boolean> {
    const cleanUrl = (serverUrl || '').trim().replace(/\/+$/, '');
    try {
      const res = await fetch(`${cleanUrl}/api/health`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          ...DEFAULT_HEADERS
        }
      });
      if (!res.ok) return false;
      const data = await res.json();
      return data.status === 'ok';
    } catch {
      return false;
    }
  },

  async startPairing(
    serverUrl: string,
    receiverName?: string,
    existingDeviceId?: string,
    existingToken?: string
  ): Promise<StartPairingResult> {
    const cleanUrl = (serverUrl || '').trim().replace(/\/+$/, '');
    const res = await fetch(`${cleanUrl}/api/pairing/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...DEFAULT_HEADERS
      },
      body: JSON.stringify({
        receiverName,
        deviceId: existingDeviceId,
        token: existingToken,
        serverUrl: cleanUrl
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Pairing start failed' }));
      throw new Error(err.error || 'Failed to start pairing session');
    }

    return await res.json();
  },

  async completePairing(
    serverUrl: string,
    pairingToken: string,
    senderName?: string
  ): Promise<CompletePairingResult> {
    const cleanUrl = (serverUrl || '').trim().replace(/\/+$/, '');
    const cleanToken = (pairingToken || '').trim();
    const res = await fetch(`${cleanUrl}/api/pairing/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...DEFAULT_HEADERS
      },
      body: JSON.stringify({
        pairingToken: cleanToken,
        senderName
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Pairing completion failed' }));
      throw new Error(err.error || 'Failed to complete pairing');
    }

    return await res.json();
  },

  async getDeviceStatus(
    serverUrl: string,
    deviceId: string,
    token: string
  ): Promise<DeviceStatusResult> {
    const cleanUrl = (serverUrl || '').trim().replace(/\/+$/, '');
    const res = await fetch(`${cleanUrl}/api/devices`, {
      method: 'GET',
      headers: {
        'x-device-id': deviceId,
        'x-device-token': token,
        'Accept': 'application/json',
        ...DEFAULT_HEADERS
      }
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to fetch status' }));
      throw new Error(err.error || 'Unauthorized or revoked device');
    }

    return await res.json();
  },

  async revokeDevice(serverUrl: string, deviceId: string, token: string): Promise<boolean> {
    const cleanUrl = (serverUrl || '').trim().replace(/\/+$/, '');
    const res = await fetch(`${cleanUrl}/api/devices/revoke`, {
      method: 'POST',
      headers: {
        'x-device-id': deviceId,
        'x-device-token': token,
        'Content-Type': 'application/json',
        ...DEFAULT_HEADERS
      }
    });

    if (!res.ok) {
      return false;
    }

    const data = await res.json().catch(() => ({ success: false }));
    return Boolean(data.success);
  },

  async forwardOtpMessage(
    serverUrl: string,
    deviceId: string,
    token: string,
    payload: ForwardMessagePayload
  ): Promise<ForwardMessageResult> {
    const cleanUrl = (serverUrl || '').trim().replace(/\/+$/, '');
    const res = await fetch(`${cleanUrl}/api/messages`, {
      method: 'POST',
      headers: {
        'x-device-id': deviceId,
        'x-device-token': token,
        'Content-Type': 'application/json',
        ...DEFAULT_HEADERS
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Forwarding failed' }));
      throw new Error(err.error || 'Forwarding failed');
    }

    return await res.json();
  },

  async reportUnlistedNotification(
    serverUrl: string,
    data: { packageName: string; title?: string; body?: string; reason?: string }
  ): Promise<void> {
    const cleanUrl = (serverUrl || '').trim().replace(/\/+$/, '');
    try {
      await fetch(`${cleanUrl}/api/messages/unlisted`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...DEFAULT_HEADERS
        },
        body: JSON.stringify(data)
      });
    } catch {
      // Non-blocking debug report
    }
  }
};
