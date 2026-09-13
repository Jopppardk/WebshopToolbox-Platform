import { authenticate } from './auth';
import { handleAdmin } from './admin';
import { assertTestRuntime, scheduled } from './safety';
import { HttpError, reply, type PlatformEnv } from './types';

function secure(response: Response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'same-origin');
  headers.set(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  return new Response(response.body, { status: response.status, headers });
}
export default {
  async fetch(request: Request, env: PlatformEnv) {
    try {
      assertTestRuntime(env);
      const path = new URL(request.url).pathname;
      if (path === '/healthz' && request.method === 'GET')
        return secure(
          reply({
            status: 'ok',
            environment: env.PLATFORM_ENV,
            bookkeeping: 'blocked',
            customerEmail: 'blocked',
          }),
        );
      if (
        path === '/local-login' &&
        env.PLATFORM_ENV === 'local-test' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(
          new URL(request.url).hostname,
        )
      ) {
        if (request.method === 'GET')
          return secure(
            new Response(
              `<!doctype html><html lang="da"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Lokal testadgang</title><body><h1>Lokal testadgang</h1><p>Indsæt en lokal testsession fra scripts/platform.mjs local-session.</p><form method="post"><label>Testsession <input type="password" name="token" required autocomplete="off" maxlength="2048"></label><button>Åbn administration</button></form></body></html>`,
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
            ),
          );
        if (request.method === 'POST') {
          if (request.headers.get('origin') !== new URL(request.url).origin)
            throw new HttpError(403, 'Start fra den lokale loginside.');
          const raw = await request.text();
          if (raw.length > 4096)
            throw new HttpError(413, 'Testsessionen er for stor.');
          const token = new URLSearchParams(raw).get('token') || '';
          if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token))
            throw new HttpError(401, 'Ugyldig testsession.');
          await authenticate(
            new Request(request.url, {
              headers: { authorization: `Bearer ${token}` },
            }),
            env,
          );
          return secure(
            new Response(null, {
              status: 303,
              headers: {
                Location: '/',
                'Set-Cookie': `platform_local=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`,
              },
            }),
          );
        }
      }
      const actor = await authenticate(request, env);
      if (path.startsWith('/api/platform/'))
        return secure(await handleAdmin(request, env.PLATFORM_DB, actor));
      if (
        request.method === 'GET' &&
        ['/', '/index.html', '/admin.js', '/styles.css'].includes(path)
      )
        return secure(await env.ASSETS.fetch(request));
      throw new HttpError(
        404,
        'Funktionen findes ikke i administrationens testmiljø.',
      );
    } catch (error) {
      if (error instanceof HttpError)
        return secure(reply({ error: error.message }, error.status));
      // Never expose SQL, tokens, provider errors or user payloads.
      if (
        error instanceof Error &&
        /UNIQUE constraint failed|FOREIGN KEY constraint failed/.test(
          error.message,
        )
      )
        return secure(
          reply(
            { error: 'Data findes allerede, eller relationen er ugyldig.' },
            409,
          ),
        );
      return secure(
        reply({ error: 'Handlingen kunne ikke gennemføres.' }, 500),
      );
    }
  },
  async scheduled(_event: ScheduledController, env: PlatformEnv) {
    assertTestRuntime(env);
    return scheduled();
  },
};
