import {
  carrierRegistry,
  GMAIL_PACKAGE_NAME,
  ARCHIVED_CARRIER_PACKAGES
} from './carrier-registry';

export interface TargetApp {
  packageName: string;
  appName: string;
}

export interface ServiceMatchEvaluation {
  isAllowed: boolean;
  serviceName: string;
  carrierTag?: string;
  matchedTargetApp?: TargetApp;
  reason?: string;
}

export interface EvaluateMatchOptions {
  packageName: string;
  title?: string;
  text?: string;
  carrierPackages?: string[];
  targetApps: TargetApp[];
  allowlistedPackages?: string[];
  forwardAllCarriers: boolean;
}

export class ServiceMatcher {
  /**
   * Checks whether the given package is recognized as an active carrier
   * (Default SMS, enabled Other SMS, or enabled Gmail).
   * Explicitly rejects all archived carriers.
   */
  public static isCarrier(packageName: string, carrierPackages?: string[]): boolean {
    if (!packageName || ARCHIVED_CARRIER_PACKAGES.has(packageName)) {
      return false;
    }
    if (carrierPackages && carrierPackages.includes(packageName)) {
      return true;
    }
    return carrierRegistry.isCarrierAllowed(packageName);
  }

  /**
   * Returns a concise human-readable carrier tag (e.g. "via SMS", "via Gmail").
   */
  public static getCarrierTag(packageName: string): string {
    if (packageName === GMAIL_PACKAGE_NAME || packageName.includes('gmail')) {
      return 'via Gmail';
    }
    return 'via SMS';
  }

  /**
   * Normalizes an SMS or Email sender title (e.g. Indian TRAI prefix "AX-SWIGGY" -> "SWIGGY", "Google <no-reply@...>" -> "Google").
   */
  public static cleanSenderTitle(title?: string): string {
    if (!title) return '';
    let trimmed = title.trim();

    // Email sender format: "Service Name <noreply@domain.com>"
    const emailHeaderMatch = trimmed.match(/^([^<]+)\s*<.*?>$/);
    if (emailHeaderMatch && emailHeaderMatch[1]) {
      trimmed = emailHeaderMatch[1].trim();
    }

    // Bare email address: "no-reply@uber.com" -> "Uber"
    const bareEmailMatch = trimmed.match(/^(?:[a-zA-Z0-9._%+-]+)@([a-zA-Z0-9-]+)\.[a-zA-Z]{2,}$/);
    if (bareEmailMatch && bareEmailMatch[1]) {
      const domainName = bareEmailMatch[1];
      if (!/^(gmail|googlemail|yahoo|hotmail|outlook|proton|icloud|mail)$/i.test(domainName)) {
        trimmed = domainName.charAt(0).toUpperCase() + domainName.slice(1);
      }
    }

    // TRAI format: 2-letter circle prefix followed by hyphen (e.g., "VM-HDFCBK", "AX-SWIGGY", "VK-AMAZON")
    const traiMatch = trimmed.match(/^[A-Za-z]{2}-([A-Za-z0-9_-]+)$/);
    if (traiMatch && traiMatch[1]) {
      return traiMatch[1];
    }

    return trimmed;
  }

