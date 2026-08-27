/**
 * OPTION CHAIN NORMALIZER (P5.3)
 *
 * Pure, dependency-free helpers that derive trader-facing market-data fields
 * (price change, change %, bid/ask spread) for option-chain entries.
 *
 * Universal: applied identically to every underlying (NFO + BFO) and both the
 * call and put side. Nothing is fabricated — when the upstream source does not
 * provide a previous close or a valid bid/ask, the derived values are 0 and the
 * availability flags (hasChange / hasSpread) are false so the UI can render an
 * explicit "unavailable" state.
 *
 * Extracted from server/routes/api.js so it can be unit-tested in isolation.
 */

/**
 * Compute price change and change% from LTP and previous close.
 *
 * @param {number} ltp
 * @param {number} prevClose
 * @returns {{ change: number, changePercent: number, hasChange: boolean }}
 *   change/changePercent are 0 and hasChange is false when either input is not
 *   a positive number (market closed, illiquid, or prev close unavailable).
 */
export function computeChange(ltp, prevClose) {
  if (!(ltp > 0) || !(prevClose > 0)) {
    return { change: 0, changePercent: 0, hasChange: false };
  }
  const change = ltp - prevClose;
  const changePercent = (change / prevClose) * 100;
  return {
    change: Math.round(change * 100) / 100,
    changePercent: Math.round(changePercent * 100) / 100,
    hasChange: true,
  };
}

/**
 * Compute a safe bid/ask spread.
 *
 * Spread is only meaningful when BOTH bid and ask are positive and ask >= bid.
 * A crossed book (ask < bid), a zero bid, a zero ask, or missing data all yield
 * { spread: 0, hasSpread: false } — never a misleading or negative spread.
 *
 * @param {number} bid
 * @param {number} ask
 * @returns {{ spread: number, hasSpread: boolean }}
 */
export function computeSpread(bid, ask) {
  if (!(bid > 0) || !(ask > 0) || ask < bid) {
    return { spread: 0, hasSpread: false };
  }
  return { spread: Math.round((ask - bid) * 100) / 100, hasSpread: true };
}

/**
 * Enrich a normalized option-chain entry with derived market data for BOTH the
 * call and put side: change, changePercent, spread, and hasChange/hasSpread
 * availability flags. Coerces bid/ask/qty/prevClose to safe numbers.
 *
 * The entry must already carry callLtp/callPrevClose/callBidPrice/callAskPrice
 * (+ put equivalents). Missing fields default to 0 and yield hasChange=false /
 * hasSpread=false. Mutates and returns the same object.
 *
 * @param {object} e
 * @returns {object}
 */
export function enrichOptionChainEntry(e) {
  const cChange = computeChange(e.callLtp, e.callPrevClose || 0);
  const pChange = computeChange(e.putLtp, e.putPrevClose || 0);
  const cSpread = computeSpread(e.callBidPrice || 0, e.callAskPrice || 0);
  const pSpread = computeSpread(e.putBidPrice || 0, e.putAskPrice || 0);

  e.callBidPrice  = Number(e.callBidPrice || 0);
  e.callAskPrice  = Number(e.callAskPrice || 0);
  e.callBidQty    = Number(e.callBidQty || 0);
  e.callAskQty    = Number(e.callAskQty || 0);
  e.callPrevClose = Number(e.callPrevClose || 0);
  e.callChange    = cChange.change;
  e.callChangePct = cChange.changePercent;
  e.callHasChange = cChange.hasChange;
  e.callSpread    = cSpread.spread;
  e.callHasSpread = cSpread.hasSpread;

  e.putBidPrice   = Number(e.putBidPrice || 0);
  e.putAskPrice   = Number(e.putAskPrice || 0);
  e.putBidQty     = Number(e.putBidQty || 0);
  e.putAskQty     = Number(e.putAskQty || 0);
  e.putPrevClose  = Number(e.putPrevClose || 0);
  e.putChange     = pChange.change;
  e.putChangePct  = pChange.changePercent;
  e.putHasChange  = pChange.hasChange;
  e.putSpread     = pSpread.spread;
  e.putHasSpread  = pSpread.hasSpread;

  return e;
}
