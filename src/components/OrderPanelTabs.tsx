/**
 * OrderPanelTabs.tsx — FundedWealth Trading Terminal (P6.2 integration)
 *
 * Thin tab wrapper that hosts the existing single-order OrderPanel and the new
 * multi-leg StrategyBuilder in the same right-panel slot, without redesigning
 * the layout. Defaults to the single-order ticket so nothing changes for the
 * existing flow. Strategy execution reuses the same verified order pipeline.
 */

import { useState } from 'react';
import { OrderPanel } from '@/components/OrderPanel';
import { StrategyBuilder } from '@/components/StrategyBuilder';
import { cn } from '@/utils/helpers';

type Tab = 'order' | 'strategy';

export function OrderPanelTabs() {
  const [tab, setTab] = useState<Tab>('order');
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex flex-shrink-0 border-b border-fw-border bg-fw-surface">
        {(['order', 'strategy'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'flex-1 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors',
              tab === t ? 'text-fw-accent border-b-2 border-fw-accent bg-fw-bg' : 'text-fw-text-muted hover:text-fw-text',
            )}
          >
            {t === 'order' ? 'Order' : 'Strategy'}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'order' ? <OrderPanel /> : <StrategyBuilder />}
      </div>
    </div>
  );
}
