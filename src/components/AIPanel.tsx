import { useState, useEffect, useMemo } from 'react';
import { Bot, TrendingUp, Brain, Calendar, MessageCircle, RefreshCw, AlertCircle } from 'lucide-react';
import { useTradingStore } from '@/store/tradingStore';
import { useJournalStore } from '@/store/journalStore';
import { getAccountAnalytics, getTrades } from '@/services/api';
import { cn } from '@/utils/helpers';

type AITab = 'review' | 'behavior' | 'summary' | 'coaching';

interface TradeReviewScore {
  entryQuality: number;
  exitQuality: number;
  riskManagement: number;
  explanation: string;
}

/**
 * AI Workspace Panel
 * Provides trade review, behavioral analysis, daily summary, and coaching.
 * 
 * BACKEND STATUS: No AI backend endpoint exists (/api/ai/*).
 * All analysis is computed CLIENT-SIDE from existing terminal data (positions, trades, journal).
 * For real LLM-backed insights, a backend endpoint must be created.
 */
export function AIPanel() {
  const [activeTab, setActiveTab] = useState<AITab>('review');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tabs: { id: AITab; label: string; icon: React.ReactNode }[] = [
    { id: 'review', label: 'Trade Review', icon: <TrendingUp size={13} /> },
    { id: 'behavior', label: 'Behavioral', icon: <Brain size={13} /> },
    { id: 'summary', label: 'Daily Summary', icon: <Calendar size={13} /> },
    { id: 'coaching', label: 'Coaching', icon: <MessageCircle size={13} /> },
  ];

  return (
    <div className="h-full flex flex-col bg-fw-surface overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-fw-border bg-fw-surface flex-shrink-0">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-fw-purple" />
          <span className="text-[14px] font-bold text-fw-text">Insights</span>
          <span className="text-[13px] text-fw-text-muted bg-fw-purple/10 border border-fw-purple/20 px-1.5 py-0.5 rounded font-medium">Rule-based · No AI backend</span>
        </div>
        <div className="flex items-center gap-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 text-[14px] rounded transition-all',
                activeTab === tab.id
                  ? 'bg-fw-purple/15 text-fw-purple border border-fw-purple/30'
                  : 'text-fw-text-secondary hover:text-fw-text hover:bg-fw-hover'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'review' && <TradeReviewTab />}
        {activeTab === 'behavior' && <BehavioralTab />}
        {activeTab === 'summary' && <DailySummaryTab />}
        {activeTab === 'coaching' && <CoachingTab />}
      </div>
    </div>
  );
}

// ─── Trade Review Tab ─────────────────────────────────────────────────────────

