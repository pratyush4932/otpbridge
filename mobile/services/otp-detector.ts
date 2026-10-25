export interface OtpDetectionResult {
  isOtp: boolean;
  code?: string;
  confidence: 'high' | 'medium' | 'none';
  contextSnippet?: string;
}

// Keywords that strongly indicate an OTP context
const OTP_CONTEXT_KEYWORDS = [
  /\bcode\b/i,
  /\botp\b/i,
  /\bverification\b/i,
  /\bpasscode\b/i,
  /\bpin\b/i,
  /\bone[- ]time\b/i,
  /\bsecurity code\b/i,
  /\blogin code\b/i,
  /\bauth(entication)? code\b/i,
  /\bsecret code\b/i,
  /\baccess code\b/i,
  /\b2fa\b/i,
  /\btwo[- ]factor\b/i,
  /\bconfirm(ation)? code\b/i,
  /\bverify\b/i,
  /\btoken\b/i
];

// Patterns that identify false-positive candidates to reject
const FALSE_POSITIVE_PATTERNS = [
  // Currencies / prices: $100, 100 USD, EUR 50, ₹ 500, etc.
  /(\$|€|£|¥|₹|USD|EUR|GBP|INR|CAD|AUD)\s*\d+(\.\d{2})?/i,
  /\d+(\.\d{2})?\s*(USD|EUR|GBP|INR|CAD|AUD)/i,

  // Times: 14:30, 9:45 am, 10:00pm
  /\b\d{1,2}:\d{2}(\s*(am|pm))?\b/i,

  // Standard dates: 2026-10-24, 24/10/2026, 10-24-2026
  /\b\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b/,

  // Phone numbers: +1..., (555) 000-0000, 10+ continuous digits
  /(\+\d{1,3}[- ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}/,
  /\b\d{10,}\b/,

  // Tracking / order numbers: Order #12345, Tracking #98765
  /\b(order|tracking|invoice|receipt|shipment|account|ticket)\s*(#|no\.?|num(ber)?)\s*[:]?\s*\d+/i,

  // Percentages: 20%, 50 %
  /\b\d+([.]\d+)?\s*%/
];

// High confidence prefixed code patterns (e.g. G-123456, VK-987654)
const PREFIXED_CODE_PATTERN = /\b(G|VK|FB|WA|ID|TW|MS|GH)-(\d{4,8})\b/i;

// Standard explicit OTP capture patterns near context keywords
const EXPLICIT_OTP_PATTERNS = [
  /(?:is|code[:=]?|otp[:=]?|pin[:=]?)\s*[:]?\s*([0-9]{4,8})\b/i,
  /\b([0-9]{4,8})\s*(?:is your (?:verification|security|login|otp|passcode))/i,
  /\buse\s+([0-9]{4,8})\s+to\s+(?:verify|login|authenticate|confirm)/i
];

/**
 * Detects whether a notification contains an authentic OTP code.
 * Rejects false positives (years, prices, order numbers, phone numbers).
 */
export function detectOtp(title?: string, text?: string): OtpDetectionResult {
  const content = [title, text].filter(Boolean).join(' ').trim();
  if (!content) {
    return { isOtp: false, confidence: 'none' };
  }

  // 1. Check for prefixed codes (e.g., Google G-123456)
  const prefixedMatch = content.match(PREFIXED_CODE_PATTERN);
  if (prefixedMatch && prefixedMatch[1] && prefixedMatch[2]) {
    const prefix = prefixedMatch[1].toUpperCase();
    const digits = prefixedMatch[2];
    if (isValidCode(digits, content, prefixedMatch.index)) {
      return {
        isOtp: true,
        code: `${prefix}-${digits}`,
        confidence: 'high',
        contextSnippet: extractSnippet(content, prefixedMatch.index || 0)
      };
    }
  }

  // 2. Check for explicit OTP statements: "is 839201", "code: 839201"
  for (const pattern of EXPLICIT_OTP_PATTERNS) {
    const match = content.match(pattern);
    if (match && match[1]) {
      const code = match[1];
      if (isValidCode(code, content)) {
        return {
          isOtp: true,
          code,
          confidence: 'high',
          contextSnippet: extractSnippet(content, match.index || 0)
        };
      }
    }
  }

  // 3. Must have OTP context keywords to accept generic numeric codes
  if (!hasOtpContext(content)) {
    return { isOtp: false, confidence: 'none' };
  }

  // 4. Extract 4-8 digit numbers that are NOT false positives
  const numericCandidates = content.matchAll(/\b([0-9]{4,8})\b/g);
  for (const candidate of numericCandidates) {
    const code = candidate[1];
    if (isValidCode(code, content, candidate.index)) {
      return {
        isOtp: true,
        code,
        confidence: 'medium',
        contextSnippet: extractSnippet(content, candidate.index || 0)
      };
    }
  }

  return { isOtp: false, confidence: 'none' };
}

function hasOtpContext(text: string): boolean {
  return OTP_CONTEXT_KEYWORDS.some((kw) => kw.test(text));
}

function isValidCode(code: string, fullText: string, index?: number): boolean {
  // Reject simple repetitive sequences (e.g. 0000, 1111)
  if (/^(\d)\1+$/.test(code)) {
    return false;
  }

  // Reject calendar years like 2024, 2025, 2026 unless explicitly marked as a code
  const num = parseInt(code, 10);
  if (code.length === 4 && num >= 1970 && num <= 2035) {
    // Only accept year-like number if immediately preceded by "code", "pin", or "otp"
    const isExplicitlyCode = /(code|pin|otp|is)\s*[:]?\s*$/i.test(
      fullText.substring(Math.max(0, (index || 0) - 10), index || 0)
    );
    if (!isExplicitlyCode) return false;
  }

  // Reject if part of a price or currency match
  for (const fp of FALSE_POSITIVE_PATTERNS) {
    const match = fullText.match(fp);
    if (match && match[0].includes(code)) {
      return false;
    }
  }

  return true;
}

function extractSnippet(text: string, index: number): string {
  const start = Math.max(0, index - 25);
  const end = Math.min(text.length, index + 35);
  let snippet = text.substring(start, end).trim();
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  return snippet;
}
