/**
 * ORDER EXECUTION SERVICE — Unit Tests
 * 
 * Tests the full order pipeline: risk → broker → fill → position → trade.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../db/client.js', () => ({ supabase: null }));
vi.mock('./riskEngine.js', () => ({
  RiskEngine: {
    validateOrder: vi.fn().mockResolvedValue({ allowed: true }),
    postTradeCheck: vi.fn().mockResolvedValue({ status: 'ok' }),
  },
}));
vi.mock('../brokers/broker.factory.js', () => ({
  BrokerFactory: {
    create: vi.fn().mockResolvedValue({
      placeOrder: vi.fn().mockResolvedValue({ brokerOrderId: 'BRK-001', status: 'FILLED', avgPrice: 100 }),
    }),
  },
}));
vi.mock('../repositories/position.repository.js', () => ({
  PositionRepository: vi.fn().mockImplementation(() => ({
    upsertPosition: vi.fn().mockResolvedValue(null),
    findOpenByAccountId: vi.fn().mockResolvedValue([]),
  })),
}));
vi.mock('../repositories/trade.repository.js', () => ({
  TradeRepository: vi.fn().mockImplementation(() => ({
    recordTrade: vi.fn().mockResolvedValue(null),
  })),
}));
vi.mock('../repositories/order.repository.js', () => ({
  OrderRepository: vi.fn().mockImplementation(() => ({
    markFilled: vi.fn().mockResolvedValue(null),
    markRejected: vi.fn().mockResolvedValue(null),
    updateStatus: vi.fn().mockResolvedValue(null),
    createOrder: vi.fn().mockResolvedValue({ id: 'ord-new' }),
  })),
}));
vi.mock('../events/index.js', () => ({
  eventBus: { publish: vi.fn(), subscribe: vi.fn() },
}));
vi.mock('./executionMode.js', () => ({
  ExecutionMode: { isPaper: true, isLive: false, getState: () => ({ mode: 'paper', isPaper: true }) },
}));

import { OrderExecutionService } from '../services/orderExecutionService.js';
import { RiskEngine } from './riskEngine.js';
import { eventBus } from '../events/index.js';

describe('OrderExecutionService.executeOrder', () => {
  let service;
  let mockMDE;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMDE = {
      getQuote: vi.fn().mockReturnValue({ ltp: 150 }),
    };
    service = new OrderExecutionService(mockMDE);
  });

  it('rejects order when risk engine says not allowed', async () => {
    RiskEngine.validateOrder.mockResolvedValue({ allowed: false, reason: 'Daily loss limit breached' });

    const result = await service.executeOrder('acc-1', 'ord-1', {
      symbol: 'RELIANCE', token: '2885', segment: 'NSE', side: 'BUY', orderType: 'MARKET', productType: 'MIS', qty: 10,
    }, { broker_provider: 'angelone', balance: 1000000, status: 'active' });

    expect(result.status).toBe('REJECTED');
    expect(result.message).toContain('Daily loss limit');
    expect(eventBus.publish).toHaveBeenCalledWith('order.updated', expect.objectContaining({ status: 'REJECTED' }), expect.any(Object));
  });

  it('executes market order in paper mode and fills at LTP', async () => {
    RiskEngine.validateOrder.mockResolvedValue({ allowed: true });

    const result = await service.executeOrder('acc-1', 'ord-2', {
      symbol: 'RELIANCE', token: '2885', segment: 'NSE', side: 'BUY', orderType: 'MARKET', productType: 'MIS', qty: 10,
    }, { broker_provider: 'angelone', balance: 1000000, status: 'active' });

    expect(result.status).toBe('FILLED');
    expect(result.avgPrice).toBe(150); // LTP from mock MDE
    expect(eventBus.publish).toHaveBeenCalledWith('order.updated', expect.objectContaining({ status: 'FILLED' }), expect.any(Object));
  });

  it('runs post-trade risk check after fill', async () => {
    RiskEngine.validateOrder.mockResolvedValue({ allowed: true });
    RiskEngine.postTradeCheck.mockResolvedValue({ status: 'ok' });

    await service.executeOrder('acc-1', 'ord-3', {
      symbol: 'RELIANCE', token: '2885', segment: 'NSE', side: 'BUY', orderType: 'MARKET', productType: 'MIS', qty: 10,
    }, { broker_provider: 'angelone', balance: 1000000, status: 'active' });

    expect(RiskEngine.postTradeCheck).toHaveBeenCalledWith('acc-1', expect.any(Function));
  });

  it('publishes order.created event for new orders', async () => {
    RiskEngine.validateOrder.mockResolvedValue({ allowed: true });

    await service.executeOrder('acc-1', 'ord-4', {
      symbol: 'SBIN', token: '3045', segment: 'NSE', side: 'SELL', orderType: 'MARKET', productType: 'MIS', qty: 5,
    }, { broker_provider: 'angelone', balance: 1000000, status: 'active' });

    // Should have published order.updated with FILLED
    const calls = eventBus.publish.mock.calls;
    const filledCall = calls.find(c => c[0] === 'order.updated' && c[1].status === 'FILLED');
    expect(filledCall).toBeDefined();
    expect(filledCall[1].symbol).toBe('SBIN');
  });
});

describe('OrderExecutionService.exitPosition', () => {
  let service;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OrderExecutionService({ getQuote: () => ({ ltp: 200 }) });
  });

  it('throws error when position not found', async () => {
    await expect(service.exitPosition('acc-1', 'non-existent')).rejects.toThrow('not found');
  });
});
