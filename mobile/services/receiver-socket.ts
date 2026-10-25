import { StorageService } from './storage';

export interface ReceivedOtpMessage {
  id: string;
  senderId: string;
  packageName: string;
  title?: string;
  serviceName?: string;
  carrierTag?: string;
  otpCode: string;
  bodySnippet?: string;
  timestamp: number;
  receivedAt: number;
  wasQueued?: boolean;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export class ReceiverSocketClient {
  private ws: WebSocket | null = null;
  private serverUrl = '';
  private deviceId = '';
  private token = '';
  private shouldReconnect = false;
  private reconnectAttempts = 0;
  private reconnectTimer: any = null;
  private pingInterval: any = null;
  private pruneInterval: any = null;

  private messages: ReceivedOtpMessage[] = [];
  private isLoaded = false;
  private loadPromise: Promise<ReceivedOtpMessage[]> | null = null;
  private messagesListeners = new Set<(msgs: ReceivedOtpMessage[]) => void>();

  private messageListeners = new Set<(msg: ReceivedOtpMessage) => void>();
  private statusListeners = new Set<(status: ConnectionState) => void>();
  private pairingListeners = new Set<(partnerId: string | null) => void>();

  public status: ConnectionState = 'disconnected';

  constructor() {
    this.loadStoredMessages();
    this.startPruneInterval();
  }

  private startPruneInterval(): void {
    if (this.pruneInterval) return;
    this.pruneInterval = setInterval(() => {
      this.pruneExpiredMessages();
    }, 5000);
    if (this.pruneInterval?.unref) {
      this.pruneInterval.unref();
    }
  }

  public stopPruneInterval(): void {
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = null;
    }
  }

  public async loadStoredMessages(): Promise<ReceivedOtpMessage[]> {
    try {
      const stored = await StorageService.getReceivedMessages<ReceivedOtpMessage>();
      const existingIds = new Set(this.messages.map((m) => m.id));
      for (const msg of stored) {
        if (!existingIds.has(msg.id)) {
          this.messages.push(msg);
        }
      }
      this.messages.sort((a, b) => b.receivedAt - a.receivedAt);
    } catch {
      // Fallback
    } finally {
      this.isLoaded = true;
      this.pruneExpiredMessages();
      this.notifyMessagesListeners();
    }
    return this.getMessages();
  }

  public pruneExpiredMessages(): boolean {
    const cutoff = Date.now() - 5 * 60 * 1000;
    const initialLen = this.messages.length;
    this.messages = this.messages.filter((m) => m.receivedAt > cutoff);
    if (this.messages.length !== initialLen) {
      StorageService.saveReceivedMessages(this.messages).catch(() => {});
      this.notifyMessagesListeners();
      return true;
    }
    return false;
  }

  public getMessages(): ReceivedOtpMessage[] {
    const cutoff = Date.now() - 5 * 60 * 1000;
    return this.messages.filter((m) => m.receivedAt > cutoff);
  }

  public async clearMessages(): Promise<void> {
    this.messages = [];
    await StorageService.clearReceivedMessages();
    this.notifyMessagesListeners();
  }

  public onMessagesChange(listener: (msgs: ReceivedOtpMessage[]) => void): () => void {
    this.messagesListeners.add(listener);
    listener(this.getMessages());
    return () => {
      this.messagesListeners.delete(listener);
    };
  }

  private notifyMessagesListeners(): void {
    const msgs = this.getMessages();
    for (const listener of this.messagesListeners) {
      try {
        listener(msgs);
      } catch {}
    }
  }

  public isConnected(): boolean {
    return this.status === 'connected';
  }

  public getStatus(): ConnectionState {
    return this.status;
  }

