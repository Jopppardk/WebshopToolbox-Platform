export interface PlatformEnv {
  PLATFORM_DB: D1Database;
  PLATFORM_DOCUMENTS: R2Bucket;
  ASSETS: Fetcher;
  PLATFORM_ENV: 'local-test' | 'remote-test';
  PLATFORM_EXTERNAL_WRITES: 'blocked';
  PLATFORM_CUSTOMER_EMAIL: 'blocked';
  PLATFORM_AUTH: 'local-jwt' | 'cloudflare-access';
  PLATFORM_ACCESS_ISSUER?: string;
  PLATFORM_ACCESS_AUD?: string;
  PLATFORM_LOCAL_SECRET?: string;
}
export type Actor = { id: string; email: string; platformAdmin: boolean };
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function reply(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
