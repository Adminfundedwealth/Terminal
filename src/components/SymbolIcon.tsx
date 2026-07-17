import { useEffect, useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { resolveSymbolIconMeta } from '@/utils/symbolIconRegistry';

interface SymbolIconProps {
  symbol?: string;
  size?: number;
  className?: string;
  title?: string;
}

const CACHE_KEY = 'fw-symbol-icon-cache-v1';

function getCachedLogo(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${CACHE_KEY}:${key}`);
    return raw || null;
  } catch {
    return null;
  }
}

function setCachedLogo(key: string, url: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${CACHE_KEY}:${key}`, url);
  } catch {
    // ignore storage errors
  }
}

export { default as SymbolIcon } from '@/components/SymbolLogo';
