import { describe, expect, it } from 'vitest';
import { mapJournalPayload } from '../routes/persistence.routes.js';

describe('P1.6 journal database contract', () => {
  it('maps journal fields to owned database columns', () => {
    const payload = mapJournalPayload({
      id: 'client-entry-1',
      date: '2026-09-03',
      symbol: 'NIFTY',
      side: 'BUY',
      tradingAccountId: 'account-1',
      executionId: 'execution-1',
      positionId: 'position-1',
      entryPrice: 100,
      exitPrice: 110,
      qty: 5,
      pnl: 50,
      tradePhase: 'after',
      notes: 'Breakout',
      tags: ['trend'],
      screenshotUrls: ['https://example.test/chart.png'],
    }, 'trader-1');

    expect(payload).toMatchObject({
      id: 'client-entry-1',
      trader_id: 'trader-1',
      trading_account_id: 'account-1',
      execution_id: 'execution-1',
      position_id: 'position-1',
      entry_date: '2026-09-03',
      entry_price: 100,
      exit_price: 110,
      qty: 5,
      pnl: 50,
      trade_phase: 'after',
      notes: 'Breakout',
      tags: ['trend'],
    });
    expect(payload).not.toHaveProperty('tradingAccountId');
    expect(payload).not.toHaveProperty('executionId');
  });

  it('keeps the same client id for an idempotent retry and isolates trader ownership', () => {
    const first = mapJournalPayload({ id: 'entry-1', symbol: 'NIFTY' }, 'trader-1');
    const retry = mapJournalPayload({ id: 'entry-1', symbol: 'NIFTY' }, 'trader-1');
    const otherTrader = mapJournalPayload({ id: 'entry-1', symbol: 'NIFTY' }, 'trader-2');
    expect(retry.id).toBe(first.id);
    expect(retry.trader_id).toBe('trader-1');
    expect(otherTrader.trader_id).toBe('trader-2');
  });
});
