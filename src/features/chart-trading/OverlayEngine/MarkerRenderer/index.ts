/**
 * MarkerRenderer — Entry Candle Markers
 *
 * Draws trade execution markers (▲ BUY / ▼ SELL) on the exact entry candle.
 * Uses lightweight-charts series.setMarkers() — markers live in chart coordinates
 * and move correctly with zoom/pan/timeframe changes.
 *
 * This is kept separate from the canvas renderer because markers are
 * TradingView primitives, not canvas draws.
 */

import type { ISeriesApi, SeriesMarker, Time } from 'lightweight-charts';
import type { PositionOverlay } from '../types';

export class MarkerRenderer {
  private series: ISeriesApi<any> | null = null;
  /** Map of positionId → entry time (unix seconds) */
  private entryTimes: Map<string, number> = new Map();

  /**
   * Bind to a chart series. Call whenever the chart reinitialises.
   */
  attachSeries(series: ISeriesApi<any>): void {
    this.series = series;
    // Re-render all registered markers after series swap
    this.flush();
  }

  detachSeries(): void {
    this.series = null;
  }

  /**
   * Register an entry marker for a position.
   * The time should be the candle timestamp when the position was opened.
   */
  addMarker(overlay: PositionOverlay, entryTime: number): void {
    this.entryTimes.set(overlay.id, entryTime);
    this.flush();
  }

  /**
   * Remove a marker when a position closes.
   */
  removeMarker(positionId: string): void {
    this.entryTimes.delete(positionId);
    this.flush();
  }

  /**
   * Clear all markers (e.g., on chart destroy).
   */
  clearAll(): void {
    this.entryTimes.clear();
    if (this.series) {
      try {
        this.series.setMarkers([]);
      } catch {
        // Series may be disposed
      }
    }
  }

  /**
   * Build the marker array from all active positions and push to the series.
   * Must be called after any change to the marker set.
   */
  private flush(): void {
    if (!this.series || this.entryTimes.size === 0) return;

    const overlays = useCurrentOverlays();
    const markers: SeriesMarker<Time>[] = [];

    this.entryTimes.forEach((time, positionId) => {
      const overlay = overlays.get(positionId);
      if (!overlay) return;

      const isLong = overlay.side === 'LONG';
      markers.push({
        time: time as Time,
        position: isLong ? 'belowBar' : 'aboveBar',
        color: isLong ? '#2962ff' : '#f7525f',
        shape: isLong ? 'arrowUp' : 'arrowDown',
        text: '',
        size: 1,
      });
    });

    // Sort by time — lightweight-charts requires ascending order
    markers.sort((a, b) => (a.time as number) - (b.time as number));

    try {
      this.series.setMarkers(markers);
    } catch {
      // Series may be stale — handled on next flush
    }
  }
}

// ─── Overlay registry reference (injected at runtime) ────────────────────────

let _overlayRegistry: Map<string, PositionOverlay> = new Map();

export function useCurrentOverlays(): Map<string, PositionOverlay> {
  return _overlayRegistry;
}

export function setOverlayRegistry(registry: Map<string, PositionOverlay>): void {
  _overlayRegistry = registry;
}
