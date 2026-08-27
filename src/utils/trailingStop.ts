/**
 * trailingStop.ts — FundedWealth Trading Terminal (P6.5)
 *
 * Pure, deterministic trailing-stop-loss math. The UI drives this on each LTP
 * update; when it returns a new stop, the UI re-attaches the stop via the
 * EXISTING attachStopLoss endpoint (verified paper pipeline) — no new
 * execution path is introduced.
 *
 * Model (long or short):
 *   LONG  position: stop trails BELOW price. As LTP makes new highs, the stop
 *                   ratchets up to (highWater - trail). It never moves down.
 *   SHORT position: stop trails ABOVE price. As LTP makes new lows, the stop
 *                   ratchets down to (lowWater + trail). It never moves up.
 *
 * `trail` is an absolute price distance (points), derived from real inputs by
 * the caller — nothing is fabricated. A stop is only proposed when it strictly
 * improves on the current stop, so calls are idempotent/deterministic.
 */

export type PositionDir = 'LONG' | 'SHORT';

export interface TrailingState {
  /** Best favorable price seen so far (high-water for LONG, low-water for SHORT). */
  extreme: number;
  /** Current active stop trigger price (0 = none yet). */
  stop: number;
}

export interface TrailingUpdate {
  state: TrailingState;
  /** New stop to attach, or null if the stop did not change this tick. */
  newStop: number | null;
}

/**
 * Initialise trailing state from the entry/current price and trail distance.
 * The initial stop is placed trail-distance away from the reference price.
 */
export function initTrailing(dir: PositionDir, refPrice: number, trail: number): TrailingState {
  const stop = dir === 'LONG' ? refPrice - trail : refPrice + trail;
  return { extreme: refPrice, stop: Math.max(0, Math.round(stop * 100) / 100) };
}

/**
 * Advance the trailing stop given a new LTP. Returns the updated state and a
 * `newStop` value only when the stop actually ratcheted in the favorable
 * direction (so the caller re-attaches only on real changes).
 */
export function stepTrailing(
  dir: PositionDir,
  state: TrailingState,
  ltp: number,
  trail: number,
): TrailingUpdate {
  if (!(ltp > 0) || !(trail > 0)) return { state, newStop: null };

  let { extreme, stop } = state;
  let changed = false;

  if (dir === 'LONG') {
    if (ltp > extreme) extreme = ltp;                 // new high-water
    const candidate = Math.round((extreme - trail) * 100) / 100;
    if (candidate > stop) { stop = candidate; changed = true; }  // ratchet up only
  } else {
    if (ltp < extreme || extreme === 0) extreme = ltp; // new low-water
    const candidate = Math.round((extreme + trail) * 100) / 100;
    if (stop === 0 || candidate < stop) { stop = candidate; changed = true; } // ratchet down only
  }

  const nextState: TrailingState = { extreme: Math.round(extreme * 100) / 100, stop: Math.max(0, stop) };
  return { state: nextState, newStop: changed ? nextState.stop : null };
}

/**
 * Whether the current LTP has hit/breached the trailing stop (exit signal).
 * LONG exits when LTP <= stop; SHORT exits when LTP >= stop.
 */
export function isStopHit(dir: PositionDir, stop: number, ltp: number): boolean {
  if (!(stop > 0) || !(ltp > 0)) return false;
  return dir === 'LONG' ? ltp <= stop : ltp >= stop;
}
