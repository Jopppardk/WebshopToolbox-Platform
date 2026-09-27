export interface PlatformEnv {
  PLATFORM_DB: D1Database;
  PLATFORM_DOCUMENTS: R2Bucket;
  ASSETS: Fetcher;
  PLATFORM_ENV: 'local-test' | 'remote-test' | 'production';
  PLATFORM_EXTERNAL_WRITES: 'blocked';
  PLATFORM_CUSTOMER_EMAIL: 'blocked';
  PLATFORM_AUTH: 'local-jwt' | 'cloudflare-access';
  PLATFORM_ACCESS_ISSUER?: string;
  PLATFORM_ACCESS_AUD?: string;
  PLATFORM_LOCAL_SECRET?: string;
  PLATFORM_CUSTOMER_LOGIN?: 'enabled';
  PLATFORM_ADMIN_HOST?: 'admin.webshoptoolbox.dk';
  PLATFORM_LOGIN_SECRET?: string;
  PLATFORM_AUTH_MAIL?: PlatformEnv['PLATFORM_MAIL_TEST'];
  PLATFORM_CREDENTIALS_KEY?: string;
  PLATFORM_MAIL_FROM?: string;
  PLATFORM_MAIL_TEST_RECIPIENTS?: string;
  PLATFORM_MAIL_TEST?: {send(message:{from:{email:string;name:string};to:string;replyTo?:string;subject:string;text:string;attachments?:{content:ArrayBuffer;filename:string;type:string;disposition:"attachment"}[]}):Promise<{messageId:string}>};
  PLATFORM_INVITATION_MODE?: 'preview' | 'restricted' | 'registered';
  PLATFORM_INVITATION_FROM?: string;
  PLATFORM_INVITATION_RECIPIENTS?: string;
  PLATFORM_INVITATIONS?: { send(message: {from:string;to:string;subject:string;text:string}): Promise<unknown> };
}
export type Actor = { support?: {sessionId:string;adminId:string;adminEmail:string;expiresAt:number}; id: string; email: string; platformAdmin: boolean; fullName?: string | null; phone?: string | null };
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
