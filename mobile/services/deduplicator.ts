export class NotificationDeduplicator {
  private cache = new Map<string, number>();

  /**
   * Generates a stable key for a notification.
   */
  public generateKey(packageName: string, title = '', text = '', id = ''): string {
    if (id) {
      return `${packageName}:${id}`;
    }
    // Clean string to normalize minor whitespace differences
    const normalizedBody = text.trim().replace(/\s+/g, ' ');
    return `${packageName}:${title}:${normalizedBody}`;
  }

  /**
   * Checks whether the notification is a duplicate within the given time window (default 60s).
   * If not duplicate, records the current timestamp and returns false.
   */
  public isDuplicate(key: string, windowMs = 60000): boolean {
    const now = Date.now();
    this.prune(now, windowMs);

    const lastSeen = this.cache.get(key);
    if (lastSeen && now - lastSeen < windowMs) {
      return true;
    }

    this.cache.set(key, now);
    return false;
  }

  /**
   * Prunes entries older than the time window.
   */
  private prune(now: number, windowMs: number): void {
    for (const [key, timestamp] of this.cache.entries()) {
      if (now - timestamp > windowMs) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cached keys.
   */
  public clear(): void {
    this.cache.clear();
  }
}

export const notificationDeduplicator = new NotificationDeduplicator();
