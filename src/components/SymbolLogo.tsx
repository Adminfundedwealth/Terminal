import { useEffect, useMemo, useState } from 'react';
import { resolveSymbolIconMeta } from '@/utils/symbolIconRegistry';

interface SymbolLogoProps {
  symbol?: string;
  size?: number;
  className?: string;
  title?: string;
}

const CACHE_KEY = 'fw-symbol-logo-v2';

function getCached(key: string): string | null {
  try { return window.localStorage.getItem(`${CACHE_KEY}:${key}`) || null; } catch { return null; }
}
function setCache(key: string, url: string) {
  try { window.localStorage.setItem(`${CACHE_KEY}:${key}`, url); } catch { /* ignore */ }
}

// Index abbreviation labels shown inside the colored chip
const INDEX_LABELS: Record<string, string> = {
  NIFTY50: 'N50', NIFTY: 'N50', BANKNIFTY: 'BNK', FINNIFTY: 'FIN',
  MIDCPNIFTY: 'MID', SENSEX: 'SX', NIFTYIT: 'IT', NIFTYPHARMA: 'PHR',
  NIFTYAUTO: 'AUT', USDINR: '$₹', EURINR: '€₹', GBPINR: '£₹', JPYINR: '¥₹',
};

export function SymbolLogo({ symbol, size = 20, className = '', title }: SymbolLogoProps) {
  const meta = useMemo(() => resolveSymbolIconMeta(symbol), [symbol]);
  const [src, setSrc] = useState<string | null>(null);
  const [stage, setStage] = useState<'primary' | 'fallback' | 'initial'>('primary');

  useEffect(() => {
    // Reset on symbol change
    setStage('primary');
    setSrc(null);

    if (meta.kind === 'index' || meta.kind === 'fallback' || !meta.logoSrc) {
      setSrc(null);
      return;
    }

    // Check localStorage cache first
    const cached = getCached(meta.cacheKey);
    if (cached === '') {
      // Previously confirmed failed — go straight to fallback
      if (meta.logoFallback) { setSrc(meta.logoFallback); setStage('fallback'); }
      else setStage('initial');
      return;
    }
    if (cached) { setSrc(cached); return; }

    setSrc(meta.logoSrc);
  }, [meta.cacheKey, meta.logoSrc, meta.logoFallback, meta.kind]);

  // ── Index chip ────────────────────────────────────────────────────────────
  if (meta.kind === 'index') {
    const label = INDEX_LABELS[meta.normalized] || meta.initial;
    const fontSize = size <= 16 ? size * 0.38 : size * 0.32;
    return (
      <div
        title={title || meta.symbol}
        className={`inline-flex items-center justify-center rounded font-black text-white flex-shrink-0 ${className}`}
        style={{
          width: size, height: size, minWidth: size, minHeight: size,
          background: `linear-gradient(135deg, ${meta.accent}dd, ${meta.accent}99)`,
          fontSize: Math.max(7, fontSize),
          letterSpacing: '-0.03em',
          boxShadow: `0 0 0 1px ${meta.accent}40`,
        }}
      >
        {label}
      </div>
    );
  }

  // ── Logo image (primary or fallback) ─────────────────────────────────────
  if (src && stage !== 'initial') {
    return (
      <img
        src={src}
        alt={meta.symbol}
        title={title || meta.symbol}
        className={`object-contain rounded flex-shrink-0 ${className}`}
        style={{ width: size, height: size, minWidth: size, minHeight: size }}
        onError={() => {
          if (stage === 'primary') {
            // Primary failed — try local SVG fallback
            setCache(meta.cacheKey, '');
            if (meta.logoFallback) {
              setSrc(meta.logoFallback);
              setStage('fallback');
            } else {
              setStage('initial');
              setSrc(null);
            }
          } else {
            // Fallback also failed — show initial
            setStage('initial');
            setSrc(null);
          }
        }}
        onLoad={() => {
          // Cache the working URL so we skip fetching next time
          if (stage === 'primary' && src) setCache(meta.cacheKey, src);
        }}
      />
    );
  }

  // ── Colored initial circle fallback ──────────────────────────────────────
  return (
    <div
      title={title || meta.symbol}
      className={`inline-flex items-center justify-center rounded-full font-black uppercase text-white flex-shrink-0 ${className}`}
      style={{
        width: size, height: size, minWidth: size, minHeight: size,
        background: `linear-gradient(135deg, ${meta.accent}ee, ${meta.accent}99)`,
        fontSize: Math.max(8, size * 0.48),
      }}
    >
      {meta.initial}
    </div>
  );
}

export default SymbolLogo;
