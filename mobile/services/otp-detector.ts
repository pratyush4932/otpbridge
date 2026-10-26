export interface OtpDetectionResult {
  isOtp: boolean;
  code?: string;
  confidence: 'high' | 'medium' | 'none';
  contextSnippet?: string;
  score?: number;
}

interface ScoredCandidate {
  code: string;
  rawCode: string;
  index: number;
  length: number;
  score: number;
  confidence: 'high' | 'medium' | 'none';
}

/**
 * Positive keywords and phrases strongly indicating an authentic OTP context.
 */
const OTP_CONTEXT_KEYWORDS = [
  /\botp\b/i,
  /\bone[- ]time\s+(?:password|passcode|code|pin)\b/i,
  /\bverification\s+code\b/i,
  /\baccount\s+verification\b/i,
  /\bdevice\s+verification\b/i,
  /\bsecurity\s+code\b/i,
  /\blogin\s+code\b/i,
  /\b(?:your\s+)?(?:temporary\s+)?sign[- ]in\s+code\b/i,
  /\btemporary\s+(?:passcode|code|pin|access)\b/i,
  /\bauth(entication)?\s+code\b/i,
  /\bsecret\s+code\b/i,
  /\baccess\s+code\b/i,
  /\bconfirm(ation)?\s+code\b/i,
  /\bpasscode\b/i,
  /\bpin\b/i,
  /\b2fa\b/i,
  /\btwo[- ]factor\b/i,
  /\b2[- ]step\b/i,
  /\btwo[- ]step\b/i,
  /\btransaction\s+authorization\b/i,
  /\bauthorize\s+(?:your\s+)?(?:transaction|payment|purchase|login|session)\b/i,
  /\bverify\s+(?:your\s+)?(?:identity|account|device|phone|email|number|login)\b/i
];

/**
 * Supporting security phrases that indicate legitimate authentication messages.
 */
const SUPPORTING_SECURITY_PHRASES = [
  /\bdo\s+not\s+share\b/i,
  /\bnever\s+share\b/i,
  /\bdon'?t\s+share\b/i,
  /\bvalid\s+for\b/i,
  /\bexpires\s+(?:in|after)\b/i,
  /\bfor\s+your\s+security\b/i,
  /\bto\s+complete\s+your\s+(?:login|sign[- ]in|registration|request)\b/i
];

/**
 * Negative contexts where the word "code" or numbers refer to non-OTP concepts.
 */
