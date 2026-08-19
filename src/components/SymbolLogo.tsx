import { useMemo, useState } from 'react';
import { resolveSymbolIconMeta, INDEX_LABELS } from '@/utils/symbolIconRegistry';

interface SymbolLogoProps {
  symbol?: string;
  size?: number;
  className?: string;
  title?: string;
}

export function SymbolLogo({ symbol, size = 20, className = '', title }: SymbolLogoProps) {
  const meta = useMemo(() => resolveSymbolIconMeta(symbol), [symbol]);
  // Stage 0 = try logoSrc; Stage 1 = local failed, try CDN; Stage 2 = show chip
  const [failStage, setFailStage] = useState(0);

  // ── Index / Commodity / Currency / ETF chip ───────────────────────────────
  if (meta.kind === 'index') {
    const label =
      INDEX_LABELS[meta.normalized] ||
      INDEX_LABELS[meta.normalized.replace(/\d+$/, '')] ||
      meta.initial;
    return (
      <div
        title={title || meta.symbol}
        className={`inline-flex items-center justify-center rounded font-black text-white flex-shrink-0 select-none ${className}`}
        style={{
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
          background: `linear-gradient(135deg, ${meta.accent}ee 0%, ${meta.accent}99 100%)`,
          fontSize: Math.max(6, Math.round(size * 0.34)),
          letterSpacing: '-0.02em',
          boxShadow: `0 0 0 1px ${meta.accent}50`,
        }}
      >
        {label}
      </div>
    );
  }

  // ── Stock logo — local SVG primary, CDN fallback, initials last resort ────
  if (meta.kind === 'logo' && meta.logoSrc && failStage < 2) {
    return (
      <img
        src={meta.logoSrc}
        alt={meta.symbol}
        title={title || meta.symbol}
        className={`object-contain rounded flex-shrink-0 ${className}`}
        style={{ width: size, height: size, minWidth: size, minHeight: size }}
        onError={() => setFailStage(s => s + 1)}
      />
    );
  }

  // ── Colored initial circle (final fallback) ───────────────────────────────
  return (
    <div
      title={title || meta.symbol}
      className={`inline-flex items-center justify-center rounded-full font-black uppercase text-white flex-shrink-0 select-none ${className}`}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        background: `linear-gradient(135deg, ${meta.accent}ee 0%, ${meta.accent}88 100%)`,
        fontSize: Math.max(8, Math.round(size * 0.48)),
      }}
    >
      {meta.initial}
    </div>
  );
}

export default SymbolLogo;
