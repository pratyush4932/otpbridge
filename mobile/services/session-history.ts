import { StorageService } from './storage';

export type SessionEventType =
  | 'pairing_created'
  | 'qr_generated'
  | 'qr_regenerated'
  | 'pairing_attempt'
  | 'pairing_completed'
  | 'connection_established'
  | 'connection_lost'
  | 'connection_restored'
  | 'pairing_expired'
  | 'device_unlinked'
  | 'session_ended';

export interface SessionEvent {
  id: string;
  sessionId: string;
  type: SessionEventType;
  title: string;
  detail?: string;
  timestamp: number;
  status: 'success' | 'warning' | 'error' | 'info';
}

export interface PairingSession {
  sessionId: string;
  isActive: boolean;
  role: 'sender' | 'receiver' | 'unassigned';
  pairedWithId?: string | null;
  startedAt: number;
  endedAt?: number;
  events: SessionEvent[];
}

const STORAGE_SESSION_HISTORY_KEY = 'otp_bridge_session_history_v1';
const MAX_STORED_EVENTS = 50;

export class SessionHistoryService {
  private currentSessionId: string | null = null;
  private events: SessionEvent[] = [];
  private listeners = new Set<(events: SessionEvent[]) => void>();
  private isLoaded = false;
  private loadPromise: Promise<void> | null = null;
  private lastRecordedType: string | null = null;
  private lastRecordedTime = 0;
  private wasExplicitlyCleared = false;

  constructor() {
    this.loadHistory();
  }

  public async loadHistory(): Promise<void> {
    if (this.isLoaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        const raw = await StorageService.getRawItem(STORAGE_SESSION_HISTORY_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            this.events = parsed;
          } else if (parsed && Array.isArray(parsed.events)) {
            this.events = parsed.events;
            this.currentSessionId = parsed.currentSessionId || null;
          }
        }
      } catch {
        this.events = [];
      } finally {
        this.isLoaded = true;
        this.loadPromise = null;
        await this.ensureActiveSessionRecorded();
        this.notifyListeners();
      }
    })();

    return this.loadPromise;
  }

  public async ensureActiveSessionRecorded(): Promise<void> {
    const creds = await StorageService.getCredentials();
    if (creds.pairedWithId && this.events.length === 0) {
      const partnerRole = creds.role === 'sender' ? 'Receiver' : 'Sender';
      const serverDisplay = creds.serverUrl ? creds.serverUrl.replace(/^https?:\/\//, '') : 'relay server';

      const now = Date.now();
      const baseSessionId = creds.pairedWithId.substring(0, 8);
      this.currentSessionId = `sess_${baseSessionId}`;

      const pairingEvent: SessionEvent = {
        id: `evt_${now - 1000}_init1`,
        sessionId: this.currentSessionId,
        type: 'pairing_completed',
        title: 'Pairing completed',
        detail: `Paired with ${partnerRole}`,
        timestamp: now - 1000,
        status: 'success'
      };

      const connEvent: SessionEvent = {
        id: `evt_${now}_init2`,
        sessionId: this.currentSessionId,
        type: 'connection_established',
        title: 'Connection established',
        detail: `Secure bridge active on ${serverDisplay}`,
        timestamp: now,
        status: 'success'
      };

      this.events = [connEvent, pairingEvent];
      await this.persist();
      this.notifyListeners();
    }
  }

  private async persist(): Promise<void> {
    try {
      const data = JSON.stringify({
        currentSessionId: this.currentSessionId,
        cleared: this.wasExplicitlyCleared,
        events: this.events.slice(0, MAX_STORED_EVENTS)
      });
      await StorageService.setRawItem(STORAGE_SESSION_HISTORY_KEY, data);
    } catch {
      // Storage failure non-fatal
    }
  }

  private notifyListeners(): void {
    const list = [...this.events];
    for (const listener of this.listeners) {
      try {
        listener(list);
      } catch {
        // ignore listener errors
      }
    }
  }

  public onHistoryChange(listener: (events: SessionEvent[]) => void): () => void {
    this.listeners.add(listener);
    if (this.events.length > 0) {
      try {
        listener([...this.events]);
      } catch {
        // ignore
      }
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async getActiveSessionId(): Promise<string> {
    if (this.currentSessionId) return this.currentSessionId;
    const creds = await StorageService.getCredentials();
    const id = creds.pairedWithId
      ? `sess_${creds.pairedWithId.substring(0, 8)}`
      : `sess_${Date.now().toString(36)}`;
    this.currentSessionId = id;
    return id;
  }

  public async recordEvent(
    type: SessionEventType,
    title: string,
    detail?: string,
    statusOverride?: 'success' | 'warning' | 'error' | 'info'
  ): Promise<SessionEvent> {
    if (!this.isLoaded) {
      await this.loadHistory();
    }

    // Debounce duplicate connection event fluttering (within 4 seconds)
    const now = Date.now();
    if (
      (type === 'connection_established' || type === 'connection_lost') &&
      this.lastRecordedType === type &&
      now - this.lastRecordedTime < 4000 &&
      this.events.length > 0
    ) {
      return this.events[0];
    }

    this.lastRecordedType = type;
    this.lastRecordedTime = now;

    let status: 'success' | 'warning' | 'error' | 'info' = 'info';
    switch (type) {
      case 'pairing_completed':
      case 'connection_established':
      case 'connection_restored':
        status = 'success';
        break;
      case 'pairing_expired':
      case 'connection_lost':
        status = 'warning';
        break;
      case 'device_unlinked':
      case 'session_ended':
        status = 'error';
        break;
      default:
        status = 'info';
    }

    if (statusOverride) {
      status = statusOverride;
    }

    const sessionId = await this.getActiveSessionId();
    const event: SessionEvent = {
      id: `evt_${now}_${Math.random().toString(36).substring(2, 6)}`,
      sessionId,
      type,
      title,
      detail,
      timestamp: now,
      status
    };

    this.wasExplicitlyCleared = false;
    this.events = [event, ...this.events.slice(0, MAX_STORED_EVENTS - 1)];

    if (type === 'device_unlinked' || type === 'session_ended') {
      this.currentSessionId = null;
    }

    await this.persist();
    this.notifyListeners();
    return event;
  }

  public getEvents(): SessionEvent[] {
    return [...this.events];
  }

  public async clearHistory(): Promise<void> {
    if (!this.isLoaded) {
      await this.loadHistory();
    }
    this.events = [];
    this.currentSessionId = null;
    this.lastRecordedType = null;
    this.lastRecordedTime = 0;
    this.wasExplicitlyCleared = true;
    await this.persist();
    this.notifyListeners();
  }
}

export const sessionHistoryService = new SessionHistoryService();
