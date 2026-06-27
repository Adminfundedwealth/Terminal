import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(price: number, decimals = 2): string {
  if (price == null || isNaN(price)) return '—';
  return price.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatNumber(num: number): string {
  if (num == null || isNaN(num)) return '0';
  if (Math.abs(num) >= 10000000) {
    return (num / 10000000).toFixed(2) + ' Cr';
  }
  if (Math.abs(num) >= 100000) {
    return (num / 100000).toFixed(2) + ' L';
  }
  if (Math.abs(num) >= 1000) {
    return (num / 1000).toFixed(2) + ' K';
  }
  return num.toFixed(2);
}

export function formatPnl(pnl: number): string {
  const sign = pnl >= 0 ? '+' : '';
  return `${sign}₹${formatPrice(Math.abs(pnl))}`;
}

export function formatChangePercent(change: number): string {
  if (change == null || isNaN(change)) return '0.00%';
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}%`;
}

export function getChangeColor(value: number): string {
  if (value == null) return 'text-fw-text-secondary';
  if (value > 0) return 'text-green';
  if (value < 0) return 'text-red';
  return 'text-fw-text-secondary';
}

export function timeframeToLabel(tf: string): string {
  const map: Record<string, string> = {
    '1': '1m',
    '3': '3m',
    '5': '5m',
    '15': '15m',
    '30': '30m',
    '60': '1H',
    '240': '4H',
    'D': '1D',
    'W': '1W',
  };
  return map[tf] || tf;
}

export function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): T {
  let timeoutId: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  }) as T;
}
