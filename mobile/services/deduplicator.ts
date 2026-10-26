const DEFAULT_DEDUP_WINDOW_MS = 60000;
const MAX_CACHE_ENTRIES = 1000;

export class NotificationDeduplicator {
  private cache = new Map<string, number>();

  /**
   * Generates a stable, content-aware deduplication key for an incoming notification.
   * Normalizes whitespace, strips invisible control characters, and incorporates content
   * so that distinct messages sharing an Android notification ID (e.g. id=0) are not falsely suppressed.
   */
  public generateKey(packageName: string, title = '', text = '', id = ''): string {
    const pkg = (packageName || '').trim().toLowerCase();
    const cleanTitle = this.normalizeString(title);
    const cleanText = this.normalizeString(text);

    if (id) {
      return `${pkg}:${id}:${cleanTitle}:${cleanText}`;
    }
    return `${pkg}:${cleanTitle}:${cleanText}`;
  }

  /**
   * Checks whether the notification is a duplicate within the given time window (default 60s).
   * If not duplicate, records the current timestamp and returns false.
   */
  public isDuplicate(key: string, windowMs = DEFAULT_DEDUP_WINDOW_MS): boolean {
    const now = Date.now();
    this.prune(now, windowMs);

    const lastSeen = this.cache.get(key);
    if (lastSeen !== undefined && now - lastSeen < windowMs) {
      return true;
    }

    this.cache.set(key, now);
    return false;
  }

  /**
   * Inspects whether a key is currently cached as duplicate without updating its timestamp.
   */
  public peek(key: string, windowMs = DEFAULT_DEDUP_WINDOW_MS): boolean {
    const lastSeen = this.cache.get(key);
    if (lastSeen === undefined) return false;
    return Date.now() - lastSeen < windowMs;
  }

  /**
   * Returns current number of active entries in cache.
   */
  public get size(): number {
    return this.cache.size;
  }

  /**
   * Prunes entries older than the time window, with hard cap enforcement.
   */
  private prune(now: number, windowMs: number): void {
    // 1. Time-based pruning
    for (const [key, timestamp] of this.cache.entries()) {
      if (now - timestamp > windowMs) {
        this.cache.delete(key);
      }
    }

    // 2. Capacity-based pruning (oldest first) if cache exceeds limit
    if (this.cache.size > MAX_CACHE_ENTRIES) {
      const excess = this.cache.size - MAX_CACHE_ENTRIES;
      const iterator = this.cache.keys();
      for (let i = 0; i < excess; i++) {
        const next = iterator.next();
        if (next.done) break;
        this.cache.delete(next.value);
      }
    }
  }

  /**
   * Normalizes whitespace, removes zero-width/control characters, and trims.
   */
  private normalizeString(input: string): string {
    return (input || '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // remove zero-width characters
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Clears all cached keys.
   */
  public clear(): void {
    this.cache.clear();
  }
}

export const notificationDeduplicator = new NotificationDeduplicator();

