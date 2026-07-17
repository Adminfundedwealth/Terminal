import { useEffect, useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { resolveSymbolIconMeta } from '@/utils/symbolIconRegistry';

interface SymbolLogoProps {
  symbol?: string;
  size?: number;
  className?: string;
  title?: string;
}

const CACHE_KEY = 'fw-symbol-logo-cache-v1';

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
    // ignore
  }
}

export function SymbolLogo({ symbol, size = 20, className = '', title }: SymbolLogoProps) {
  const meta = useMemo(() => resolveSymbolIconMeta(symbol), [symbol]);
  const [logoFailed, setLogoFailed] = useState(false);
  const [logoSrc, setLogoSrc] = useState<string | null>(() => getCachedLogo(meta.cacheKey));

  useEffect(() => {
    if (!meta.logoSrc) {
      setLogoSrc(null);
      setLogoFailed(false);
      return;
    }

    const cached = getCachedLogo(meta.cacheKey);
    if (cached) {
      setLogoSrc(cached);
      setLogoFailed(false);
      return;
    }

    setLogoSrc(meta.logoSrc);
    setLogoFailed(false);
  }, [meta.cacheKey, meta.logoSrc]);

  if (meta.kind === 'index') {
    return (
      <div
        title={title || meta.symbol}
        className={`inline-flex items-center justify-center rounded ${className}`}
        style={{ width: size, height: size, minWidth: size, minHeight: size, backgroundColor: `${meta.accent}18` }}
      >
        <BarChart3 size={Math.max(10, size * 0.62)} className="text-white/90" />
      </div>
    );
  }

  if (meta.kind === 'logo' && logoSrc && !logoFailed) {
    return (
      <img
        src={logoSrc}
        alt={meta.symbol}
        title={title || meta.symbol}
        className={`object-contain ${className}`}
        style={{ width: size, height: size, minWidth: size, minHeight: size, padding: 2 }}
        onError={() => {
          setLogoFailed(true);
          if (logoSrc) setCachedLogo(meta.cacheKey, '');
        }}
      />
    );
  }

  // Only use fallback when no local logo exists or it failed to load.
  return (
    <div
      title={title || meta.symbol}
      className={`inline-flex items-center justify-center rounded-full font-black uppercase text-white ${className}`}
      style={{ width: size, height: size, minWidth: size, minHeight: size, backgroundColor: meta.accent }}
    >
      <span style={{ fontSize: Math.max(10, size * 0.55) }}>{meta.initial}</span>
    </div>
  );
}

export default SymbolLogo;
