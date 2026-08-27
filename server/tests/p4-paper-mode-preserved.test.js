/**
 * P4.1 PAPER-MODE PRESERVATION TEST
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Guarantees the P4.1 broker-side protection change did NOT regress paper mode.
 * In paper mode, attachStopLoss / attachTakeProfit must:
 *   - return an OPEN order via the in-memory paper monitor
 *   - NEVER construct/call the broker adapter (no BrokerFactory.create)
 *   - register the order with the paper monitor (_pendingPaperOrders)
 *
 * Runtime verification through the REAL OrderExecutionService (paper path).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/client.js', () => ({ supabase: null }));
vi.mock('../services/riskEngine.js', () => ({
  RiskEngine: {
    validateOrder: vi.fn().mockResolvedValue({ allowed: true }),
    postTradeCheck: vi.fn().mockResolvedValue({ status: 'ok' }),
  },
}));

// Broker factory: if paper mode ever calls it, the test fails.
// vi.hoisted so the spy exists before the hoisted vi.mock factory runs.
const { brokerCreate } = vi.hoisted(() => ({
  brokerCreate: vi.fn(async () => ({
    auth: { isTokenValid: true },
    placeOrder: vi.fn(async () => ({ brokerOrderId: 'SHOULD-NOT-HAPPEN', status: 'PENDING' })),
    cancelOrder: vi.fn(),
    getOrders: vi.fn(async () => []),
  })),
}));
vi.mock('../brokers/broker.factory.js', () => ({
  BrokerFactory: { create: brokerCreate },
}));

vi.mock('../repositories/position.repository.js', () => ({
  PositionRepository: class { async upsertPosition() { return null; } async findOpenByAccountId() { return []; } },
}));
vi.mock('../repositories/trade.repository.js', () => ({
  TradeRepository: class { async recordTrade() { return null; } },
}));
vi.mock('../repositories/order.repository.js', () => ({
  OrderRepository: class {
    async markFilled() { return null; }
    async markRejected() { return null; }
    async updateStatus() { return null; }
    async createOrder() { return { id: 'ord-paper-1' }; }
  },
}));
vi.mock('../events/index.js', () => ({ eventBus: { publish: vi.fn(), subscribe: vi.fn() } }));
vi.mock('./executionMode.js', () => ({
  ExecutionMode: { isPaper: true, isLive: false, getState: () => ({ mode: 'paper', isPaper: true }) },
}));

import { OrderExecutionService } from '../services/orderExecutionService.js';

describe('P4.1 paper mode preserved', () => {
  let service;
  beforeEach(() => {
    vi.clearAllMocks();
    service = new OrderExecutionService({ getQuote: () => ({ ltp: 24000 }) });
    // Stub _findPosition / _getAccount to avoid supabase (which is null)
    service._findPosition = async () => ({
      id: 'pos-1', symbol: 'NIFTY FUT', token: '68407', segment: 'NFO',
      side: 'LONG', qty: 65, product_type: 'MIS', is_open: true, avg_price: 24000,
    });
    service._getAccount = async () => ({ id: 'acc-1', broker_provider: 'paper', status: 'active' });
  });

  it('attachStopLoss in paper mode → OPEN via paper monitor, broker NEVER called', async () => {
    const res = await service.attachStopLoss('acc-1', 'pos-1', 23900);
    expect(res.status).toBe('OPEN');
    expect(res.type).toBe('SL-M');
    expect(res.triggerPrice).toBe(23900);
    // No broker adapter constructed
    expect(brokerCreate).not.toHaveBeenCalled();
    // Registered with paper monitor
    expect(service._pendingPaperOrders.size).toBeGreaterThan(0);
  });

  it('attachTakeProfit in paper mode → OPEN via paper monitor, broker NEVER called', async () => {
    const res = await service.attachTakeProfit('acc-1', 'pos-1', 24500);
    expect(res.status).toBe('OPEN');
    expect(res.type).toBe('LIMIT');
    expect(res.price).toBe(24500);
    expect(brokerCreate).not.toHaveBeenCalled();
    expect(service._pendingPaperOrders.size).toBeGreaterThan(0);
  });
});
