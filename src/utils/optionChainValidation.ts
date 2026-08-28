import type { OptionChainEntry } from '@/types';

/** Reject empty quote snapshots before they can replace a usable chain. */
export function isCompleteOptionChain(chain: OptionChainEntry[]): boolean {
  if (chain.length === 0 || chain.some((entry) => !(entry.strike > 0))) return false;

  const usableSides = chain.reduce((count, entry) => count
    + (Boolean(entry.callToken) && entry.callLtp > 0 ? 1 : 0)
    + (Boolean(entry.putToken) && entry.putLtp > 0 ? 1 : 0), 0);

  return usableSides >= 2;
}