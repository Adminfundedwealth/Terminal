/**
 * PositionSynchronization — Overlay ↔ Trading Engine Bridge
 *
 * Subscribes to the Zustand trading store and WebSocket service.
 * Converts store state changes into OverlayEvents on the event bus.
 *
 * Architecture:
 *   Zustand tradingStore  ──→  PositionSynchronization  ──→  positionEventBus
 *   WebSocket (wsService) ──→  PositionSynchronization  ──→  positionEventBus
 *
 * The overlay engine NEVER reads from the store directly.
 * All data flows through the event bus.
 *
 * Call `startSync()` once when the app initialises.
 * Call `stopSync()` on teardown.
 */

import { useTradingStore } from '@/store/tradingStore';
import { useMarketStore } from '@/store/marketStore';
import type { Position } from '@/types';
import { positionEventBus } from '../PositionEvents';
import type { OverlayEvent } from '../types';

type Unsubscribe = () => void;

class PositionSynchronizer {
  private cleanups: Unsubscribe[] = [];
  private lastPositionMap: Map<string, Position> = new Map();

  /** Start watching for position changes and LTP updates. */
  start(): void {
    // Subscribe to trading store — watch for position changes
    // Zustand v4 plain subscribe gives full state; we extract positions manually
    const unsubPositions = useTradingStore.subscribe(
      (state) => {
        this.handlePositionsUpdate(state.positions);
      }
    );
    this.cleanups.push(unsubPositions);

    // Subscribe to market store — watch for LTP changes
    const unsubQuotes = useMarketStore.subscribe(
      (state) => {
        this.handleQuoteUpdate(state.quotes);
      }
    );
    this.cleanups.push(unsubQuotes);

    // Perform initial sync for positions already in the store
    this.handlePositionsUpdate(useTradingStore.getState().positions);

    // Listen for WS connection restored → re-emit all open positions
    const handleConnected = () => {
      const positions = useTradingStore.getState().positions;
      positions
        .filter((p) => p.qty !== 0)
        .forEach((p) => {
          positionEventBus.emit({
            type: 'CONNECTION_RESTORED',
            positionId: p.id,
            payload: this.positionToPayload(p),
          });
        });
    };
    window.addEventListener('ws:reconnected', handleConnected);
    this.cleanups.push(() => window.removeEventListener('ws:reconnected', handleConnected));
  }

  /** Stop all subscriptions. */
  stop(): void {
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    this.lastPositionMap.clear();
  }

  /** Diff the new positions list against the previous snapshot. */
  private handlePositionsUpdate(positions: Position[]): void {
    const currentIds = new Set(positions.map((p) => p.id));

    // Detect closed positions (present before, absent or qty=0 now)
    this.lastPositionMap.forEach((prev, id) => {
      const curr = positions.find((p) => p.id === id);
      if (!curr || curr.qty === 0) {
        positionEventBus.emit({ type: 'POSITION_CLOSED', positionId: id });
        this.lastPositionMap.delete(id);
      }
    });

    // Detect opened and modified positions
    positions
      .filter((p) => p.qty !== 0)
      .forEach((p) => {
        const prev = this.lastPositionMap.get(p.id);

        if (!prev) {
          // New position
          positionEventBus.emit({
            type: 'POSITION_OPENED',
            positionId: p.id,
            payload: this.positionToPayload(p),
          });
        } else {
          // Existing — diff
          const slChanged = prev.stopLoss !== p.stopLoss;
          const tpChanged = prev.takeProfit !== p.takeProfit;
          const priceChanged = prev.avgPrice !== p.avgPrice || prev.qty !== p.qty;

          if (slChanged) {
            positionEventBus.emit({
              type: 'SL_MODIFIED',
              positionId: p.id,
              payload: { stopLoss: p.stopLoss },
            });
          }

          if (tpChanged) {
            positionEventBus.emit({
              type: 'TP_MODIFIED',
              positionId: p.id,
              payload: { takeProfit: p.takeProfit },
            });
          }

          if (priceChanged || slChanged || tpChanged) {
            positionEventBus.emit({
              type: 'POSITION_MODIFIED',
              positionId: p.id,
              payload: this.positionToPayload(p),
            });
          }
        }

        this.lastPositionMap.set(p.id, p);
      });
  }

  /** Emit LTP updates for all active positions that match a changed token. */
  private handleQuoteUpdate(quotes: Record<string, any>): void {
    this.lastPositionMap.forEach((p) => {
      const quote = quotes[p.token];
      if (quote?.ltp != null) {
        positionEventBus.emit({
          type: 'LTP_UPDATED',
          positionId: p.id,
          payload: { ltp: quote.ltp },
        });
      }
    });
  }

  /** Map a Position to an overlay payload. */
  private positionToPayload(p: Position): Partial<import('../types').PositionOverlay> {
    const ltp = useMarketStore.getState().quotes[p.token]?.ltp ?? p.ltp ?? p.avgPrice;
    return {
      id: p.id,
      token: p.token,
      side: (p.side === 'SHORT' || p.sellQty > p.buyQty) ? 'SHORT' : 'LONG',
      qty: p.qty,
      avgPrice: p.avgPrice,
      stopLoss: p.stopLoss,
      takeProfit: p.takeProfit,
      ltp,
    };
  }
}

// Singleton
const synchronizer = new PositionSynchronizer();

export function startSync(): void {
  synchronizer.start();
}

export function stopSync(): void {
  synchronizer.stop();
}

/**
 * Replay all currently open positions as POSITION_OPENED events.
 * Call this when a chart mounts to ensure overlays are drawn for
 * positions that were open before the chart was created.
 */
export function replayOpenPositions(): void {
  const positions = useTradingStore.getState().positions.filter((p) => p.qty !== 0);
  const quotes = useMarketStore.getState().quotes;

  const events: OverlayEvent[] = positions.map((p) => ({
    type: 'POSITION_OPENED' as const,
    positionId: p.id,
    payload: {
      id: p.id,
      token: p.token,
      side: (p.side === 'SHORT' || p.sellQty > p.buyQty) ? 'SHORT' : 'LONG',
      qty: p.qty,
      avgPrice: p.avgPrice,
      stopLoss: p.stopLoss,
      takeProfit: p.takeProfit,
      ltp: quotes[p.token]?.ltp ?? p.ltp ?? p.avgPrice,
    },
  }));

  events.forEach((e) => positionEventBus.emit(e));
}
