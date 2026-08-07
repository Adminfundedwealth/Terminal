/**
 * chart-trading feature — public API
 *
 * Import the React integration component:
 *   import { PositionOverlay } from '@/features/chart-trading';
 *
 * Import synchronization bootstrap:
 *   import { startSync, stopSync } from '@/features/chart-trading';
 *
 * Import persistence bootstrap:
 *   import { startPersistence, stopPersistence } from '@/features/chart-trading';
 *
 * Import the event bus (for advanced use):
 *   import { positionEventBus } from '@/features/chart-trading';
 */

export { PositionOverlay } from './OverlayEngine/PositionOverlay/index';
export { startSync, stopSync, replayOpenPositions } from './OverlayEngine/PositionSynchronization';
export { startPersistence, stopPersistence, notifyChartReady } from './OverlayEngine/PositionPersistence';
export { positionEventBus } from './OverlayEngine/PositionEvents';
export type { PositionOverlay as PositionOverlayType, DragConfirmation } from './OverlayEngine/types';
