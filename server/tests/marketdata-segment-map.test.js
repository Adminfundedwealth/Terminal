/**
 * MARKET DATA — SINGLE-QUOTE SEGMENT MAPPING TESTS (P5.2)
 *
 * Regression coverage for the P5.1 audit P0 finding:
 *   marketDataEngine.getLivePrice() single-quote path previously used an inline
 *   ternary with NO BFO case, so BSE option (BFO) tokens fell through to NSE_EQ
 *   and Dhan returned nothing for them.
 *
 * These tests exercise the shared resolveDhanSegment() helper that both the
 * single-quote path and the batch LTP poller now use.
 *
 * Pure function — no DB, no network, runs fully offline.
 */

import { describe, it, expect } from 'vitest';
import { resolveDhanSegment } from '../services/marketDataEngine.js';

describe('resolveDhanSegment — single-quote segment mapping (P5.2)', () => {
  it('NSE → NSE_EQ', () => {
    expect(resolveDhanSegment('NSE')).toBe('NSE_EQ');
  });

  it('BSE → BSE_EQ', () => {
    expect(resolveDhanSegment('BSE')).toBe('BSE_EQ');
  });

  it('NFO → NSE_FNO (unchanged)', () => {
    expect(resolveDhanSegment('NFO')).toBe('NSE_FNO');
  });

  it('BFO → BSE_FNO (the fix)', () => {
    expect(resolveDhanSegment('BFO')).toBe('BSE_FNO');
  });

  it('BFO does NOT resolve to NSE_EQ (regression guard)', () => {
    expect(resolveDhanSegment('BFO')).not.toBe('NSE_EQ');
  });

  it('MCX → MCX_COMM', () => {
    expect(resolveDhanSegment('MCX')).toBe('MCX_COMM');
  });

  it('CDS → NSE_CURRENCY (marketfeed API key; order API uses CUR separately)', () => {
    expect(resolveDhanSegment('CDS')).toBe('NSE_CURRENCY');
  });

  it('unknown/missing segment → NSE_EQ safe fallback', () => {
    expect(resolveDhanSegment('WHATEVER')).toBe('NSE_EQ');
    expect(resolveDhanSegment(undefined)).toBe('NSE_EQ');
    expect(resolveDhanSegment(null)).toBe('NSE_EQ');
    expect(resolveDhanSegment('')).toBe('NSE_EQ');
  });

  it('already-Dhan-format keys pass through unchanged', () => {
    expect(resolveDhanSegment('NSE_EQ')).toBe('NSE_EQ');
    expect(resolveDhanSegment('BSE_EQ')).toBe('BSE_EQ');
    expect(resolveDhanSegment('NSE_FNO')).toBe('NSE_FNO');
    expect(resolveDhanSegment('BSE_FNO')).toBe('BSE_FNO');
    expect(resolveDhanSegment('MCX_COMM')).toBe('MCX_COMM');
    expect(resolveDhanSegment('IDX_I')).toBe('IDX_I');
    expect(resolveDhanSegment('CUR')).toBe('NSE_CURRENCY');
    expect(resolveDhanSegment('NSE_CURRENCY')).toBe('NSE_CURRENCY');
  });
});
