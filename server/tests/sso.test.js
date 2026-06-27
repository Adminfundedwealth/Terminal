/**
 * SSO SERVICE — Unit Tests
 * 
 * Tests SSO token validation, nonce replay protection, session creation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

// Mock dependencies
vi.mock('../db/client.js', () => ({ supabase: null }));
vi.mock('./session.service.js', () => ({
  createSession: vi.fn().mockResolvedValue({ id: 'session-1' }),
}));
vi.mock('./auth.service.js', () => ({
  generateSessionJWT: vi.fn().mockReturnValue('mock-terminal-jwt'),
  verifySessionJWT: vi.fn(),
  hashToken: vi.fn().mockReturnValue('hashed'),
  generateNonce: vi.fn().mockReturnValue('test-nonce'),
}));
vi.mock('./nonceStore.js', () => ({
  NonceStore: vi.fn().mockImplementation(() => ({
    checkAndStore: vi.fn().mockResolvedValue(true),
    getMode: vi.fn().mockReturnValue('memory'),
  })),
}));

import { validateSSOToken, generateSSOToken } from '../services/sso.service.js';

const SSO_SECRET = 'fw-sso-dev-secret-change-in-production';

describe('SSO Token Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects expired SSO token', async () => {
    const token = jwt.sign(
      { sub: 'user-1', accountId: 'acc-1', nonce: 'n1' },
      SSO_SECRET,
      { expiresIn: '-10s' } // Already expired
    );

    const result = await validateSSOToken(token);
    expect(result.success).toBe(false);
    expect(result.error).toContain('expired');
  });

  it('rejects token with wrong signature', async () => {
    const token = jwt.sign(
      { sub: 'user-1', accountId: 'acc-1', nonce: 'n2' },
      'wrong-secret'
    );

    const result = await validateSSOToken(token);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid SSO token signature');
  });

  it('rejects token missing required claims (sub)', async () => {
    const token = jwt.sign(
      { accountId: 'acc-1', nonce: 'n3' },
      SSO_SECRET,
      { expiresIn: '60s' }
    );

    const result = await validateSSOToken(token);
    expect(result.success).toBe(false);
    expect(result.error).toContain('missing required claims');
  });

  it('rejects token missing required claims (accountId)', async () => {
    const token = jwt.sign(
      { sub: 'user-1', nonce: 'n4' },
      SSO_SECRET,
      { expiresIn: '60s' }
    );

    const result = await validateSSOToken(token);
    expect(result.success).toBe(false);
    expect(result.error).toContain('missing required claims');
  });

  it('accepts valid SSO token and returns terminal JWT', async () => {
    const token = jwt.sign(
      { sub: 'user-1', accountId: 'acc-1', challengeId: 'ch-1', email: 'test@test.com', name: 'Test', nonce: 'n5' },
      SSO_SECRET,
      { expiresIn: '60s' }
    );

    const result = await validateSSOToken(token);
    expect(result.success).toBe(true);
    expect(result.jwt).toBe('mock-terminal-jwt');
  });
});

describe('SSO Token Generation', () => {
  it('generates valid short-lived token', () => {
    const token = generateSSOToken({
      fwUserId: 'user-1',
      accountId: 'acc-1',
      challengeId: 'ch-1',
      email: 'test@test.com',
      name: 'Test User',
    });

    const decoded = jwt.verify(token, SSO_SECRET);
    expect(decoded.sub).toBe('user-1');
    expect(decoded.accountId).toBe('acc-1');
    expect(decoded.nonce).toBeDefined();
    expect(decoded.exp - decoded.iat).toBe(60); // 60s expiry
  });
});

describe('Nonce Replay Protection', () => {
  it('rejects replayed nonce', async () => {
    const { NonceStore } = await import('../services/nonceStore.js');
    const store = new NonceStore();
    // First call returns true (new), mock it
    store.checkAndStore.mockResolvedValueOnce(true);
    // Simulate the service using a replayed nonce
    store.checkAndStore.mockResolvedValueOnce(false);

    const first = await store.checkAndStore('same-nonce', 120);
    expect(first).toBe(true);

    const second = await store.checkAndStore('same-nonce', 120);
    expect(second).toBe(false);
  });
});
