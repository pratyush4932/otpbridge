# Archived Carrier Implementations

This directory preserves legacy carrier implementations, configurations, tests, and documentation retired during the **Carrier Architecture Refactor (October 2026)**.

---

## 1. Archived Components Inventory

| Component | Original Location | Description | Reason for Archival |
|---|---|---|---|
| `ARCHIVED_KNOWN_UNIVERSAL_CARRIERS` | `mobile/services/storage.ts` | Static list of 7 hard-coded carriers including WhatsApp, Telegram, Truecaller, Samsung Messages, Google Messages | Replaced by dynamic Android SMS discovery & active scope (Default SMS, Other SMS, Gmail) |
| `ARCHIVED_DEFAULT_CARRIER_PACKAGES` | `mobile/services/storage.ts` | Static default array of enabled carrier packages (`com.whatsapp`, etc.) | Replaced by dynamic active carrier registry with automated migration |
| `ARCHIVED_WHATSAPP_PACKAGES` & `ARCHIVED_TELEGRAM_PACKAGES` | `mobile/services/service-matcher.ts` | Hard-coded package IDs for WhatsApp and Telegram chat applications | Excluded from the new 3-category carrier scope |
| Legacy WhatsApp & Static Tests | `mobile/tests/service-matcher.test.ts` | Unit tests checking WhatsApp package allowlists and carrier tags | Moved to `mobile/archive/carriers/tests/legacy-carrier-tests.ts` |

---

## 2. Active Scope vs. Archived Scope

### Active Categories (New Architecture):
1. **Default SMS App** (`default_sms`): Automatically detected using Android `RoleManager.ROLE_SMS` or `Telephony.Sms.getDefaultSmsPackage()`. No hard-coded package names.
2. **Other SMS Apps** (`other_sms`): Discovered dynamically via Android Package Manager intent queries for SMS handlers. Allowed individually by user.
3. **Gmail** (`gmail`): Explicitly enabled integration for Gmail notification OTP extraction.

### Archived Scope:
- Instant Messaging / Chat apps (`com.whatsapp`, `com.whatsapp.w4b`, `org.telegram.messenger`, `org.thunderdog.challegram`).
- Static hard-coded package sets for SMS apps.

---

## 3. How to Restore an Archived Carrier

If WhatsApp or Telegram support needs to be restored in the future:
1. Re-import package constants or regex definitions from `mobile/archive/carriers/static-carriers.ts`.
2. Register the carrier in `mobile/services/carrier-registry.ts` under an appropriate category (e.g. `chat_apps`).
3. Add a dedicated UI switch card in `mobile/app/select-apps.tsx`.
4. Add unit test assertions from `mobile/archive/carriers/tests/legacy-carrier-tests.ts` back into `mobile/tests/service-matcher.test.ts`.

---

## 4. Exclusion from Active Runtime

Archived files in this directory are completely decoupled from active runtime registration. They are excluded from:
- `mobile/services/storage.ts`
- `mobile/services/service-matcher.ts`
- `mobile/services/carrier-registry.ts`
- Active production build bundle