  public connect(serverUrl: string, deviceId: string, token: string): void {
    const isSameTarget =
      this.serverUrl === serverUrl &&
      this.deviceId === deviceId &&
      this.token === token;

    this.serverUrl = serverUrl;
    this.deviceId = deviceId;
    this.token = token;
    this.shouldReconnect = true;

    if (
      isSameTarget &&
      ((this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) ||
        this.reconnectTimer !== null)
    ) {
      return;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    this.initiateConnection();
  }

  private initiateConnection(): void {
    if (!this.serverUrl || !this.deviceId || !this.token) return;

    this.updateStatus('connecting');

    try {
      // Convert http(s) to ws(s)
      let wsUrl = this.serverUrl.replace(/^http/, 'ws');
      if (!wsUrl.endsWith('/ws')) {
        wsUrl = `${wsUrl.replace(/\/+$/, '')}/ws`;
      }

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        // Send authentication payload immediately
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'auth',
            deviceId: this.deviceId,
            token: this.token
          }));
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);

          if (data.type === 'auth_success') {
            this.reconnectAttempts = 0;
            this.updateStatus('connected');
            this.startPing();
            if (data.pairedWithId) {
              StorageService.saveCredentials({ pairedWithId: data.pairedWithId });
              for (const listener of this.pairingListeners) {
                listener(data.pairedWithId);
              }
            }
            return;
          }

          if (data.type === 'pairing_success') {
            const partnerId = data.partner?.id || null;
            if (partnerId) {
              StorageService.saveCredentials({ pairedWithId: partnerId });
              for (const listener of this.pairingListeners) {
                listener(partnerId);
              }
            }
            return;
          }

          if (data.type === 'forwarded_otp' && data.message) {
            const raw = data.message;
            const message: ReceivedOtpMessage = {
              id: raw.id,
              senderId: raw.senderId,
              packageName: raw.packageName,
              title: raw.title,
              serviceName: raw.serviceName,
              carrierTag: raw.carrierTag,
              otpCode: raw.otpCode,
              bodySnippet: raw.bodySnippet,
              timestamp: raw.timestamp,
              receivedAt: Date.now(),
              wasQueued: raw.wasQueued
            };

            // Send acknowledgment back
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(JSON.stringify({ type: 'ack', id: raw.id }));
            }

            // Retain in memory and persist across navigation
            if (!this.messages.some((m) => m.id === message.id)) {
              this.messages = [message, ...this.messages];
              this.pruneExpiredMessages();
              StorageService.saveReceivedMessages(this.messages).catch(() => {});
            }

            for (const listener of this.messageListeners) {
              listener(message);
            }
            this.notifyMessagesListeners();
            return;
          }

          if (data.type === 'error') {
            if (data.message?.includes('Unauthorized')) {
              this.shouldReconnect = false; // Don't loop on revoked credentials
            }
            this.updateStatus('error');
          }
        } catch {
          // Ignore JSON parse errors
        }
      };

      this.ws.onclose = () => {
        this.stopPing();
        this.updateStatus('disconnected');
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        this.updateStatus('error');
      };
    } catch {
      this.updateStatus('error');
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000);
    if (this.pingInterval?.unref) {
      this.pingInterval.unref();
    }
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectAttempts++;
    // Exponential backoff capped at 30 seconds
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 30000);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) {
        this.initiateConnection();
      }
    }, delay);
    if (this.reconnectTimer?.unref) {
      this.reconnectTimer.unref();
    }
  }

  public disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    this.stopPruneInterval();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.updateStatus('disconnected');
  }

  private updateStatus(newStatus: ConnectionState): void {
    this.status = newStatus;
    for (const listener of this.statusListeners) {
      listener(newStatus);
    }
  }

  public onMessage(listener: (msg: ReceivedOtpMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  public onStatus(listener: (status: ConnectionState) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public onPairing(listener: (partnerId: string | null) => void): () => void {
    this.pairingListeners.add(listener);
    return () => {
      this.pairingListeners.delete(listener);
    };
  }
}

export const receiverSocketClient = new ReceiverSocketClient();
