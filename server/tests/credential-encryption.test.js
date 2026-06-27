/**
 * CREDENTIAL ENCRYPTION — Unit Tests
 * 
 * Verifies AES-256-GCM encrypt/decrypt cycle.
 */

import { describe, it, expect } from 'vitest';
import { encryptCredentials, decryptCredentials, isLegacyFormat } from '../services/credentialEncryption.js';

describe('Credential Encryption (AES-256-GCM)', () => {
  it('encrypts and decrypts a credential payload correctly', () => {
    const payload = JSON.stringify({ loginId: 'FW10K12345678', passwordHash: 'abc123', createdAt: '2026-06-27' });
    const encrypted = encryptCredentials(payload);

    expect(encrypted).not.toBe(payload);
    expect(encrypted).not.toContain('loginId');

    const decrypted = decryptCredentials(encrypted);
    expect(decrypted).toBe(payload);
  });

  it('produces different ciphertext for same plaintext (random IV)', () => {
    const payload = 'test-payload';
    const enc1 = encryptCredentials(payload);
    const enc2 = encryptCredentials(payload);
    expect(enc1).not.toBe(enc2); // Different IVs produce different ciphertext
  });

  it('throws on tampered ciphertext', () => {
    const payload = 'sensitive-data';
    const encrypted = encryptCredentials(payload);

    // Tamper with a character
    const tampered = encrypted.slice(0, 10) + 'X' + encrypted.slice(11);
    expect(() => decryptCredentials(tampered)).toThrow();
  });

  it('throws on too-short payload', () => {
    expect(() => decryptCredentials('abc')).toThrow('too short');
  });

  it('detects legacy base64 format', () => {
    const legacyPayload = Buffer.from(JSON.stringify({ loginId: 'FW10K-OLD', passwordHash: 'hash123' })).toString('base64');
    expect(isLegacyFormat(legacyPayload)).toBe(true);
  });

  it('does not false-positive on encrypted format', () => {
    const encrypted = encryptCredentials(JSON.stringify({ loginId: 'FW10K-NEW', passwordHash: 'hash456' }));
    expect(isLegacyFormat(encrypted)).toBe(false);
  });
});
