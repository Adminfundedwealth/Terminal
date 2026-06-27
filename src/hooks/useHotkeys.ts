import { useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { useTradingStore } from '@/store/tradingStore';

export function useHotkeys() {
  const { setSearchOpen, activeSymbol } = useAppStore();
  const { setOrderForm } = useTradingStore();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger in input fields
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        if (e.key === 'Escape') {
          (target as HTMLInputElement).blur();
        }
        return;
      }

      switch (e.key) {
        case 'F1':
          e.preventDefault();
          if (activeSymbol) {
            setOrderForm({
              symbol: activeSymbol.symbol,
              token: activeSymbol.token,
              side: 'BUY',
            });
          }
          break;
        case 'F2':
          e.preventDefault();
          if (activeSymbol) {
            setOrderForm({
              symbol: activeSymbol.symbol,
              token: activeSymbol.token,
              side: 'SELL',
            });
          }
          break;
      }

      // Ctrl combinations
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'k':
            e.preventDefault();
            setSearchOpen(true);
            break;
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSymbol, setSearchOpen, setOrderForm]);
}
