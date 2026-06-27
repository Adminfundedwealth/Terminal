/**
 * CHALLENGE ENGINE — Unit Tests
 * 
 * Tests challenge lifecycle: pass, fail, expire, promote.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/client.js', () => ({ supabase: null }));
vi.mock('../repositories/challenge.repository.js', () => ({
  ChallengeRepository: vi.fn().mockImplementation(() => ({
    markPassed: vi.fn().mockResolvedValue(null),
    markFailed: vi.fn().mockResolvedValue(null),
    markExpired: vi.fn().mockResolvedValue(null),
    insert: vi.fn().mockResolvedValue({ id: 'new-challenge-id', type: 'evaluation', phase: 'phase_2' }),
  })),
}));
vi.mock('../repositories/account.repository.js', () => ({
  AccountRepository: vi.fn().mockImplementation(() => ({
    getWithChallenge: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(null),
    completeAccount: vi.fn().mockResolvedValue(null),
    breachAccount: vi.fn().mockResolvedValue(null),
    insert: vi.fn().mockResolvedValue({ id: 'new-account-id', account_code: 'FW-P2-TEST' }),
  })),
}));
vi.mock('../repositories/risk-rules.repository.js', () => ({
  RiskRulesRepository: vi.fn().mockImplementation(() => ({
    getRulesMap: vi.fn().mockResolvedValue({}),
    insert: vi.fn().mockResolvedValue(null),
  })),
}));
vi.mock('../repositories/metrics.repository.js', () => ({
  MetricsRepository: vi.fn().mockImplementation(() => ({
    getTradingDaysCount: vi.fn().mockResolvedValue(5),
  })),
}));
vi.mock('../repositories/audit.repository.js', () => ({
  AuditRepository: vi.fn().mockImplementation(() => ({
    log: vi.fn().mockResolvedValue(null),
  })),
}));
vi.mock('../events/index.js', () => ({
  eventBus: { publish: vi.fn(), subscribe: vi.fn() },
}));

import { ChallengeService } from '../services/challengeService.js';
import { ChallengeRepository } from '../repositories/challenge.repository.js';
import { AccountRepository } from '../repositories/account.repository.js';
import { RiskRulesRepository } from '../repositories/risk-rules.repository.js';
import { MetricsRepository } from '../repositories/metrics.repository.js';
import { AuditRepository } from '../repositories/audit.repository.js';
import { eventBus } from '../events/index.js';

describe('ChallengeService.checkTransitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('expires challenge when time limit exceeded', async () => {
    const accountRepo = new AccountRepository();
    accountRepo.getWithChallenge.mockResolvedValue({
      id: 'acc-1', balance: 1000000, peak_balance: 1000000, trader_id: 'trader-1', status: 'active',
      challenge: { id: 'ch-1', status: 'active', initial_balance: 1000000, expires_at: '2025-01-01T00:00:00Z', type: 'evaluation' },
    });

    const challengeRepo = new ChallengeRepository();
    const result = await ChallengeService.checkTransitions('acc-1');

    expect(result.transitioned).toBe(true);
    expect(result.newStatus).toBe('expired');
    expect(challengeRepo.markExpired).toHaveBeenCalledWith('ch-1');
  });

  it('passes challenge when profit target met and min days satisfied', async () => {
    const accountRepo = new AccountRepository();
    accountRepo.getWithChallenge.mockResolvedValue({
      id: 'acc-1', balance: 1080000, peak_balance: 1080000, trader_id: 'trader-1', status: 'active',
      challenge: { id: 'ch-1', status: 'active', initial_balance: 1000000, expires_at: '2099-01-01T00:00:00Z', type: 'evaluation', plan: '10K' },
    });

    const riskRulesRepo = new RiskRulesRepository();
    riskRulesRepo.getRulesMap.mockResolvedValue({
      profit_target: { percent: 8, amount: 80000 },
      min_trading_days: { count: 5 },
    });

    const metricsRepo = new MetricsRepository();
    metricsRepo.getTradingDaysCount.mockResolvedValue(6); // > min 5

    const result = await ChallengeService.checkTransitions('acc-1');

    expect(result.transitioned).toBe(true);
    expect(result.newStatus).toBe('passed');
  });

  it('does not pass when profit target met but min days NOT satisfied', async () => {
    const accountRepo = new AccountRepository();
    accountRepo.getWithChallenge.mockResolvedValue({
      id: 'acc-1', balance: 1080000, peak_balance: 1080000, trader_id: 'trader-1', status: 'active',
      challenge: { id: 'ch-1', status: 'active', initial_balance: 1000000, expires_at: '2099-01-01T00:00:00Z', type: 'evaluation', plan: '10K' },
    });

    const riskRulesRepo = new RiskRulesRepository();
    riskRulesRepo.getRulesMap.mockResolvedValue({
      profit_target: { percent: 8, amount: 80000 },
      min_trading_days: { count: 5 },
    });

    const metricsRepo = new MetricsRepository();
    metricsRepo.getTradingDaysCount.mockResolvedValue(3); // < min 5

    const result = await ChallengeService.checkTransitions('acc-1');

    expect(result.transitioned).toBe(false);
    expect(result.note).toContain('more trading days');
  });

  it('fails challenge when max drawdown breached', async () => {
    const accountRepo = new AccountRepository();
    accountRepo.getWithChallenge.mockResolvedValue({
      id: 'acc-1', balance: 880000, peak_balance: 1000000, trader_id: 'trader-1', status: 'active',
      challenge: { id: 'ch-1', status: 'active', initial_balance: 1000000, expires_at: '2099-01-01T00:00:00Z', type: 'evaluation', plan: '10K' },
    });

    const riskRulesRepo = new RiskRulesRepository();
    riskRulesRepo.getRulesMap.mockResolvedValue({
      max_drawdown: { percent: 10, amount: 100000 },
    });

    const challengeRepo = new ChallengeRepository();
    const result = await ChallengeService.checkTransitions('acc-1');

    expect(result.transitioned).toBe(true);
    expect(result.newStatus).toBe('failed');
    expect(challengeRepo.markFailed).toHaveBeenCalled();
    expect(accountRepo.breachAccount).toHaveBeenCalled();
  });
});

describe('ChallengeService.unlockIfEligible', () => {
  it('unlocks account locked for daily loss', async () => {
    const accountRepo = new AccountRepository();
    accountRepo.findById.mockResolvedValue({
      id: 'acc-1', status: 'locked', locked_reason: 'Daily loss limit breached: ₹50000', trader_id: 'trader-1',
    });

    const result = await ChallengeService.unlockIfEligible('acc-1');
    expect(result).toBe(true);
    expect(accountRepo.update).toHaveBeenCalledWith('acc-1', { status: 'active', locked_reason: null });
    expect(eventBus.publish).toHaveBeenCalledWith('account.unlocked', expect.any(Object), expect.any(Object));
  });

  it('does NOT unlock account locked for other reasons', async () => {
    const accountRepo = new AccountRepository();
    accountRepo.findById.mockResolvedValue({
      id: 'acc-1', status: 'locked', locked_reason: 'Admin suspended', trader_id: 'trader-1',
    });

    const result = await ChallengeService.unlockIfEligible('acc-1');
    expect(result).toBe(false);
  });
});

describe('ChallengeService.promoteToNextPhase', () => {
  it('promotes Phase 1 passed to Phase 2', async () => {
    const accountRepo = new AccountRepository();
    accountRepo.getWithChallenge.mockResolvedValue({
      id: 'acc-1', balance: 1080000, trader_id: 'trader-1', broker_provider: 'paper', broker_client_id: null,
      challenge: { id: 'ch-1', status: 'passed', type: 'evaluation', phase: 'phase_1', plan: '10K', initial_balance: 1000000 },
    });

    const result = await ChallengeService.promoteToNextPhase('acc-1');

    expect(result).not.toBeNull();
    expect(result.phase).toBe('phase_2');
    expect(eventBus.publish).toHaveBeenCalledWith('challenge.updated', expect.objectContaining({ status: 'promoted' }), expect.any(Object));
  });

  it('does NOT promote if challenge is not passed', async () => {
    const accountRepo = new AccountRepository();
    accountRepo.getWithChallenge.mockResolvedValue({
      id: 'acc-1', balance: 1000000, trader_id: 'trader-1',
      challenge: { id: 'ch-1', status: 'active', type: 'evaluation', plan: '10K', initial_balance: 1000000 },
    });

    const result = await ChallengeService.promoteToNextPhase('acc-1');
    expect(result).toBeNull();
  });
});
