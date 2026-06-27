/**
 * RISK MONITOR
 * 
 * Invisible component that monitors risk thresholds and fires toasts.
 * Triggers at 80% and 90% of daily loss limit and max drawdown.
 */

import { useEffect, useRef } from 'react';
import { useTradingStore } from '@/store/tradingStore';
import { useToast } from '@/components/ToastProvider';

export function RiskMonitor() {
  const { showToast } = useToast();
  const account = useTradingStore((s) => s.account);
  const positions = useTradingStore((s) => s.positions);

  // Track which alerts have been shown to avoid spam
  const alertsShown = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!account) return;

    const balance = account.balance || 0;
    const initialBalance = account.challenge?.initialBalance || balance;
    const dailyLimit = balance * 0.05; // 5% default
    const maxDrawdownLimit = balance * 0.10; // 10% default

    const totalMTM = positions.reduce((sum, p) => sum + (p.pnl || p.mtm || 0), 0);
    const dailyLoss = totalMTM < 0 ? Math.abs(totalMTM) : 0;

    const peakBalance = Math.max(balance, account.peakBalance || initialBalance);
    const drawdown = peakBalance - (balance + totalMTM);

    const dailyPct = dailyLimit > 0 ? (dailyLoss / dailyLimit) * 100 : 0;
    const ddPct = maxDrawdownLimit > 0 ? (Math.max(0, drawdown) / maxDrawdownLimit) * 100 : 0;

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

    // Reset alerts if values drop back below thresholds
    if (dailyPct < 75) {
      alertsShown.current.delete('daily_80');
      alertsShown.current.delete('daily_90');
    }
    if (ddPct < 75) {
      alertsShown.current.delete('dd_80');
      alertsShown.current.delete('dd_90');
    }
  }, [account, positions, showToast]);

  return null; // Invisible component
}
