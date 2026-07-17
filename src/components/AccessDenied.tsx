/**
 * ACCESS DENIED — Production Gate
 * 
 * Shown when a user visits terminal.fundedwealth.com directly without a valid SSO session.
 * Provides clear messaging and a link back to the FundedWealth Dashboard.
 * 
 * SECURITY: This is a client-side gate. The server-side auth middleware is the real enforcement.
 * This component prevents terminal UI from rendering without valid authentication.
 */

const DASHBOARD_URL = import.meta.env.VITE_FW_DASHBOARD_URL || 'https://fundedwealth.com';

interface AccessDeniedProps {
  error?: string | null;
}

export function AccessDenied({ error }: AccessDeniedProps) {
  const loginUrl = `${DASHBOARD_URL}/login`;

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-fw-bg">
      <div className="flex flex-col items-center gap-6 max-w-md px-6 text-center">
        {/* Logo */}
        <div className="relative">
          <div className="absolute -inset-3 rounded-2xl bg-gradient-to-br from-red-500/20 via-[#4F46E5]/15 to-[#7C3AED]/20 blur-xl opacity-60" />
          <div className="relative w-16 h-16 rounded-xl bg-gradient-to-br from-[#0a0a0a] to-[#1a1a2e] border border-white/10 flex items-center justify-center">
            <img
              src="/logo.png"
              alt="FundedWealth"
              className="w-11 h-11 object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
        </div>

        {/* Branding */}
        <div className="flex flex-col items-center gap-1">
          <span className="text-lg font-extrabold tracking-wide bg-gradient-to-r from-[#00D4FF] via-[#4F46E5] to-[#7C3AED] bg-clip-text text-transparent">
            FUNDEDWEALTH
          </span>
          <span className="text-sm font-bold tracking-[0.25em] text-fw-accent/70">
            TERMINAL
          </span>
        </div>

        {/* Access Denied Message */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-center gap-2">
            <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v.01M12 9v3m0-9a9 9 0 110 18 9 9 0 010-18z" />
            </svg>
            <span className="text-md font-semibold text-red-400">Access Denied</span>
          </div>

          <p className="text-lg text-fw-text-secondary leading-relaxed">
            {error || 'Please login from your FundedWealth Dashboard to access the Trading Terminal.'}
          </p>
        </div>

        {/* Action Button */}
        <a
          href={loginUrl}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-gradient-to-r from-[#4F46E5] to-[#7C3AED] text-white text-lg font-semibold hover:opacity-90 transition-opacity"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          Go to FundedWealth Dashboard
        </a>

        {/* Info */}
        <p className="text-sm text-fw-text-secondary/60">
          You can access the Terminal by clicking "Launch Terminal" from your Dashboard after logging in.
        </p>
      </div>
    </div>
  );
}
