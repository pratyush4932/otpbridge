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
  });
});
