/**
 * EVENTS MODULE — Central Export
 * 
 * Usage:
 *   import { eventBus, EventBridge, CHANNELS } from './events/index.js';
 *   
 *   // Publish an event
 *   eventBus.publish('order.created', { orderId, symbol, side, qty, orderType }, { accountId });
 *   
 *   // Subscribe to events
 *   eventBus.subscribe('order.*', (event) => { ... });
 *   
 *   // Bridge to WebSocket clients
 *   const bridge = new EventBridge({ realtimeServer, wss });
 *   bridge.start();
 */

export { eventBus } from './eventBus.js';
export { EventBridge } from './eventBridge.js';
export { CHANNELS, validatePayload, getChannelNames, getChannelDef } from './channels.js';