  /**
   * Extracts the most likely service or company name from an SMS or email message.
   */
  public static extractServiceNameFromContent(title?: string, text?: string): string {
    const cleanTitle = this.cleanSenderTitle(title);

    // If clean title is a distinct name (not generic "Messages", "SMS", "Gmail", "No-reply", or bare number)
    const isGenericTitle = !cleanTitle ||
      /^(messages?|sms|chat|notification|verification|otp|new message|gmail|email|mail|no[- ]?reply|alerts?|\+?\d+)$/i.test(cleanTitle) ||
      cleanTitle.includes('@');

    if (!isGenericTitle && cleanTitle.length >= 2) {
      return cleanTitle;
    }

    // Try extracting service name from notification body text
    if (text) {
      const patterns = [
        // "Your Amazon verification code is..." or "Your Amazon temporary sign-in code is..."
        /(?:your|the)\s+([A-Za-z0-9]{3,20})\s+(?:verification|security|login|otp|passcode|code|(?:temporary\s+)?sign[- ]in\s+code)/i,
        // "OTP for Swiggy login is..."
        /(?:otp|code|verification|passcode)\s+(?:for|on)\s+([A-Za-z0-9]{3,20})/i,
        // "Swiggy OTP: 123456"
        /\b([A-Za-z0-9]{3,20})\s+(?:otp|verification|security\s+code)/i,
        // "use 123456 to verify your Uber account"
        /(?:verify|access|login to)\s+(?:your\s+)?([A-Za-z0-9]{3,20})\s+(?:account|app)?/i,
        // "Welcome to Uber! Your code is..."
        /(?:welcome to|sign in to|login to)\s+([A-Za-z0-9]{3,20})/i
      ];

      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const candidate = match[1].trim();
          // Skip common stop words
          if (!/^(your|this|bank|code|phone|device|account|service|login|transaction|verification|temporary|security|customer|notification|authentication)$/i.test(candidate)) {
            return candidate.charAt(0).toUpperCase() + candidate.slice(1);
          }
        }
      }
    }

    return cleanTitle || 'SMS';
  }

  /**
   * Evaluates an incoming notification against dynamic carriers, explicit allowlist, and target apps.
   */
  public static evaluate(options: EvaluateMatchOptions): ServiceMatchEvaluation {
    const {
      packageName,
      title = '',
      text = '',
      carrierPackages,
      targetApps,
      allowlistedPackages = [],
      forwardAllCarriers
    } = options;

    // Reject archived carriers explicitly
    if (ARCHIVED_CARRIER_PACKAGES.has(packageName)) {
      return {
        isAllowed: false,
        serviceName: packageName,
        reason: 'Archived carrier is excluded from active execution'
      };
    }

    // Check if package is an active universal carrier (Default SMS, Other SMS, or Gmail)
    const isCarrierApp = this.isCarrier(packageName, carrierPackages);

    // CASE 1: Arriving from an active carrier
    if (isCarrierApp) {
      // Safe handling of hidden/redacted/empty notification content
      if (!text || text.trim() === '' || text.includes('Sensitive notification content hidden')) {
        return {
          isAllowed: false,
          serviceName: this.cleanSenderTitle(title) || 'Carrier Service',
          carrierTag: this.getCarrierTag(packageName),
          reason: 'Notification content is hidden or inaccessible'
        };
      }

      const carrierTag = this.getCarrierTag(packageName);
      const cleanSender = this.cleanSenderTitle(title);
      const combinedText = `${cleanSender} ${title} ${text}`.toLowerCase();

      // Check if this carrier message matches any target app selected by user
      for (const target of targetApps) {
        if (this.doesContentMatchApp(combinedText, cleanSender, target)) {
          return {
            isAllowed: true,
            serviceName: target.appName,
            carrierTag,
            matchedTargetApp: target
          };
        }
      }

      // If user did not match any specific target app
      if (forwardAllCarriers || targetApps.length === 0) {
        const detectedName = this.extractServiceNameFromContent(title, text);
        return {
          isAllowed: true,
          serviceName: detectedName,
          carrierTag
        };
      }

      return {
        isAllowed: false,
        serviceName: cleanSender || 'Unlisted Service',
        carrierTag,
        reason: 'Notification does not match any selected target application'
      };
    }

    // CASE 2: Arriving directly from an application itself
    const directTargetMatch = targetApps.find((t) => t.packageName === packageName);
    if (directTargetMatch) {
      return {
        isAllowed: true,
        serviceName: directTargetMatch.appName
      };
    }

    // Check backwards-compatibility explicit allowlist
    if (allowlistedPackages.includes(packageName)) {
      return {
        isAllowed: true,
        serviceName: packageName.split('.').pop() || packageName
      };
    }

    return {
      isAllowed: false,
      serviceName: packageName.split('.').pop() || packageName,
      reason: 'Package not in explicit allowlist'
    };
  }

  private static doesContentMatchApp(combinedText: string, cleanSender: string, target: TargetApp): boolean {
    const appNameLower = target.appName.toLowerCase();
    const pkgLower = target.packageName.toLowerCase();

    // 1. Direct sender header match (e.g. cleanSender "SWIGGY" contains or equals "swiggy")
    if (cleanSender) {
      const senderLower = cleanSender.toLowerCase();
      if (senderLower.includes(appNameLower) || appNameLower.includes(senderLower)) {
        return true;
      }
    }

    // 2. Extract key terms from app name (e.g., "Amazon Shopping" -> "amazon", "Uber - Driver" -> "uber")
    const appWords = appNameLower
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !/^(the|and|for|app|pro|free|mobile|android)$/.test(w));

    for (const word of appWords) {
      const regex = new RegExp(`\\b${word}\\b`, 'i');
      if (regex.test(combinedText)) {
        return true;
      }
    }

    // 3. Match package distinct tokens (e.g. in.swiggy.android -> "swiggy", com.ubercab -> "ubercab" or "uber")
    const pkgTokens = pkgLower
      .split('.')
      .filter((token) => token.length >= 4 && !/^(com|org|net|android|apps|mobile|google)$/.test(token));

    for (const token of pkgTokens) {
      if (combinedText.includes(token)) {
        return true;
      }
    }

    return false;
  }
}
