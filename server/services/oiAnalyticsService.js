/**
 * OI ANALYTICS SERVICE
 *
 * Provides OI analysis: PCR, max pain, OI change distribution.
 * Aggregates option chain data for visualization.
 *
 * Accepts either:
 *   - A DataProviderSwitch instance  (getOptionChain returns { data: [], provider })
 *   - A raw OptionChainService       (getOptionChain returns [] directly)
 *
 * Pass dataProviderSwitch as the primary argument so Dhan-sourced chains
 * (which include native OI change + Greeks) feed the analytics.
 * Pass optionChainService as the fallback so Angel One chains still work
 * when Dhan is unavailable.
 */

export class OIAnalyticsService {
  /**
   * @param {object} primarySource   - DataProviderSwitch or any service with getOptionChain()
   * @param {object} [fallbackSource] - Angel One OptionChainService used if primary returns empty
   */
  constructor(primarySource, fallbackSource = null) {
    this._primary = primarySource;
    this._fallback = fallbackSource;
  }

  /**
   * Resolve chain data from primary (DataProviderSwitch) or fallback (Angel OCS).
   * DataProviderSwitch.getOptionChain() returns { data: OptionChainEntry[], provider }.
   * Raw OptionChainService.getOptionChain() returns OptionChainEntry[] directly.
   */
  async _getChain(symbol, expiry) {
    // Primary source
    if (this._primary) {
      try {
        const result = await this._primary.getOptionChain(symbol, expiry);
        // DataProviderSwitch shape: { data: [...], provider: '...' }
        const chain = Array.isArray(result) ? result : result?.data;
        if (Array.isArray(chain) && chain.length > 0) {
          return chain;
        }
      } catch (err) {
        console.warn(`[OIAnalytics] Primary source error: ${err.message}`);
      }
    }

    // Fallback to raw Angel One optionChainService
    if (this._fallback) {
      try {
        await this._fallback._ensureToken?.();
        if (this._fallback.jwtToken) {
          const chain = await this._fallback.getOptionChain(symbol, expiry);
          if (Array.isArray(chain) && chain.length > 0) {
            return chain;
          }
        }
      } catch (err) {
        console.warn(`[OIAnalytics] Fallback source error: ${err.message}`);
      }
    }

    return [];
  }

  async getOIAnalytics(symbol = 'NIFTY', expiry = null) {
    try {
      const chainData = await this._getChain(symbol, expiry);
      if (!chainData || !chainData.length) {
        return { strikes: [], summary: null };
      }

      let totalCallOi = 0, totalPutOi = 0;
      let totalCallOiChange = 0, totalPutOiChange = 0;
      let maxCallOi = 0, maxPutOi = 0;
      let maxCallOiStrike = 0, maxPutOiStrike = 0;

      const strikes = chainData.map(entry => {
        totalCallOi += entry.callOi || 0;
        totalPutOi += entry.putOi || 0;
        totalCallOiChange += entry.callOiChange || 0;
        totalPutOiChange += entry.putOiChange || 0;

        if ((entry.callOi || 0) > maxCallOi) {
          maxCallOi = entry.callOi;
          maxCallOiStrike = entry.strike;
        }
        if ((entry.putOi || 0) > maxPutOi) {
          maxPutOi = entry.putOi;
          maxPutOiStrike = entry.strike;
        }

        return {
          strike: entry.strike,
          callOi: entry.callOi || 0,
          putOi: entry.putOi || 0,
          callOiChange: entry.callOiChange || 0,
          putOiChange: entry.putOiChange || 0,
          pcr: entry.callOi > 0 ? (entry.putOi / entry.callOi) : 0,
        };
      });

      const maxPainStrike = this._calculateMaxPain(chainData);
      const pcr = totalCallOi > 0 ? totalPutOi / totalCallOi : 0;

      return {
        strikes,
        summary: {
          totalCallOi,
          totalPutOi,
          pcr: Math.round(pcr * 100) / 100,
          maxPainStrike,
          highestCallOiStrike: maxCallOiStrike,
          highestPutOiStrike: maxPutOiStrike,
          callOiChange: totalCallOiChange,
          putOiChange: totalPutOiChange,
        },
      };
    } catch (err) {
      console.warn(`[OIAnalytics] Error: ${err.message}`);
      return { strikes: [], summary: null };
    }
  }

  _calculateMaxPain(chainData) {
    let minPain = Infinity;
    let maxPainStrike = 0;

    for (const entry of chainData) {
      let pain = 0;
      const testStrike = entry.strike;

      for (const row of chainData) {
        if (testStrike > row.strike) {
          pain += (testStrike - row.strike) * (row.callOi || 0);
        }
        if (row.strike > testStrike) {
          pain += (row.strike - testStrike) * (row.putOi || 0);
        }
      }

      if (pain < minPain) {
        minPain = pain;
        maxPainStrike = testStrike;
      }
    }

    return maxPainStrike;
  }
}
