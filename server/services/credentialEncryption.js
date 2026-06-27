/**
 * CREDENTIAL ENCRYPTION SERVICE
 * 
 * Encrypts/decrypts broker credentials using AES-256-GCM.
 * 
 * Format: base64(iv[12] + authTag[16] + ciphertext)
 * 
 * Environment:
 *   CREDENTIAL_ENCRYPTION_KEY — 64-char hex string (32 bytes)
 *   Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * 
 * In production: MUST be set. Server refuses to start without it.
 * In development: uses a deterministic dev key (insecure, fine for local).
 */

import crypto from 'crypto';

const DEV_KEY = '0'.repeat(64); // 32 zero-bytes — ONLY for development

function getEncryptionKey() {
  const keyHex = process.env.CREDENTIAL_ENCRYPTION_KEY;

  if (!keyHex) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: CREDENTIAL_ENCRYPTION_KEY must be set in production (64 hex chars = 32 bytes)');
    }
    return Buffer.from(DEV_KEY, 'hex');
  }

  if (keyHex.length !== 64) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
  }

  return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns base64-encoded string: iv(12) + authTag(16) + ciphertext
 * 
 * @param {string} plaintext - Data to encrypt (typically JSON string)
 * @returns {string} Base64-encoded encrypted payload
 */
export function encryptCredentials(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag(); // 16 bytes

  // Format: iv(12) + authTag(16) + ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypt an AES-256-GCM encrypted credential payload.
 * 
 * @param {string} encoded - Base64-encoded payload from encryptCredentials()
 * @returns {string} Decrypted plaintext
 * @throws {Error} If decryption fails (wrong key, tampered data)
 */
export function decryptCredentials(encoded) {
  const key = getEncryptionKey();
  const combined = Buffer.from(encoded, 'base64');

  if (combined.length < 28) {
    throw new Error('Invalid encrypted credential payload (too short)');
  }

  const iv = combined.slice(0, 12);
  const authTag = combined.slice(12, 28);
  const ciphertext = combined.slice(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Check if a stored credential is in the old base64 format (unencrypted).
 * Used for migration: detect old records and re-encrypt them.
 */
export function isLegacyFormat(encoded) {
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    // Legacy format has loginId and passwordHash as plain JSON
    return parsed.loginId !== undefined && parsed.passwordHash !== undefined;
  } catch {
    return false;
  }
}
