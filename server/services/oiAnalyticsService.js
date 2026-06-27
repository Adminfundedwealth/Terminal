/**
 * OI ANALYTICS SERVICE
 * 
 * Provides OI analysis: PCR, max pain, OI change distribution.
 * Aggregates option chain data for visualization.
 */

export class OIAnalyticsService {
  constructor(optionChainService) {
    this.ocs = optionChainService;
  }

  async getOIAnalytics(symbol = 'NIFTY', expiry = null) {
    try {
      // Get option chain data
      const chainData = await this.ocs.getChain(symbol, expiry);
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

      // Calculate max pain
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
    // Max pain = strike where option buyers lose the most
    let minPain = Infinity;
    let maxPainStrike = 0;

    for (const entry of chainData) {
      let pain = 0;
      const testStrike = entry.strike;

      for (const row of chainData) {
        // Call pain: max(0, testStrike - row.strike) * row.callOi
        if (testStrike > row.strike) {
          pain += (testStrike - row.strike) * (row.callOi || 0);
        }
        // Put pain: max(0, row.strike - testStrike) * row.putOi
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
