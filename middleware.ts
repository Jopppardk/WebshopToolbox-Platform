import { NextRequest, NextResponse } from 'next/server';

const allowedEmail = 'rene@sablen.dk';
const featureLogServiceClientId =
  process.env.FEATURE_LOG_SERVICE_CLIENT_ID?.trim().toLowerCase();

export function middleware(request: NextRequest) {
  if (process.env.NODE_ENV !== 'production') return NextResponse.next();
  const email = request.headers
    .get('cf-access-authenticated-user-email')
    ?.trim()
    .toLowerCase();
  const serviceClientId = request.headers
    .get('cf-access-client-id')
    ?.trim()
    .toLowerCase();
  const accessJwt = request.headers.get('cf-access-jwt-assertion');
  if (email === allowedEmail) return NextResponse.next();
  if (
    request.method === 'GET' &&
    request.nextUrl.pathname === '/api/admin/feature-requests' &&
    featureLogServiceClientId &&
    serviceClientId === featureLogServiceClientId &&
    accessJwt
  )
    return NextResponse.next();
  return new NextResponse('Adgang kræver Cloudflare Access for rene@sablen.dk.', {
    status: 401,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export const config = { matcher: '/:path*' };
