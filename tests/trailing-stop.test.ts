/**
 * TRAILING STOP-LOSS TESTS (P6.5)
 *
 * Deterministic ratchet math for paper trailing stops. Pure — no DOM/network.
 */

import { describe, it, expect } from 'vitest';
import { initTrailing, stepTrailing, isStopHit } from '@/utils/trailingStop';

describe('initTrailing', () => {
  it('LONG stop starts trail-distance below reference', () => {
    expect(initTrailing('LONG', 100, 5)).toEqual({ extreme: 100, stop: 95 });
  });
  it('SHORT stop starts trail-distance above reference', () => {
    expect(initTrailing('SHORT', 100, 5)).toEqual({ extreme: 100, stop: 105 });
  });
});

describe('stepTrailing — LONG', () => {
  it('ratchets the stop up as price makes new highs, never down', () => {
    let s = initTrailing('LONG', 100, 5); // stop 95
    // price up to 110 → stop should ratchet to 105
    let u = stepTrailing('LONG', s, 110, 5);
    expect(u.newStop).toBe(105);
    s = u.state;
    // price pulls back to 106 → stop must NOT move down; no new stop
    u = stepTrailing('LONG', s, 106, 5);
    expect(u.newStop).toBeNull();
    expect(u.state.stop).toBe(105);
    // price to new high 120 → stop ratchets to 115
    u = stepTrailing('LONG', s, 120, 5);
    expect(u.newStop).toBe(115);
  });

  it('no change when price does not exceed prior high', () => {
    const s = initTrailing('LONG', 100, 5);
    const u = stepTrailing('LONG', s, 100, 5);
    expect(u.newStop).toBeNull();
    expect(u.state.stop).toBe(95);
  });
});

describe('stepTrailing — SHORT', () => {
  it('ratchets the stop down as price makes new lows, never up', () => {
    let s = initTrailing('SHORT', 100, 5); // stop 105
    let u = stepTrailing('SHORT', s, 90, 5); // low 90 → stop 95
    expect(u.newStop).toBe(95);
    s = u.state;
    u = stepTrailing('SHORT', s, 94, 5); // bounce up → no change
    expect(u.newStop).toBeNull();
    expect(u.state.stop).toBe(95);
    u = stepTrailing('SHORT', s, 80, 5); // new low → stop 85
    expect(u.newStop).toBe(85);
  });
});

describe('stepTrailing — guards', () => {
  it('ignores non-positive ltp / trail', () => {
    const s = initTrailing('LONG', 100, 5);
    expect(stepTrailing('LONG', s, 0, 5).newStop).toBeNull();
    expect(stepTrailing('LONG', s, 110, 0).newStop).toBeNull();
  });
});

describe('isStopHit', () => {
  it('LONG hit when ltp <= stop', () => {
    expect(isStopHit('LONG', 95, 94)).toBe(true);
    expect(isStopHit('LONG', 95, 96)).toBe(false);
  });
  it('SHORT hit when ltp >= stop', () => {
    expect(isStopHit('SHORT', 105, 106)).toBe(true);
    expect(isStopHit('SHORT', 105, 104)).toBe(false);
  });
  it('no signal when stop or ltp invalid', () => {
    expect(isStopHit('LONG', 0, 100)).toBe(false);
    expect(isStopHit('LONG', 95, 0)).toBe(false);
  });
});