const NEGATIVE_CONTEXT_PATTERNS = [
  /\b(?:zip|postal|area|country|std|isd)\s+code\b/i,
  /\b(?:promo|promotional|discount|coupon|voucher|referral|gift)\s+code\b/i,
  /\b(?:tracking|order|shipment|consignment)\s+(?:code|number|id|#)\b/i,
  /\b(?:product|item|part|model|sku)\s+(?:code|number|id|#)\b/i,
  /\b(?:error|status|fault|http|exit|response)\s+(?:code|#)\b/i
];

/**
 * Known provider-specific prefixed code patterns (e.g. G-123456, VK-987654).
 */
const PREFIXED_CODE_REGEX = /\b([A-Za-z]{1,4})-(\d{4,8})\b/g;

/**
 * Standard numeric OTP candidate pattern (4 to 8 digits).
 */
const NUMERIC_CANDIDATE_REGEX = /\b(\d{4,8})\b/g;

/**
 * Threshold scores for classification.
 */
const SCORE_HIGH_THRESHOLD = 55;
const SCORE_MEDIUM_THRESHOLD = 30;

/**
 * Detects whether a notification contains an authentic OTP code.
 * Evaluates and scores all candidates, selecting the best match while rejecting false positives.
 */
export function detectOtp(title?: string, text?: string): OtpDetectionResult {
  const content = [title, text].filter(Boolean).join(' ').trim();
  if (!content) {
    return { isOtp: false, confidence: 'none' };
  }

  // Quick check for negative context across the entire message
  const hasGlobalNegativeContext = NEGATIVE_CONTEXT_PATTERNS.some((pat) => pat.test(content));
  const hasGlobalOtpContext = OTP_CONTEXT_KEYWORDS.some((kw) => kw.test(content));
  const hasGlobalSecurityContext = SUPPORTING_SECURITY_PHRASES.some((kw) => kw.test(content));

  const candidates: ScoredCandidate[] = [];

  // 1. Collect and score prefixed candidates (e.g., G-629104, VK-482019)
  const prefixedMatches = content.matchAll(PREFIXED_CODE_REGEX);
  for (const match of prefixedMatches) {
    if (match.index === undefined) continue;
    const prefix = match[1].toUpperCase();
    const digits = match[2];
    const fullCode = `${prefix}-${digits}`;

    // Discard if candidate span overlaps with a known false positive
    if (isCandidateWithinFalsePositiveSpan(content, match.index, fullCode.length)) {
      continue;
    }

    const score = scoreCandidate({
      fullText: content,
      candidateCode: fullCode,
      digitsOnly: digits,
      startIndex: match.index,
      length: fullCode.length,
      isPrefixed: true,
      hasGlobalOtpContext,
      hasGlobalSecurityContext,
      hasGlobalNegativeContext
    });

    if (score >= SCORE_MEDIUM_THRESHOLD) {
      candidates.push({
        code: fullCode,
        rawCode: fullCode,
        index: match.index,
        length: fullCode.length,
        score,
        confidence: score >= SCORE_HIGH_THRESHOLD ? 'high' : 'medium'
      });
    }
  }

  // 2. Collect and score pure numeric candidates (4 to 8 digits)
  const numericMatches = content.matchAll(NUMERIC_CANDIDATE_REGEX);
  for (const match of numericMatches) {
    if (match.index === undefined) continue;
    const digits = match[1];

    // Avoid double-matching digits that belong to a prefixed code (e.g. 629104 in G-629104)
    if (match.index > 0 && content[match.index - 1] === '-') {
      continue;
    }

    // Discard if candidate span overlaps with currency, time, date, phone, or order ID
    if (isCandidateWithinFalsePositiveSpan(content, match.index, digits.length)) {
      continue;
    }

    const score = scoreCandidate({
      fullText: content,
      candidateCode: digits,
      digitsOnly: digits,
      startIndex: match.index,
      length: digits.length,
      isPrefixed: false,
      hasGlobalOtpContext,
      hasGlobalSecurityContext,
      hasGlobalNegativeContext
    });

    if (score >= SCORE_MEDIUM_THRESHOLD) {
      candidates.push({
        code: digits,
        rawCode: digits,
        index: match.index,
        length: digits.length,
        score,
        confidence: score >= SCORE_HIGH_THRESHOLD ? 'high' : 'medium'
      });
    }
  }

  if (candidates.length === 0) {
    return { isOtp: false, confidence: 'none' };
  }

  // Sort candidates by score descending, then by position (earlier in message if tied)
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  const best = candidates[0];

  return {
    isOtp: true,
    code: best.code,
    confidence: best.confidence,
    contextSnippet: extractSnippet(content, best.index, best.length),
    score: best.score
  };
}

interface ScoreCandidateParams {
  fullText: string;
  candidateCode: string;
  digitsOnly: string;
  startIndex: number;
  length: number;
  isPrefixed: boolean;
  hasGlobalOtpContext: boolean;
  hasGlobalSecurityContext: boolean;
  hasGlobalNegativeContext: boolean;
}

/**
 * Computes an evidence-based confidence score (0 to 100) for a candidate code.
 */
function scoreCandidate(params: ScoreCandidateParams): number {
  const {
    fullText,
    digitsOnly,
    startIndex,
    length,
    isPrefixed,
    hasGlobalOtpContext,
    hasGlobalSecurityContext,
    hasGlobalNegativeContext
  } = params;

  let score = 0;

  // Local proximity windows
  const preWindow = fullText.substring(Math.max(0, startIndex - 50), startIndex);
  const postWindow = fullText.substring(startIndex + length, Math.min(fullText.length, startIndex + length + 50));

  // 1. Baseline points for candidate format
  if (isPrefixed) {
    score += 65; // Prefixed formats (e.g. G-XXXXXX) are very strong signals
  } else {
    // 6 digits is the standard OTP length globally; 4-8 are also valid
    if (digitsOnly.length === 6) {
      score += 25;
    } else if (digitsOnly.length === 4) {
      score += 18;
    } else {
      score += 20;
    }
  }

  // 2. Immediate explicit code label matches (high confidence indicators)
  const explicitPrePatterns = [
    /(?:code|otp|pin|passcode|token|is)[:=\s-]+$/i,
    /(?:your|the)\s+(?:verification|security|login|sign[- ]in|temporary)\s+(?:code|passcode)\s+(?:is\s+)?[:=-]?\s*$/i,
    /(?:temporary\s+)?sign[- ]in\s+code\s+(?:is\s+)?[:=-]?\s*$/i,
    /\buse\s+$/i
  ];

  const hasExplicitPre = explicitPrePatterns.some((p) => p.test(preWindow));
  if (hasExplicitPre) {
    score += 35;
  }

  const explicitPostPatterns = [
    /^\s*[-:]?\s*is\s+your\s+(?:verification|security|login|otp|passcode|(?:temporary\s+)?sign[- ]in|one[- ]time|account)/i,
    /^\s+to\s+(?:verify|login|authenticate|confirm|sign[- ]in|access|authorize)/i,
    /^\s*[-:]?\s*is\s+(?:the\s+)?(?:otp|code|passcode|pin)/i
  ];

  const hasExplicitPost = explicitPostPatterns.some((p) => p.test(postWindow));
  if (hasExplicitPost) {
    score += 35;
  }

  // 3. Positive OTP keywords in local context
  const localText = `${preWindow} ${postWindow}`;
  const hasLocalOtpContext = OTP_CONTEXT_KEYWORDS.some((kw) => kw.test(localText));
  if (hasLocalOtpContext) {
    score += 20;
  } else if (hasGlobalOtpContext) {
    score += 10;
  }

  // 4. Supporting security and anti-phishing phrases
  const hasLocalSecurity = SUPPORTING_SECURITY_PHRASES.some((p) => p.test(localText));
  if (hasLocalSecurity) {
    score += 15;
  } else if (hasGlobalSecurityContext) {
    score += 8;
  }

  // 5. Penalties for weak or false-positive indicators

  // Repetitive trivial digits (e.g. 0000, 111111)
  if (/^(\d)\1+$/.test(digitsOnly)) {
    score -= 45; // Strongly penalize identical digits
  }

  // Sequential digits (e.g. 1234, 123456, 654321)
  if (isSequential(digitsOnly)) {
    score -= 20;
  }

  // Calendar year check (1970 to 2035) without explicit code labeling
  const numVal = parseInt(digitsOnly, 10);
  if (digitsOnly.length === 4 && numVal >= 1970 && numVal <= 2035) {
    if (!hasExplicitPre && !hasExplicitPost) {
      score -= 40;
    }
  }

  // Negative context (zip code, area code, promo code) nearby
  const hasLocalNegative = NEGATIVE_CONTEXT_PATTERNS.some((p) => p.test(localText));
  if (hasLocalNegative) {
    score -= 50;
  } else if (hasGlobalNegativeContext && !hasExplicitPre && !hasExplicitPost) {
    score -= 25;
  }

  return score;
}

/**
 * Checks if a candidate's span overlaps with false-positive structures:
 * prices, times, dates, phone numbers, order IDs, or percentages.
 */
function isCandidateWithinFalsePositiveSpan(fullText: string, startIndex: number, length: number): boolean {
  const endIndex = startIndex + length;

  // Patterns that define non-OTP structures
  const spanPatterns: RegExp[] = [
    // Prices / Currency: $100, 100 USD, EUR 50, ₹ 500, etc.
    /(?:[\$€£¥₹]|USD|EUR|GBP|INR|CAD|AUD)\s*\d+(?:\.\d{2})?/gi,
    /\d+(?:\.\d{2})?\s*(?:USD|EUR|GBP|INR|CAD|AUD)/gi,

    // Times: 14:30, 9:45 am, 10:00pm
    /\b\d{1,2}:\d{2}(?:\s*(?:am|pm))?\b/gi,

    // Dates: 2026-10-24, 24/10/2026, 10-24-2026
    /\b\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b/g,

    // Phone numbers: +1..., (555) 000-0000, 10+ continuous digits
    /(?:\+\d{1,3}[- ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}/g,
    /\b\d{10,}\b/g,

    // Order / tracking / invoice numbers: Order #12345, Tracking #98765
    /\b(?:order|tracking|invoice|receipt|shipment|account|ticket)\s*(?:#|no\.?|num(?:ber)?)\s*[:]?\s*([0-9A-Za-z]+)/gi,

    // Percentages: 20%, 50 %
    /\b\d+(?:[.]\d+)?\s*%/g
  ];

  for (const pattern of spanPatterns) {
    const matches = fullText.matchAll(pattern);
    for (const match of matches) {
      if (match.index === undefined) continue;
      const mStart = match.index;
      const mEnd = match.index + match[0].length;

      // Check if candidate span overlaps with this false-positive span
      if (startIndex >= mStart && endIndex <= mEnd) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Checks whether a numeric string forms an ascending or descending sequence.
 */
function isSequential(digits: string): boolean {
  if (digits.length < 4) return false;
  let ascending = true;
  let descending = true;

  for (let i = 0; i < digits.length - 1; i++) {
    const curr = parseInt(digits[i], 10);
    const next = parseInt(digits[i + 1], 10);
    if (next !== curr + 1) ascending = false;
    if (next !== curr - 1) descending = false;
  }

  return ascending || descending;
}

/**
 * Extracts a concise snippet centered on the detected code without exposing unnecessary content.
 */
function extractSnippet(text: string, index: number, codeLength: number): string {
  const start = Math.max(0, index - 25);
  const end = Math.min(text.length, index + codeLength + 25);
  let snippet = text.substring(start, end).trim().replace(/\s+/g, ' ');
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  return snippet;
}

