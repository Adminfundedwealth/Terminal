/**
 * RISK MONITOR
 * 
 * Invisible component that monitors risk thresholds and fires toasts.
 * Triggers at 80% and 90% of daily loss limit and max drawdown.
 * Uses server-sourced risk state so thresholds match actual challenge rules.
 */

import { useEffect, useRef } from 'react';
import { useTradingStore } from '@/store/tradingStore';
import { useToast } from '@/components/ToastProvider';
import { getRiskState } from '@/services/api';
import { getChallengeRulePct } from '@/utils/helpers';

export function RiskMonitor() {
  const { showToast } = useToast();
  const account = useTradingStore((s) => s.account);
  const positions = useTradingStore((s) => s.positions);

  // Track which alerts have been shown to avoid spam
  const alertsShown = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!account) return;
    const currentAccount = account;

    let cancelled = false;

    async function checkRisk() {
      // Prefer server-sourced risk state — falls back to local calculation
      let dailyLimit: number;
      let maxDrawdownLimit: number;
      let dailyLoss: number;
      let drawdown: number;

      try {
        const rs = await getRiskState();
        if (cancelled) return;

        dailyLimit = rs.dailyLossLimit;
        maxDrawdownLimit = rs.maxDrawdownLimit;
        dailyLoss = rs.dailyLoss ?? 0;
        const equity = rs.currentEquity ?? (currentAccount.balance ?? 0);
        const peak = rs.peakBalance ?? (currentAccount.peakBalance ?? currentAccount.balance ?? 0);
        drawdown = Math.max(0, peak - equity);
      } catch {
        if (cancelled) return;
        // Fallback: derive from account challenge config or hardcoded defaults
        const balance = currentAccount.balance ?? 0;
        const initialBalance = currentAccount.challenge?.initialBalance ?? balance;
        const dailyLossPct = getChallengeRulePct(currentAccount.challenge?.dailyLossLimitPct, currentAccount.challenge?.plan, 'dailyLossLimitPct');
        const maxDDPct = getChallengeRulePct(currentAccount.challenge?.maxDrawdownPct, currentAccount.challenge?.plan, 'maxDrawdownPct');

        dailyLimit = initialBalance * (dailyLossPct / 100);
        maxDrawdownLimit = initialBalance * (maxDDPct / 100);

        const totalMTM = positions.reduce((sum, p) => sum + (p.pnl || p.mtm || 0), 0);
        dailyLoss = totalMTM < 0 ? Math.abs(totalMTM) : 0;
        const peak = Math.max(balance, currentAccount.peakBalance ?? initialBalance);
        drawdown = Math.max(0, peak - (balance + totalMTM));
      }

      const dailyPct = dailyLimit > 0 ? (dailyLoss / dailyLimit) * 100 : 0;
      const ddPct = maxDrawdownLimit > 0 ? (drawdown / maxDrawdownLimit) * 100 : 0;

      // Daily loss 80%
      if (dailyPct >= 80 && dailyPct < 90 && !alertsShown.current.has('daily_80')) {
        alertsShown.current.add('daily_80');
        showToast({
          type: 'warning',
          title: '⚠️ Daily Loss Warning',
          message: `You've used 80% of your daily loss limit (₹${Math.round(dailyLoss).toLocaleString('en-IN')} of ₹${Math.round(dailyLimit).toLocaleString('en-IN')})`,
          duration: 8000,
        });
      }

      // Daily loss 90%
      if (dailyPct >= 90 && !alertsShown.current.has('daily_90')) {
        alertsShown.current.add('daily_90');
        showToast({
          type: 'danger',
          title: '🚨 DANGER: Daily Loss Critical',
          message: `90% daily loss limit reached! One more losing trade may lock your account. Loss: ₹${Math.round(dailyLoss).toLocaleString('en-IN')} / Limit: ₹${Math.round(dailyLimit).toLocaleString('en-IN')}`,
          duration: 12000,
          sound: true,
        });
      }

      // Max drawdown 80%
      if (ddPct >= 80 && ddPct < 90 && !alertsShown.current.has('dd_80')) {
        alertsShown.current.add('dd_80');
        showToast({
          type: 'warning',
          title: '⚠️ Max Drawdown Warning',
          message: `You've used 80% of max drawdown allowance (₹${Math.round(drawdown).toLocaleString('en-IN')} of ₹${Math.round(maxDrawdownLimit).toLocaleString('en-IN')})`,
          duration: 8000,
        });
      }

      // Max drawdown 90%
      if (ddPct >= 90 && !alertsShown.current.has('dd_90')) {
        alertsShown.current.add('dd_90');
        showToast({
          type: 'danger',
          title: '🚨 DANGER: Max Drawdown Critical',
          message: `90% of max drawdown reached! Further losses will permanently breach your account. Drawdown: ₹${Math.round(drawdown).toLocaleString('en-IN')} / Limit: ₹${Math.round(maxDrawdownLimit).toLocaleString('en-IN')}`,
          duration: 15000,
          sound: true,
        });
      }

      // Reset alerts if values drop back below thresholds (e.g. after close/reversal)
      if (dailyPct < 75) {
        alertsShown.current.delete('daily_80');
        alertsShown.current.delete('daily_90');
      }
      if (ddPct < 75) {
        alertsShown.current.delete('dd_80');
        alertsShown.current.delete('dd_90');
      }
    }

    checkRisk();

    return () => { cancelled = true; };
  }, [account, positions, showToast]);

  return null; // Invisible component
}
