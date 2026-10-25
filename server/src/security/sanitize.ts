/**
 * Security & Sanitization utilities.
 * Ensures OTP values and full sensitive notification bodies are never logged.
 */

const OTP_PATTERNS = [
  /\b\d{4,8}\b/g,
  /\b[A-Z0-9]{3,4}[-\s]?[A-Z0-9]{3,4}\b/gi
];

/**
 * Redacts any potential OTP code or sensitive numeric payload from string.
 */
export function redactSensitiveData(text: string): string {
  if (!text) return '';
  let sanitized = text;
  for (const pattern of OTP_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED_CODE]');
  }
  return sanitized;
}

/**
 * Creates safe log metadata for a message event without exposing the OTP.
 */
export function formatSafeMessageLog(meta: {
  messageId: string;
  senderId: string;
  receiverId?: string;
  packageName: string;
  status: string;
}): string {
  return `[MSG_EVENT] id=${meta.messageId} sender=${meta.senderId} receiver=${meta.receiverId || 'none'} pkg=${meta.packageName} status=${meta.status}`;
}
