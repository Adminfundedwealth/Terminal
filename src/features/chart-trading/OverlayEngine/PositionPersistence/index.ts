/**
 * PositionPersistence — Overlay Survival Layer
 *
 * Ensures overlays survive:
 *  - Chart resize
 *  - Theme changes
 *  - Workspace save/restore
 *  - Timeframe changes
 *  - Indicator add/remove
 *  - Fullscreen toggle
 *
 * Persistence strategy: the overlay state is derived from the trading store,
 * not from any local storage. On every chart re-mount (timeframe change,
 * workspace switch, fullscreen, etc.) `replayOpenPositions()` is called,
 * which re-emits POSITION_OPENED events from the live store.
 *
 * This module hooks into the app-level events that cause chart re-mounts
 * and ensures the overlay engine is notified.
 */

import { replayOpenPositions } from '../PositionSynchronization';
import { positionEventBus } from '../PositionEvents';

type CleanupFn = () => void;

class OverlayPersistenceManager {
  private cleanups: CleanupFn[] = [];

  /**
   * Start listening for events that require overlay replay.
   * Call once when the terminal initialises.
   */
  start(): void {
    // Visibility change (e.g., returning to tab)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        setTimeout(() => replayOpenPositions(), 100);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    this.cleanups.push(() =>
      document.removeEventListener('visibilitychange', handleVisibility)
    );

    // WS reconnect — data may have changed while offline
    const handleReconnect = () => {
      setTimeout(() => replayOpenPositions(), 500);
    };
    window.addEventListener('ws:reconnected', handleReconnect);
    this.cleanups.push(() =>
      window.removeEventListener('ws:reconnected', handleReconnect)
    );

    // Custom event fired by ChartPanel when chart is fully re-initialised
    const handleChartReady = () => {
      // Small delay so series ref is stable before coordinate lookups
      setTimeout(() => {
        positionEventBus.emit({ type: 'WORKSPACE_LOADED', positionId: '__all__' });
        replayOpenPositions();
      }, 150);
    };
    window.addEventListener('fw:chart:ready', handleChartReady);
    this.cleanups.push(() =>
      window.removeEventListener('fw:chart:ready', handleChartReady)
    );
  }

  stop(): void {
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
  }
}

const persistenceManager = new OverlayPersistenceManager();

export function startPersistence(): void {
  persistenceManager.start();
}

export function stopPersistence(): void {
  persistenceManager.stop();
}

/**
 * Notify the persistence layer that a chart has just been (re-)initialised.
 * Call this from ChartPanel after the chart and series are ready.
 */
export function notifyChartReady(): void {
  window.dispatchEvent(new CustomEvent('fw:chart:ready'));
}
