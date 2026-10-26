import { test, describe } from 'node:test';
import assert from 'node:assert';
import { detectOtp } from '../services/otp-detector.js';

describe('OTP Detector - Comprehensive Test Suite', () => {
  describe('Valid OTP Notifications', () => {
    test('Standard 6-digit numeric OTP with keyword', () => {
      const res = detectOtp(
        'Google Verification',
        'Your Google verification code is 849201. Do not share it.'
      );
      assert.strictEqual(res.isOtp, true);
      assert.strictEqual(res.code, '849201');
    });

    test('Banking OTP with "code:" format', () => {
      const res = detectOtp(
        'Chase Alert',
        'Use OTP: 492018 to authorize your online purchase of $45.00 at Amazon.'
      );
      assert.strictEqual(res.isOtp, true);
      assert.strictEqual(res.code, '492018');
    });

    test('4-digit PIN verification code', () => {
      const res = detectOtp(
        'WhatsApp Code',
        'Your WhatsApp code is 3819. Do not share this code with anyone.'
      );
      assert.strictEqual(res.isOtp, true);
      assert.strictEqual(res.code, '3819');
    });

    test('8-digit security passcode', () => {
      const res = detectOtp(
        'Microsoft Security',
        '83920194 is your security code for Microsoft account verification.'
      );
      assert.strictEqual(res.isOtp, true);
      assert.strictEqual(res.code, '83920194');
    });

    test('Google prefixed code format (G-XXXXXX)', () => {
      const res = detectOtp(
        'Google',
        'G-629104 is your Google verification code.'
      );
      assert.strictEqual(res.isOtp, true);
      assert.strictEqual(res.code, 'G-629104');
    });

    test('One-time passcode format', () => {
      const res = detectOtp(
        'Bank of America',
        'Your one-time passcode is 728190 for logging in.'
      );
      assert.strictEqual(res.isOtp, true);
      assert.strictEqual(res.code, '728190');
    });

    test('Two-factor 2FA login prompt', () => {
      const res = detectOtp(
        'GitHub 2FA',
        'Your GitHub two-factor code is 638102.'
      );
      assert.strictEqual(res.isOtp, true);
      assert.strictEqual(res.code, '638102');
    });

    test('Your temporary sign in code keyword format', () => {
      const res1 = detectOtp(
        'Amazon Security',
        'Your temporary sign in code is 739102.'
      );
      assert.strictEqual(res1.isOtp, true);
      assert.strictEqual(res1.code, '739102');

      const res2 = detectOtp(
        'Microsoft Account',
        '849201 is your temporary sign in code.'
      );
      assert.strictEqual(res2.isOtp, true);
      assert.strictEqual(res2.code, '849201');

      const res3 = detectOtp(
        'Sony Playstation',
        'Your temporary sign-in code: 481920'
      );
      assert.strictEqual(res3.isOtp, true);
      assert.strictEqual(res3.code, '481920');
    });
  });

  describe('False Positive Rejections (Must NOT be detected as OTP)', () => {
    test('Reject calendar year without OTP context', () => {
      const res = detectOtp(
        'Calendar Event',
        'Join us for the annual conference in 2026! See you there.'
      );
      assert.strictEqual(res.isOtp, false);
    });

    test('Reject price / currency values', () => {
      const res = detectOtp(
        'Bank Transaction Alert',
        'You sent $5000.00 to Alice via Venmo.'
      );
      assert.strictEqual(res.isOtp, false);
    });

    test('Reject time of day', () => {
      const res = detectOtp(
        'Reminder',
        'Doctor appointment scheduled for 14:30 tomorrow.'
      );
      assert.strictEqual(res.isOtp, false);
    });

    test('Reject tracking number without OTP context', () => {
      const res = detectOtp(
        'FedEx Shipment',
        'Your order has shipped! Tracking number is 9876543210.'
      );
      assert.strictEqual(res.isOtp, false);
    });

    test('Reject promotional discount percent', () => {
      const res = detectOtp(
        'Sale Announcement',
        'Flash Sale! Get 50% discount on all items today only.'
      );
      assert.strictEqual(res.isOtp, false);
    });

    test('Reject bare phone numbers', () => {
      const res = detectOtp(
        'Missed Call',
        'You missed a call from +1 (800) 555-0199.'
      );
      assert.strictEqual(res.isOtp, false);
    });

    test('Reject repetitive trivial digits (0000, 1111)', () => {
      const res = detectOtp(
        'Test Message',
        'Your code is 000000'
      );
      assert.strictEqual(res.isOtp, false);
    });

    test('Reject empty or redacted notification content', () => {
      const res = detectOtp('', '');
      assert.strictEqual(res.isOtp, false);
    });

    test('Reject zip codes and postal codes even if word code appears', () => {
      const res = detectOtp(
        'Delivery Update',
        'Package departing from zip code 90210 today.'
      );
      assert.strictEqual(res.isOtp, false);
    });

    test('Reject promo codes and discount codes', () => {
      const res = detectOtp(
        'Special Offer',
        'Use promo code 502910 for 20% off your next purchase.'
      );
      assert.strictEqual(res.isOtp, false);
    });
  });

  describe('Complex Multi-Number Messages & Scoring Precision', () => {
    test('Selects legitimate OTP when unrelated order number and amount appear in message', () => {
      const res = detectOtp(
        'Amazon Pay',
        'Order #987654 confirmed. Use OTP 482019 to authorize payment of $120.00.'
      );
      assert.strictEqual(res.isOtp, true);
      assert.strictEqual(res.code, '482019');
      assert.strictEqual(res.confidence, 'high');
    });

    test('Handles code appearing BEFORE context phrase', () => {
      const res = detectOtp(
        'Uber Security',
        '582910 is your Uber verification code. Do not share this code.'
      );
      assert.strictEqual(res.isOtp, true);
      assert.strictEqual(res.code, '582910');
      assert.strictEqual(res.confidence, 'high');
    });

    test('Handles device verification and transaction authorization wording', () => {
      const res1 = detectOtp(
        'Apple ID',
        'Your Apple ID device verification code is 849201.'
      );
      assert.strictEqual(res1.isOtp, true);
      assert.strictEqual(res1.code, '849201');

      const res2 = detectOtp(
        'Chase Bank',
        'Use 391024 for transaction authorization on your debit card.'
      );
      assert.strictEqual(res2.isOtp, true);
      assert.strictEqual(res2.code, '391024');
    });
  });
});
