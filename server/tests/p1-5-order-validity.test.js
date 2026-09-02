import { describe, expect, it } from 'vitest';
import { OrderExecutionService } from '../services/orderExecutionService.js';

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
});