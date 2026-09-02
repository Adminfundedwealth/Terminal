import { describe, expect, it } from 'vitest';
import { OrderExecutionService } from '../services/orderExecutionService.js';
import { amoReleaseState, deferredOrderLifecycle } from '../services/accountService.js';
import { initialOrderStatus } from '../repositories/order.repository.js';
import { DhanAdapter } from '../brokers/dhan/dhan.adapter.js';

describe('P1.5 order validity', () => {
  it('triggers GTT only when price crosses in the order direction', () => {
    expect(OrderExecutionService.shouldTriggerGtt('BUY', 99, 100)).toBe(true);
    expect(OrderExecutionService.shouldTriggerGtt('SELL', 101, 100)).toBe(true);
    expect(OrderExecutionService.shouldTriggerGtt('BUY', 101, 100)).toBe(false);
    expect(OrderExecutionService.shouldTriggerGtt('SELL', 99, 100)).toBe(false);
  });

  it('rejects invalid GTT trigger values', () => {
    expect(OrderExecutionService.shouldTriggerGtt('BUY', 100, 0)).toBe(false);
    expect(OrderExecutionService.shouldTriggerGtt('BUY', Number.NaN, 100)).toBe(false);
  });

  it('does not trigger on a missing or invalid side', () => {
    expect(OrderExecutionService.shouldTriggerGtt('HOLD', 99, 100)).toBe(false);
  });

  it('accepts a valid GTT trigger as deferred lifecycle state', () => {
    expect(OrderExecutionService.validateGttTrigger({ side: 'BUY', triggerPrice: 100 })).toBeNull();
    expect(deferredOrderLifecycle({ isGtt: true })).toBe('GTT_PENDING');
  });

  it('rejects invalid GTT trigger prices', () => {
    expect(OrderExecutionService.validateGttTrigger({ side: 'BUY', triggerPrice: 0 })).toMatch(/greater than 0/i);
    expect(OrderExecutionService.validateGttTrigger({ side: 'SELL', triggerPrice: Number.NaN })).toMatch(/greater than 0/i);
  });

  it('does not execute AMO immediately and exposes queued state', () => {
    expect(initialOrderStatus({ isAmo: true })).toBe('AMO_PENDING');
    expect(deferredOrderLifecycle({ isAmo: true })).toBe('AMO_PENDING');
    expect(deferredOrderLifecycle({ isAmo: true, isGtt: true })).toBe('AMO_PENDING');
  });

  it('defines an explicit AMO_PENDING to execution release transition', async () => {
    expect(amoReleaseState(false)).toBe('AMO_PENDING');
    expect(amoReleaseState(true)).toBe('PENDING');
  });

  it('keeps standard orders on the normal pending lifecycle', () => {
    expect(initialOrderStatus({})).toBe('PENDING');
    expect(deferredOrderLifecycle({})).toBeNull();
  });

  it.each([
    ['full fill', 'FILLED', 100, 'FILLED'],
    ['partial fill', 'PARTIALLY_FILLED', 40, 'PARTIALLY_FILLED'],
    ['unfilled', 'SUBMITTED', 0, 'CANCELLED'],
    ['rejection', 'REJECTED', 0, 'REJECTED'],
  ])('resolves IOC %s without normal-order conversion', (_name, status, filledQty, expected) => {
    expect(OrderExecutionService.resolveIocLifecycle({ status, filledQty, qty: 100 }).status).toBe(expected);
  });

  it('maps broker partial status without writing an order', () => {
    expect(DhanAdapter.prototype._normalizeBrokerWriteStatus({ status: 'PART_TRADED' })).toBe('PARTIALLY_FILLED');
  });
});