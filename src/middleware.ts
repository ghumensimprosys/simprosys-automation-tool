import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h

const enc = new TextEncoder();

async function hmacB64(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expiry = parseInt(payload, 10);
  if (isNaN(expiry) || Date.now() > expiry) return false;
  const secret = process.env.SESSION_SECRET ?? 'dev-secret-change-me';
  const expected = await hmacB64(payload, secret);
  return sig === expected;
}

export async function middleware(request: NextRequest) {
  // Auth is opt-in — skip entirely when ADMIN_PASSWORD is not configured
  if (!process.env.ADMIN_PASSWORD) return NextResponse.next();

  const { pathname } = request.nextUrl;

  // Always allow through: login page, auth API, Next.js internals, static files
  if (
    pathname === '/login' ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  const session = request.cookies.get('qa_session')?.value;
  if (await verifySession(session)) return NextResponse.next();

  // API requests get 401; page requests get redirected to /login
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'Unauthorized — visit /login to sign in' },
      { status: 401 },
    );
  }
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

// ── Exported helper (used by the login route) ──────────────────────────────────

export async function createSessionToken(): Promise<string> {
  const expiry = (Date.now() + SESSION_EXPIRY_MS).toString();
  const secret = process.env.SESSION_SECRET ?? 'dev-secret-change-me';
  const sig = await hmacB64(expiry, secret);
  return `${expiry}.${sig}`;
}
