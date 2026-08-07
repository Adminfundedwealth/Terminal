/**
 * PositionEvents — Typed Event Bus
 *
 * A lightweight, typed publish/subscribe bus for overlay-related events.
 * Components subscribe; the trading engine publishes.
 *
 * Design goals:
 * - Zero dependencies on React / Zustand
 * - Synchronous dispatch (no async batching)
 * - Memory-safe: subscriptions are returned as cleanup functions
 */

import type { OverlayEvent, OverlayEventType } from '../types';

type Listener = (event: OverlayEvent) => void;

class PositionEventBus {
  private listeners: Map<OverlayEventType | '*', Set<Listener>> = new Map();

  /**
   * Subscribe to a specific event type or '*' for all events.
   * Returns a cleanup function.
   */
  on(type: OverlayEventType | '*', listener: Listener): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);

    return () => this.off(type, listener);
  }

  /**
   * Unsubscribe a listener.
   */
  off(type: OverlayEventType | '*', listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  /**
   * Publish an event. Fires typed listeners, then wildcard listeners.
   */
  emit(event: OverlayEvent): void {
    const typed = this.listeners.get(event.type);
    if (typed) typed.forEach((l) => l(event));

    const wild = this.listeners.get('*');
    if (wild) wild.forEach((l) => l(event));
  }

  /**
   * Remove all listeners (use on teardown).
   */
  clear(): void {
    this.listeners.clear();
  }
}

/**
 * Singleton event bus for the overlay system.
 * Import this in any module that needs to publish or subscribe.
 */
export const positionEventBus = new PositionEventBus();

/**
 * Convenience: emit a batch of position events.
 * Typically called when workspace loads and all open positions must be replayed.
 */
export function emitBatch(events: OverlayEvent[]): void {
  events.forEach((e) => positionEventBus.emit(e));
}
