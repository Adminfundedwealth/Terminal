/**
 * VERCEL EDGE MIDDLEWARE — Production Access Control
 * 
 * Runs at the CDN edge BEFORE any static file or page is served.
 * Blocks direct access to terminal.fundedwealth.com without a valid SSO session.
 * React NEVER loads without authentication.
 * 
 * Flow:
 * 1. Request arrives at Vercel edge
 * 2. Check if path is public (auth routes, static assets, health)
 * 3. If protected path → check for fw_session cookie
 * 4. No cookie → redirect to fundedwealth.com/login
 * 5. Cookie exists → call Railway /auth/verify to validate
 * 6. Invalid session → clear cookie, redirect to fundedwealth.com/login
 * 7. Valid session → pass through to serve the React app
 */

import { next } from '@vercel/functions';

const DASHBOARD_LOGIN_URL = 'https://fundedwealth.com/login';
const RAILWAY_BACKEND_URL = 'https://terminal-production-4429.up.railway.app';

/**
 * Public paths that bypass authentication entirely.
 */
const PUBLIC_EXACT = new Set([
  '/health',
  '/favicon.ico',
  '/logo.png',
  '/robots.txt',
]);

const PUBLIC_PREFIXES = [
  '/auth/',
  '/auth',
  '/api/',
  '/ws/',
  '/assets/',
  '/_next/',
  '/_vercel/',
];

const STATIC_EXTENSIONS = [
  '.js', '.css', '.png', '.jpg', '.jpeg', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.map', '.webp', '.gif', '.json',
  '.xml', '.txt',
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  if (pathname.startsWith('/manifest')) return true;
  for (const ext of STATIC_EXTENSIONS) {
    if (pathname.endsWith(ext)) return true;
  }
  return false;
}

function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}

function redirectToLogin(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      'Location': DASHBOARD_LOGIN_URL,
      'Set-Cookie': 'fw_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

export default async function middleware(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  // Allow public routes through without auth check
  if (isPublicPath(pathname)) {
    return next();
  }

  // Check for session cookie
  const sessionToken = getCookie(request, 'fw_session');

  if (!sessionToken) {
    // No session cookie → user visited directly without SSO → redirect
    return redirectToLogin();
  }

  // Validate session against Railway backend
  try {
    const verifyResponse = await fetch(`${RAILWAY_BACKEND_URL}/auth/verify`, {
      method: 'GET',
      headers: {
        'Cookie': `fw_session=${sessionToken}`,
      },
    });

    if (!verifyResponse.ok) {
      // Session invalid/expired/revoked → clear cookie and redirect
      return redirectToLogin();
    }

    // Session valid → allow request through to serve React app
    return next();

  } catch (error) {
    // Backend unreachable → FAIL CLOSED → do NOT serve terminal
    return redirectToLogin();
  }
}

/**
 * Matcher config: run middleware on all paths except static assets.
 * This ensures the middleware only runs on page navigations, not every asset request.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.png|robots.txt|assets/).*)'],
};
