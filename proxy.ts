import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, sessionCookieOptions, verifySession } from '@/lib/session';

const PUBLIC_PATHS = ['/lock', '/api/version'];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Every screen is behind the PIN.
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  if (session.valid) {
    if (pathname === '/lock') return NextResponse.redirect(new URL('/', request.url));
    const response = NextResponse.next({ request });
    if (session.refreshed) response.cookies.set(SESSION_COOKIE, session.refreshed, sessionCookieOptions());
    return response;
  }

  if (isPublic(pathname)) return NextResponse.next({ request });

  // Server actions check the session themselves, so only page loads are redirected here.
  if (request.method !== 'GET' && request.method !== 'HEAD') return NextResponse.next({ request });

  const lock = new URL('/lock', request.url);
  if (pathname !== '/') lock.searchParams.set('next', `${pathname}${search}`);
  const res = NextResponse.redirect(lock);
  if (request.cookies.get(SESSION_COOKIE)) res.cookies.delete(SESSION_COOKIE);
  return res;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|sw.js|manifest.webmanifest|icons/|favicon.ico|offline.html|.*\\.(?:png|svg|ico|jpg|jpeg|webp|woff2?)$).*)',
  ],
};
