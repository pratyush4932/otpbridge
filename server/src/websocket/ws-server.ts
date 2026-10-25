import { WebSocket } from 'ws';
import { deviceStore } from '../services/device-store.js';
import { ephemeralMessageQueue, QueuedMessage } from '../services/message-queue.js';
import { formatSafeMessageLog } from '../security/sanitize.js';

interface AuthenticatedSocket {
  ws: WebSocket;
  deviceId: string;
  isAlive: boolean;
}

export class WebSocketManager {
  // receiverId -> Set of sockets
  private connections = new Map<string, Set<WebSocket>>();
  private socketMeta = new WeakMap<WebSocket, AuthenticatedSocket>();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startHeartbeat();
  }

  public handleConnection(ws: WebSocket): void {
    let authTimeout: NodeJS.Timeout | null = setTimeout(() => {
      if (!this.socketMeta.has(ws)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Authentication timeout' }));
        ws.close(4001, 'Auth Timeout');
      }
    }, 10000);

    ws.on('message', (raw: Buffer | string) => {
      try {
        const data = JSON.parse(raw.toString());

        if (data.type === 'auth') {
          const { deviceId, token } = data;
          if (!deviceId || !token) {
            ws.send(JSON.stringify({ type: 'error', message: 'Missing deviceId or token' }));
            ws.close(4002, 'Invalid Auth Payload');
            return;
          }

          const device = deviceStore.authenticateDevice(deviceId, token);
          if (!device || device.role !== 'receiver') {
            ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized device' }));
            ws.close(4003, 'Unauthorized');
            return;
          }

          if (authTimeout) {
            clearTimeout(authTimeout);
            authTimeout = null;
          }

          this.registerSocket(device.id, ws);
          const partner = device.pairedWithId ? deviceStore.getDevice(device.pairedWithId) : null;
          ws.send(JSON.stringify({
            type: 'auth_success',
            deviceId: device.id,
            isPaired: Boolean(device.pairedWithId && partner && !partner.revoked),
            pairedWithId: (partner && !partner.revoked) ? device.pairedWithId : null
          }));

          // Flush any ephemeral queued messages immediately
          const queued = ephemeralMessageQueue.flushForReceiver(device.id);
          for (const msg of queued) {
            this.sendToSocket(ws, {
              type: 'forwarded_otp',
              message: {
                id: msg.id,
                senderId: msg.senderId,
                packageName: msg.packageName,
                title: msg.title,
                serviceName: msg.serviceName,
                carrierTag: msg.carrierTag,
                otpCode: msg.otpCode,
                bodySnippet: msg.bodySnippet,
                timestamp: msg.timestamp,
                wasQueued: true
              }
            });
          }
          return;
        }

        if (data.type === 'ping') {
          const meta = this.socketMeta.get(ws);
          if (meta) meta.isAlive = true;
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          return;
        }

        if (data.type === 'ack') {
          // Client acknowledged message delivery
          return;
        }
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Malformed JSON message' }));
      }
    });

    ws.on('pong', () => {
      const meta = this.socketMeta.get(ws);
      if (meta) meta.isAlive = true;
    });

    ws.on('close', () => {
      if (authTimeout) clearTimeout(authTimeout);
      this.unregisterSocket(ws);
    });

    ws.on('error', () => {
      if (authTimeout) clearTimeout(authTimeout);
      this.unregisterSocket(ws);
    });
  }

  private registerSocket(deviceId: string, ws: WebSocket): void {
    let pool = this.connections.get(deviceId);
    if (!pool) {
      pool = new Set();
      this.connections.set(deviceId, pool);
    }
    pool.add(ws);
    this.socketMeta.set(ws, { ws, deviceId, isAlive: true });
  }

  private unregisterSocket(ws: WebSocket): void {
    const meta = this.socketMeta.get(ws);
    if (meta) {
      const pool = this.connections.get(meta.deviceId);
      if (pool) {
        pool.delete(ws);
        if (pool.size === 0) {
          this.connections.delete(meta.deviceId);
        }
      }
      this.socketMeta.delete(ws);
    }
  }

  public isReceiverOnline(receiverId: string): boolean {
    const pool = this.connections.get(receiverId);
    return Boolean(pool && pool.size > 0);
  }

  /**
   * Attempts immediate real-time delivery to active receiver sockets.
   * Returns true if delivered to at least one active socket.
   */
  public deliverToReceiver(receiverId: string, payload: any): boolean {
    const pool = this.connections.get(receiverId);
    if (!pool || pool.size === 0) {
      return false;
    }

    let delivered = false;
    for (const ws of pool) {
      if (ws.readyState === WebSocket.OPEN) {
        this.sendToSocket(ws, {
          type: 'forwarded_otp',
          message: payload
        });
        delivered = true;
      }
    }
    return delivered;
  }

  /**
   * Sends an arbitrary event to active receiver sockets (e.g. pairing updates).
   */
  public sendEventToReceiver(receiverId: string, event: any): boolean {
    const pool = this.connections.get(receiverId);
    if (!pool || pool.size === 0) {
      return false;
    }
    for (const ws of pool) {
      if (ws.readyState === WebSocket.OPEN) {
        this.sendToSocket(ws, event);
      }
    }
    return true;
  }

  private sendToSocket(ws: WebSocket, payload: any): void {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // Socket write failure handled on next heartbeat/close
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const [deviceId, pool] of this.connections.entries()) {
        for (const ws of pool) {
          const meta = this.socketMeta.get(ws);
          if (!meta || !meta.isAlive) {
            ws.terminate();
            pool.delete(ws);
            continue;
          }
          meta.isAlive = false;
          try {
            ws.ping();
          } catch {
            ws.terminate();
            pool.delete(ws);
          }
        }
        if (pool.size === 0) {
          this.connections.delete(deviceId);
        }
      }
    }, 30000);

    if (this.heartbeatInterval.unref) {
      this.heartbeatInterval.unref();
    }
  }

  public destroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    for (const pool of this.connections.values()) {
      for (const ws of pool) {
        ws.terminate();
      }
    }
    this.connections.clear();
  }
}

export const wsManager = new WebSocketManager();
