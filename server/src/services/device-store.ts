import fs from 'node:fs';
import path from 'node:path';
import { generateSecureToken, hashToken, secureCompare } from '../security/token.js';
import { config } from '../config.js';

export interface Device {
  id: string;
  role: 'sender' | 'receiver';
  tokenHash: string;
  name: string;
  pairedWithId?: string;
  createdAt: number;
  lastSeenAt: number;
  revoked: boolean;
}

export interface PairingSession {
  pairingId: string;
  pairingTokenHash: string;
  receiverId: string;
  serverUrl: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

export class DeviceStore {
  private devices = new Map<string, Device>();
  private pairingSessions = new Map<string, PairingSession>(); // key: pairingId
  private persistPath: string | null = null;

  constructor(persistPath: string | null = (process.env.NODE_ENV === 'test' ? null : path.join(process.cwd(), '.devices.json'))) {
    this.persistPath = persistPath;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!this.persistPath) return;
    try {
      if (fs.existsSync(this.persistPath)) {
        const raw = fs.readFileSync(this.persistPath, 'utf-8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const d of list) {
            if (d && d.id) {
              this.devices.set(d.id, d);
            }
          }
        }
      }
    } catch {
      // Ignore disk load errors
    }
  }

  private saveToDisk(): void {
    if (!this.persistPath) return;
    try {
      const list = Array.from(this.devices.values());
      fs.writeFileSync(this.persistPath, JSON.stringify(list, null, 2), 'utf-8');
    } catch {
      // Ignore disk write errors
    }
  }

  /**
   * Registers a new Receiver device or fetches an existing valid one.
   */
  public registerReceiver(name = 'Receiver Device'): { device: Device; rawToken: string } {
    const deviceId = `rcv_${generateSecureToken(8)}`;
    const rawToken = generateSecureToken(32);
    const tokenHash = hashToken(rawToken);

    const device: Device = {
      id: deviceId,
      role: 'receiver',
      tokenHash,
      name,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      revoked: false
    };

    this.devices.set(deviceId, device);
    this.saveToDisk();
    return { device, rawToken };
  }

  /**
   * Starts a short-lived, single-use pairing session initiated by a receiver.
   */
  public createPairingSession(
    receiverId: string,
    serverUrl: string,
    ttlSeconds = config.PAIRING_TOKEN_TTL_SECONDS
  ): { pairingId: string; rawPairingToken: string; expiresAt: number } {
    const receiver = this.devices.get(receiverId);
    if (!receiver || receiver.revoked || receiver.role !== 'receiver') {
      throw new Error('Receiver device not found or revoked');
    }

    const pairingId = `pair_${generateSecureToken(8)}`;
    const rawPairingToken = generateSecureToken(32);
    const pairingTokenHash = hashToken(rawPairingToken);
    const expiresAt = Date.now() + ttlSeconds * 1000;

    const session: PairingSession = {
      pairingId,
      pairingTokenHash,
      receiverId,
      serverUrl,
      createdAt: Date.now(),
      expiresAt,
      used: false
    };

    this.pairingSessions.set(pairingId, session);
    return { pairingId, rawPairingToken, expiresAt };
  }

  /**
   * Completes pairing for a sender scanning the pairing token.
   * Token is strictly single-use and expires after TTL.
   */
  public completePairing(
    rawPairingToken: string,
    senderName = 'Sender Device'
  ): { senderDevice: Device; rawSenderToken: string; receiverId: string } {
    const inputHash = hashToken(rawPairingToken);

    let matchedSession: PairingSession | undefined;
    for (const session of this.pairingSessions.values()) {
      if (secureCompare(session.pairingTokenHash, inputHash)) {
        matchedSession = session;
        break;
      }
    }

    if (!matchedSession) {
      throw new Error('Invalid or non-existent pairing token');
    }

    if (matchedSession.used) {
      throw new Error('Pairing token has already been used');
    }

    if (Date.now() > matchedSession.expiresAt) {
      this.pairingSessions.delete(matchedSession.pairingId);
      throw new Error('Pairing token has expired');
    }

    const receiver = this.devices.get(matchedSession.receiverId);
    if (!receiver || receiver.revoked) {
      throw new Error('Associated receiver device is no longer valid');
    }

    // Mark pairing session used immediately (prevent replay)
    matchedSession.used = true;
    this.pairingSessions.delete(matchedSession.pairingId);

    // Create Sender Device
    const senderId = `snd_${generateSecureToken(8)}`;
    const rawSenderToken = generateSecureToken(32);
    const senderTokenHash = hashToken(rawSenderToken);

    const senderDevice: Device = {
      id: senderId,
      role: 'sender',
      tokenHash: senderTokenHash,
      name: senderName,
      pairedWithId: receiver.id,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      revoked: false
    };

    // Bind receiver to this sender as well
    receiver.pairedWithId = senderId;
    receiver.lastSeenAt = Date.now();

    this.devices.set(senderId, senderDevice);
    this.devices.set(receiver.id, receiver);
    this.saveToDisk();

    return { senderDevice, rawSenderToken, receiverId: receiver.id };
  }

  /**
   * Authenticates device with ID and raw token.
   */
  public authenticateDevice(deviceId: string, rawToken: string): Device | null {
    const device = this.devices.get(deviceId);
    if (!device) return null;
    if (device.revoked) return null;

    const inputHash = hashToken(rawToken);
    if (!secureCompare(device.tokenHash, inputHash)) {
      return null;
    }

    device.lastSeenAt = Date.now();
    return device;
  }

  /**
   * Revokes a device and immediately unlinks any paired partner.
   */
  public revokeDevice(deviceId: string): boolean {
    const device = this.devices.get(deviceId);
    if (!device) return false;

    device.revoked = true;
    const partnerId = device.pairedWithId;
    device.pairedWithId = undefined;

    if (partnerId) {
      const partner = this.devices.get(partnerId);
      if (partner) {
        partner.pairedWithId = undefined;
      }
    }

    this.saveToDisk();
    return true;
  }

  /**
   * Retrieves a device by ID.
   */
  public getDevice(deviceId: string): Device | undefined {
    return this.devices.get(deviceId);
  }

  /**
   * Clean up expired pairing sessions.
   */
  public pruneExpiredSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.pairingSessions.entries()) {
      if (session.used || now > session.expiresAt) {
        this.pairingSessions.delete(id);
      }
    }
  }

  /**
   * Clear all (useful for test isolation).
   */
  public clear(): void {
    this.devices.clear();
    this.pairingSessions.clear();
    if (this.persistPath && fs.existsSync(this.persistPath)) {
      try {
        fs.unlinkSync(this.persistPath);
      } catch {}
    }
  }
}

export const deviceStore = new DeviceStore();
