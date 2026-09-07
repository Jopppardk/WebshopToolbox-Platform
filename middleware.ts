import { NextRequest, NextResponse } from 'next/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const allowedEmail = 'rene@sablen.dk';
const featureLogServiceClientId =
  process.env.FEATURE_LOG_SERVICE_CLIENT_ID?.trim().toLowerCase();
const accessTeamDomain = process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN?.trim();
const accessAudience = process.env.CLOUDFLARE_ACCESS_AUD?.trim();
const accessKeys = accessTeamDomain
  ? createRemoteJWKSet(new URL(`${accessTeamDomain}/cdn-cgi/access/certs`))
  : null;

export async function middleware(request: NextRequest) {
  if (process.env.NODE_ENV !== 'production') return NextResponse.next();
  const email = request.headers
    .get('cf-access-authenticated-user-email')
    ?.trim()
    .toLowerCase();
  const accessJwt = request.headers.get('cf-access-jwt-assertion');
  if (email === allowedEmail) return NextResponse.next();
  if (
    request.method === 'GET' &&
    request.nextUrl.pathname === '/api/admin/feature-requests' &&
    featureLogServiceClientId &&
    accessJwt &&
    accessKeys &&
    accessTeamDomain &&
    accessAudience
  ) {
    try {
      const { payload } = await jwtVerify(accessJwt, accessKeys, {
        issuer: accessTeamDomain,
        audience: accessAudience,
      });
      if (
        typeof payload.common_name === 'string' &&
        payload.common_name.trim().toLowerCase() === featureLogServiceClientId
      )
        return NextResponse.next();
    } catch {
      // Afvis nedenfor uden at afsløre JWT- eller valideringsdetaljer.
    }
  }
  return new NextResponse('Adgang kræver Cloudflare Access for rene@sablen.dk.', {
    status: 401,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export const config = { matcher: '/:path*' };