function TradeReviewTab() {
  const positions = useTradingStore((s) => s.positions);
  const trades = useTradingStore((s) => s.trades);
  const { entries } = useJournalStore();

  // Fetch server analytics for real P&L data
  const [analytics, setAnalytics] = useState<any>(null);
  const [allTrades, setAllTrades] = useState<any[]>([]);

  useEffect(() => {
    getAccountAnalytics().then(setAnalytics).catch(() => {});
    getTrades('month').then(setAllTrades).catch(() => {});
  }, []);

  // Build reviewable list: prefer real server trades with P&L, fall back to journal
  const recentTrades = useMemo(() => {
    // Real executed trades with FIFO P&L from server
    const fromExecutions = allTrades
      .filter(t => t.pnl !== undefined && t.pnl !== 0)
      .slice(0, 20)
      .map(t => ({
        id: t.id,
        symbol: t.symbol,
        side: t.side,
        pnl: t.pnl || 0,
        date: new Date(t.timestamp).toISOString().split('T')[0],
        emotion: 'neutral' as const,
        rating: 3 as const,
        source: 'execution' as const,
      }));

    // Supplement with journal entries that have P&L (manual entries)
    const fromJournal = entries
      .filter(e => e.pnl !== undefined && e.pnl !== 0)
      .slice(0, 10)
      .map(e => ({
        id: e.id,
        symbol: e.symbol,
        side: e.side,
        pnl: e.pnl || 0,
        date: e.date,
        emotion: e.emotion,
        rating: e.rating,
        source: 'journal' as const,
      }));

    // Deduplicate by date+symbol, prefer execution source
    const seen = new Set<string>();
    const merged = [...fromExecutions, ...fromJournal].filter(t => {
      const key = `${t.date}:${t.symbol}:${t.side}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 20);
  }, [allTrades, entries]);

  const [selectedTrade, setSelectedTrade] = useState<string | null>(null);

  const selectedReview = useMemo((): TradeReviewScore | null => {
    if (!selectedTrade) return null;
    const trade = recentTrades.find(t => t.id === selectedTrade);
    if (!trade) return null;

    // Client-side heuristic scoring (no LLM backend available)
    const isProfit = trade.pnl > 0;
    const entryQuality = isProfit ? Math.min(10, 5 + Math.round(trade.pnl / 1000)) : Math.max(1, 5 - Math.round(Math.abs(trade.pnl) / 1000));
    const exitQuality = isProfit ? Math.min(10, 6 + trade.rating - 3) : Math.max(1, 4 - (5 - trade.rating));
    const riskMgmt = trade.emotion === 'disciplined' || trade.emotion === 'confident' ? 8 : trade.emotion === 'greedy' || trade.emotion === 'fearful' ? 4 : 6;

    let explanation = '';
    if (isProfit) {
      explanation = `Profitable trade on ${trade.symbol}. ${trade.emotion === 'disciplined' ? 'Good emotional discipline maintained.' : 'Consider whether entry timing could be improved.'}`;
    } else {
      explanation = `Loss on ${trade.symbol}. ${trade.emotion === 'greedy' ? 'Possible overextension — review position sizing.' : trade.emotion === 'fearful' ? 'Fear-driven exit may have been premature.' : 'Review stop-loss placement and entry criteria.'}`;
    }

    return { entryQuality, exitQuality, riskManagement: riskMgmt, explanation };
  }, [selectedTrade, recentTrades]);

  if (recentTrades.length < 5) {
    return (
      <InsufficientDataMessage
        message="Minimum 5 completed trades required for AI Trade Review. Currently available:"
        count={recentTrades.length}
      />
    );
  }

  return (
    <div className="p-3 space-y-3">
      <div className="text-[13px] text-fw-text-secondary mb-2">
        Select a trade to review. Scores are computed from terminal data (journal entries, P&L, emotions).
      </div>

      {/* Trade List */}
      <div className="space-y-1 max-h-[200px] overflow-y-auto">
        {recentTrades.map(t => (
          <button
            key={t.id}
            onClick={() => setSelectedTrade(t.id)}
            className={cn(
              'w-full flex items-center justify-between px-3 py-2 rounded border transition-all text-left',
              selectedTrade === t.id
                ? 'border-fw-purple bg-fw-purple/8'
                : 'border-fw-border hover:border-fw-border-light hover:bg-fw-hover/30'
            )}
          >
            <div className="flex items-center gap-2">
              <span className={cn('text-[14px] font-bold px-1.5 py-0.5 rounded', t.side === 'BUY' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400')}>{t.side}</span>
              <span className="text-[13px] font-semibold text-fw-text">{t.symbol}</span>
              <span className="text-[14px] text-fw-text-muted">{t.date}</span>
            </div>
            <span className={cn('text-[13px] font-mono font-bold', t.pnl >= 0 ? 'text-green' : 'text-red')}>
              {t.pnl >= 0 ? '+' : ''}₹{t.pnl.toLocaleString('en-IN')}
            </span>
          </button>
        ))}
      </div>

      {/* Review Scores */}
      {selectedReview && (
        <div className="border border-fw-border rounded p-3 bg-fw-bg/50 space-y-3">
          <div className="text-[13px] font-bold text-fw-text">Analysis</div>
          <div className="grid grid-cols-3 gap-3">
            <ScoreCard label="Entry Quality" score={selectedReview.entryQuality} />
            <ScoreCard label="Exit Quality" score={selectedReview.exitQuality} />
            <ScoreCard label="Risk Mgmt" score={selectedReview.riskManagement} />
          </div>
          <p className="text-[13px] text-fw-text-secondary leading-relaxed">{selectedReview.explanation}</p>
          <div className="px-2 py-1.5 bg-fw-purple/5 border border-fw-purple/20 rounded text-[14px] text-fw-purple">
            ℹ Analysis is rule-based (client-side). Connect an AI backend at /api/ai/review for LLM-powered insights.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Behavioral Analysis Tab ──────────────────────────────────────────────────

function BehavioralTab() {
  const { entries } = useJournalStore();
  const [allTrades, setAllTrades] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);

  useEffect(() => {
    getTrades('month').then(setAllTrades).catch(() => {});
    getAccountAnalytics().then(setAnalytics).catch(() => {});
  }, []);

  const analysis = useMemo(() => {
    // Use real execution trades + journal entries together
    const executionTrades = allTrades.filter(t => t.pnl !== undefined && t.pnl !== 0).map(t => ({
      pnl: t.pnl || 0,
      date: new Date(t.timestamp).toISOString().split('T')[0],
      emotion: 'neutral' as const,
      createdAt: t.timestamp,
    }));
    const journalTrades = entries.filter(e => e.pnl !== undefined);
    const combined = [...executionTrades, ...journalTrades];

    if (combined.length < 3) return null;

    const dayMap = new Map<string, number>();
    combined.forEach(e => { dayMap.set(e.date, (dayMap.get(e.date) || 0) + 1); });
    const avgPerDay = combined.length / Math.max(1, dayMap.size);
    const overtradingDays = Array.from(dayMap.values()).filter(c => c > avgPerDay * 2).length;
    const isOvertrading = overtradingDays > dayMap.size * 0.3;

    // Revenge trading from journal entries only (need emotion data)
    let revengeTrades = 0;
    const sortedJ = [...journalTrades].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    for (let i = 1; i < sortedJ.length; i++) {
      if ((sortedJ[i - 1].pnl || 0) < 0 && sortedJ[i].date === sortedJ[i - 1].date) {
        revengeTrades++;
      }
    }
    const isRevenge = journalTrades.length > 0 && revengeTrades > journalTrades.length * 0.2;

    const emotionCounts: Record<string, number> = {};
    journalTrades.forEach(e => { emotionCounts[e.emotion] = (emotionCounts[e.emotion] || 0) + 1; });
    const dominantEmotion = Object.entries(emotionCounts).sort((a, b) => b[1] - a[1])[0];

    // Win/loss streaks from server analytics if available
    const maxWinStreak = analytics?.maxWinStreak ?? 0;
    const maxLossStreak = analytics?.maxLossStreak ?? 0;

    const winners = combined.filter(e => (e.pnl || 0) > 0).length;
    const winRate = combined.length > 0 ? winners / combined.length : 0;
    const consistencyScore = Math.round(
      winRate * 50 +
      (1 - (overtradingDays / Math.max(1, dayMap.size))) * 30 +
      (revengeTrades === 0 ? 20 : 0)
    );

    return {
      isOvertrading, overtradingDays, isRevenge, revengeTrades,
      dominantEmotion: dominantEmotion?.[0] || 'neutral',
      dominantEmotionCount: dominantEmotion?.[1] || 0,
      maxWinStreak, maxLossStreak,
      consistencyScore,
      totalAnalyzed: combined.length,
      tradingDays: dayMap.size,
      avgPerDay: avgPerDay.toFixed(1),
    };
  }, [allTrades, entries, analytics]);

  if (!analysis) {
    return <InsufficientDataMessage message="Minimum 3 completed trades required for Behavioral Analysis." count={allTrades.filter(t => t.pnl !== 0).length + entries.filter(e => e.pnl).length} />;
  }

  return (
    <div className="p-3 space-y-3">
      {/* Consistency Score */}
      <div className="flex items-center justify-between p-3 bg-fw-bg border border-fw-border rounded">
        <div>
          <div className="text-[14px] text-fw-text-muted uppercase">Consistency Score</div>
          <div className="text-[13px] text-fw-text-secondary">{analysis.totalAnalyzed} trades over {analysis.tradingDays} days</div>
        </div>
        <div className={cn('text-[24px] font-black font-mono', analysis.consistencyScore >= 70 ? 'text-green' : analysis.consistencyScore >= 40 ? 'text-yellow-400' : 'text-red')}>
          {analysis.consistencyScore}
        </div>
      </div>

      {/* Behavioral Flags */}
      <div className="grid grid-cols-2 gap-2">
        <BehaviorFlag
          label="Overtrading"
          detected={analysis.isOvertrading}
          detail={analysis.isOvertrading ? `${analysis.overtradingDays} days exceeded 2x avg (${analysis.avgPerDay}/day)` : `Avg ${analysis.avgPerDay} trades/day — within normal`}
        />
        <BehaviorFlag
          label="Revenge Trading"
          detected={analysis.isRevenge}
          detail={analysis.isRevenge ? `${analysis.revengeTrades} potential revenge trades detected` : 'No revenge trading patterns found'}
        />
        <BehaviorFlag
          label="Emotional Bias"
          detected={analysis.dominantEmotion === 'greedy' || analysis.dominantEmotion === 'fearful'}
          detail={`Dominant: ${analysis.dominantEmotion} (${analysis.dominantEmotionCount}x)`}
        />
        <BehaviorFlag
          label="Loss Streaks"
          detected={analysis.maxLossStreak >= 5}
          detail={`Max win streak: ${analysis.maxWinStreak} | Max loss streak: ${analysis.maxLossStreak}`}
        />
      </div>

      <div className="px-2 py-1.5 bg-fw-purple/5 border border-fw-purple/20 rounded text-[14px] text-fw-purple">
        ℹ Behavioral analysis is rule-based (client-side). Connect /api/ai/behavior for LLM insights.
      </div>
    </div>
  );
}

// ─── Daily Summary Tab ────────────────────────────────────────────────────────

function DailySummaryTab() {
  const positions = useTradingStore((s) => s.positions);
  const trades = useTradingStore((s) => s.trades);
  const { entries } = useJournalStore();
  const [analytics, setAnalytics] = useState<any>(null);

  useEffect(() => {
    getAccountAnalytics().then(setAnalytics).catch(() => {});
  }, []);

  const summary = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const todayEntries = entries.filter(e => e.date === today);

    // Prefer server analytics P&L, fall back to journal
    const todayPnl = analytics?.dailyPnl ?? todayEntries.reduce((s, e) => s + (e.pnl || 0), 0);
    const openMtm = positions.reduce((s, p) => s + (p.mtm || p.pnl || 0), 0);
    const wins = analytics?.winners ?? todayEntries.filter(e => (e.pnl || 0) > 0).length;
    const losses = analytics?.losers ?? todayEntries.filter(e => (e.pnl || 0) < 0).length;
    const totalToday = analytics?.dailyTradeCount ?? todayEntries.length;
    const winRate = analytics?.dailyWinRate ?? (totalToday > 0 ? (wins / totalToday) * 100 : 0);

    const suggestions: string[] = [];
    if (totalToday === 0 && positions.length === 0) {
      suggestions.push('No trading activity today. Review your watchlists and setups.');
    }
    if (wins > 0 && losses === 0 && totalToday > 0) {
      suggestions.push('Perfect session so far. Consider locking profits or reducing size.');
    }
    if (losses > wins && totalToday >= 3) {
      suggestions.push('More losses than wins today. Consider stepping away and reviewing strategy.');
    }
    if (todayPnl < 0 && Math.abs(todayPnl) > 5000) {
      suggestions.push('Significant drawdown today. Evaluate if emotional decisions are in play.');
    }
    if (positions.length > 5) {
      suggestions.push(`${positions.length} open positions — monitor concentration risk.`);
    }

    return { todayEntries: totalToday, todayPnl, openMtm, wins, losses, winRate, openPositions: positions.length, suggestions };
  }, [positions, trades, entries, analytics]);

  return (
    <div className="p-3 space-y-3">
      <div className="text-[13px] font-bold text-fw-text">Today's Summary</div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-2">
        <MiniStat label="Trades" value={summary.todayEntries.toString()} />
        <MiniStat label="Realized P&L" value={`₹${summary.todayPnl.toLocaleString('en-IN')}`} color={summary.todayPnl >= 0 ? 'green' : 'red'} />
        <MiniStat label="Win Rate" value={`${summary.winRate.toFixed(0)}%`} color={summary.winRate >= 50 ? 'green' : 'red'} />
        <MiniStat label="Open MTM" value={`₹${summary.openMtm.toLocaleString('en-IN')}`} color={summary.openMtm >= 0 ? 'green' : 'red'} />
      </div>

      {/* W/L Breakdown */}
      <div className="flex items-center gap-4 px-3 py-2 bg-fw-bg border border-fw-border rounded">
        <div className="flex items-center gap-1">
          <span className="text-[14px] text-fw-text-muted">Wins:</span>
          <span className="text-[14px] font-mono font-bold text-green">{summary.wins}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[14px] text-fw-text-muted">Losses:</span>
          <span className="text-[14px] font-mono font-bold text-red">{summary.losses}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[14px] text-fw-text-muted">Open Positions:</span>
          <span className="text-[14px] font-mono font-bold text-fw-text">{summary.openPositions}</span>
        </div>
      </div>

      {/* Suggestions */}
      {summary.suggestions.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[14px] text-fw-text-secondary font-bold uppercase">Insights & Suggestions</div>
          {summary.suggestions.map((s, i) => (
            <div key={i} className="flex items-start gap-2 px-3 py-2 bg-fw-purple/5 border border-fw-purple/15 rounded">
              <Bot size={12} className="text-fw-purple mt-0.5 flex-shrink-0" />
              <span className="text-[13px] text-fw-text-secondary leading-relaxed">{s}</span>
            </div>
          ))}
        </div>
      )}

      <div className="px-2 py-1.5 bg-fw-purple/5 border border-fw-purple/20 rounded text-[14px] text-fw-purple">
        ℹ Summary computed from positions + journal data. Connect /api/ai/summary for LLM-generated narratives.
      </div>
    </div>
  );
}

// ─── Coaching Tab ─────────────────────────────────────────────────────────────

function CoachingTab() {
  const positions = useTradingStore((s) => s.positions);
  const { entries } = useJournalStore();
  const [analytics, setAnalytics] = useState<any>(null);
  const [weekTrades, setWeekTrades] = useState<any[]>([]);

  useEffect(() => {
    getAccountAnalytics().then(setAnalytics).catch(() => {});
    getTrades('week').then(setWeekTrades).catch(() => {});
  }, []);

  const coaching = useMemo(() => {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekStr = weekAgo.toISOString().split('T')[0];

    // Real trades from executions this week
    const executionCount = weekTrades.filter(t => t.pnl !== undefined && t.pnl !== 0).length;
    // Journal entries this week
    const recentJournal = entries.filter(e => e.date >= weekStr);
    const totalTrades = Math.max(executionCount, recentJournal.length);

    if (totalTrades < 2 && !analytics) return null;

    const totalPnl = analytics?.weeklyPnl ?? recentJournal.reduce((s, e) => s + (e.pnl || 0), 0);
    const winRateNum = analytics?.winRate ?? 0;
    const winRate = winRateNum / 100;

    const tips: { category: string; advice: string }[] = [];

    if (recentJournal.some(e => e.mistakes?.includes('oversize'))) {
      tips.push({ category: 'Position Sizing', advice: 'You\'ve flagged oversizing mistakes this week. Use the Position Size Calculator to enforce risk limits before entry.' });
    }
    if (winRate > 0 && winRate < 0.4) {
      tips.push({ category: 'Entry Quality', advice: `Win rate is ${(winRate * 100).toFixed(0)}% this week. Focus on fewer, higher-conviction setups rather than taking every signal.` });
    } else if (winRate >= 0.6) {
      tips.push({ category: 'Scaling', advice: `Strong ${(winRate * 100).toFixed(0)}% win rate. Consider slightly increasing position size while maintaining risk rules.` });
    }
    const fearCount = recentJournal.filter(e => e.emotion === 'fearful').length;
    const greedCount = recentJournal.filter(e => e.emotion === 'greedy').length;
    if (fearCount > recentJournal.length * 0.3) {
      tips.push({ category: 'Psychology', advice: 'Fear appears frequently in your journal. Pre-define exit rules before entry to reduce emotional decision-making.' });
    }
    if (greedCount > recentJournal.length * 0.3) {
      tips.push({ category: 'Psychology', advice: 'Greed patterns detected. Set take-profit levels in advance and honor them consistently.' });
    }
    if (positions.length > 3) {
      tips.push({ category: 'Exposure', advice: `You have ${positions.length} open positions. Monitor total portfolio risk and consider reducing if correlated.` });
    }
    if (tips.length === 0) {
      tips.push({ category: 'General', advice: 'Good trading discipline this week. Stay consistent with your process and risk management.' });
    }

    return { totalTrades, weekPnl: totalPnl, winRate, tips };
  }, [entries, positions, analytics, weekTrades]);

  if (!coaching) {
    return <InsufficientDataMessage message="Trading data loading… Come back after a few trades." count={weekTrades.length} />;
  }

  return (
    <div className="p-3 space-y-3">
      {/* Week Context */}
      <div className="flex items-center gap-4 px-3 py-2 bg-fw-bg border border-fw-border rounded">
        <div>
          <div className="text-[13px] text-fw-text-muted uppercase">Last 7 Days</div>
          <div className="text-[14px] font-mono font-bold text-fw-text">{coaching.totalTrades} trades</div>
        </div>
        <div>
          <div className="text-[13px] text-fw-text-muted uppercase">Week P&L</div>
          <div className={cn('text-[14px] font-mono font-bold', coaching.weekPnl >= 0 ? 'text-green' : 'text-red')}>
            ₹{coaching.weekPnl.toLocaleString('en-IN')}
          </div>
        </div>
        <div>
          <div className="text-[13px] text-fw-text-muted uppercase">Win Rate</div>
          <div className="text-[14px] font-mono font-bold text-fw-text">{(coaching.winRate * 100).toFixed(0)}%</div>
        </div>
      </div>

      {/* Coaching Tips */}
      <div className="space-y-2">
        <div className="text-[14px] text-fw-text-secondary font-bold uppercase">Coaching Advice</div>
        {coaching.tips.map((tip, i) => (
          <div key={i} className="p-3 bg-fw-bg/50 border border-fw-border rounded">
            <div className="text-[14px] font-bold text-fw-purple mb-1">{tip.category}</div>
            <p className="text-[13px] text-fw-text-secondary leading-relaxed">{tip.advice}</p>
          </div>
        ))}
      </div>

      <div className="px-2 py-1.5 bg-fw-purple/5 border border-fw-purple/20 rounded text-[14px] text-fw-purple">
        ℹ Coaching is rule-based from journal + positions data. Connect /api/ai/coaching for personalized LLM advice.
      </div>
    </div>
  );
}

// ─── Shared Components ────────────────────────────────────────────────────────

function InsufficientDataMessage({ message, count }: { message: string; count: number }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
      <AlertCircle size={32} className="text-fw-text-muted/40" />
      <div className="text-[14px] text-fw-text-secondary">{message}</div>
      <div className="text-[13px] text-fw-text-muted">{count} trade{count !== 1 ? 's' : ''} available (need 5+)</div>
    </div>
  );
}

function ScoreCard({ label, score }: { label: string; score: number }) {
  const color = score >= 7 ? 'text-green' : score >= 5 ? 'text-yellow-400' : 'text-red';
  return (
    <div className="bg-fw-bg border border-fw-border rounded p-2 text-center">
      <div className="text-[13px] text-fw-text-muted uppercase">{label}</div>
      <div className={cn('text-[18px] font-black font-mono', color)}>{score}</div>
      <div className="text-[13px] text-fw-text-muted">/10</div>
    </div>
  );
}

function BehaviorFlag({ label, detected, detail }: { label: string; detected: boolean; detail: string }) {
  return (
    <div className={cn('p-2 rounded border', detected ? 'border-red-800/30 bg-red-900/10' : 'border-fw-border bg-fw-bg/50')}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <div className={cn('w-2 h-2 rounded-full', detected ? 'bg-red' : 'bg-green')} />
        <span className="text-[14px] font-bold text-fw-text">{label}</span>
      </div>
      <span className="text-[14px] text-fw-text-muted leading-relaxed">{detail}</span>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: 'green' | 'red' }) {
  const c = color === 'green' ? 'text-green' : color === 'red' ? 'text-red' : 'text-fw-text';
  return (
    <div className="bg-fw-bg border border-fw-border rounded p-2">
      <div className="text-[13px] text-fw-text-muted uppercase">{label}</div>
      <div className={cn('text-[13px] font-bold font-mono', c)}>{value}</div>
    </div>
  );
}
