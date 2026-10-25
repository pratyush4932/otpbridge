import { config } from '../config.js';

export interface QueuedMessage {
  id: string;
  senderId: string;
  receiverId: string;
  packageName: string;
  title?: string;
  serviceName?: string;
  carrierTag?: string;
  otpCode: string;
  bodySnippet?: string;
  timestamp: number;
  enqueuedAt: number;
  expiresAt: number;
}

export class EphemeralMessageQueue {
  // receiverId -> list of queued messages
  private queues = new Map<string, QueuedMessage[]>();
  // deduplication cache: messageHashOrId -> expiryTimestamp
  private seenMessages = new Map<string, number>();

  /**
   * Enqueues an OTP message for an offline receiver.
   * Auto-prunes expired messages and enforces max queue size.
   */
  public enqueue(
    message: Omit<QueuedMessage, 'enqueuedAt' | 'expiresAt'>,
    ttlSeconds = config.MESSAGE_QUEUE_TTL_SECONDS,
    maxPerReceiver = config.MAX_QUEUED_MESSAGES_PER_RECEIVER
  ): boolean {
    this.prune();

    // Deduplication check
    const dedupKey = `${message.senderId}:${message.id}`;
    if (this.isDuplicate(dedupKey)) {
      return false;
    }

    const now = Date.now();
    const expiresAt = now + ttlSeconds * 1000;
    const queuedItem: QueuedMessage = {
      ...message,
      enqueuedAt: now,
      expiresAt
    };

    let receiverQueue = this.queues.get(message.receiverId);
    if (!receiverQueue) {
      receiverQueue = [];
      this.queues.set(message.receiverId, receiverQueue);
    }

    // If queue exceeds maximum size, drop the oldest message
    if (receiverQueue.length >= maxPerReceiver) {
      receiverQueue.shift();
    }

    receiverQueue.push(queuedItem);
    this.seenMessages.set(dedupKey, expiresAt);
    return true;
  }

  /**
   * Retrieves and removes all pending messages for a receiver upon reconnect.
   */
  public flushForReceiver(receiverId: string): QueuedMessage[] {
    this.prune();
    const messages = this.queues.get(receiverId) || [];
    this.queues.delete(receiverId);
    return messages;
  }

  /**
   * Returns pending messages for inspection without removing them.
   */
  public peekForReceiver(receiverId: string): QueuedMessage[] {
    this.prune();
    return this.queues.get(receiverId) || [];
  }

  /**
   * Checks whether a message key is seen recently to avoid duplicate processing.
   */
  public isDuplicate(dedupKey: string): boolean {
    const expiresAt = this.seenMessages.get(dedupKey);
    if (!expiresAt) return false;
    if (Date.now() > expiresAt) {
      this.seenMessages.delete(dedupKey);
      return false;
    }
    return true;
  }

  /**
   * Prunes all expired messages and deduplication entries.
   */
  public prune(): void {
    const now = Date.now();

    for (const [receiverId, items] of this.queues.entries()) {
      const active = items.filter(item => now <= item.expiresAt);
      if (active.length === 0) {
        this.queues.delete(receiverId);
      } else {
        this.queues.set(receiverId, active);
      }
    }

    for (const [key, expiresAt] of this.seenMessages.entries()) {
      if (now > expiresAt) {
        this.seenMessages.delete(key);
      }
    }
  }

  /**
   * Clear all queued data (for testing isolation).
   */
  public clear(): void {
    this.queues.clear();
    this.seenMessages.clear();
  }
}

export const ephemeralMessageQueue = new EphemeralMessageQueue();
