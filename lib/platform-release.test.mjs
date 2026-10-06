import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  dispatchRelease,
  githubApi,
  githubToken,
  releaseStatus,
} from '../scripts/platform-release.mjs';
import { checkReleaseHealth } from '../scripts/platform-release-health.mjs';
import { isPlatformDeployRef } from '../scripts/platform-repository.mjs';

const sha = 'a'.repeat(40);
function fakeApi({ current = sha, fail = false } = {}) {
  const calls = [];
  const api = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (path.endsWith('/branches/main')) return { commit: { sha: current } };
    if (options.method === 'POST') {
      if (fail) throw Error('timeout');
      return { workflow_run_id: 42 };
    }
    return { state: 'active' };
  };
  return { api, calls };
}

test('Cloud dispatch pins an approved main SHA and sends exactly one request', async () => {
  const { api, calls } = fakeApi();
  assert.deepEqual(await dispatchRelease(api, 'prod', sha, 'request-123'), {
    requestId: 'request-123',
    runId: 42,
  });
  const writes = calls.filter((c) => c.method === 'POST');
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body, {
    ref: 'main',
    inputs: { target: 'prod', expected_sha: sha, request_id: 'request-123' },
  });
});
test('changed main and invalid release inputs stop before writes', async () => {
  for (const [target, commit] of [
    ['sablen', sha],
    ['prod', 'main'],
    ['dev', sha],
  ]) {
    const { api, calls } = fakeApi({ current: 'b'.repeat(40) });
    await assert.rejects(dispatchRelease(api, target, commit));
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
  }
});
test('ambiguous dispatch is never retried and reports its correlation ID', async () => {
  const { api, calls } = fakeApi({ fail: true });
  await assert.rejects(
    dispatchRelease(api, 'prod', sha, 'request-123'),
    /Udfaldet kan være ukendt.*request-123/,
  );
  assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
});
test('token stays out of curl arguments and errors; proxy configuration is honoured', async () => {
  const token = 'github_pat_SYNTHETIC';
  let observed;
  const api = githubApi(token, (cmd, args, options) => {
    observed = { cmd, args, options };
    return { status: 0, stdout: '{"state":"active"}\n200' };
  });
  await api(
    '/repos/Jopppardk/WebshopToolbox-Platform/actions/workflows/platform-deploy.yml',
  );
  assert.equal(observed.cmd, 'curl');
  assert.ok(observed.options.input.includes(token));
  assert.ok(!observed.args.join(' ').includes(token));
  assert.ok(!observed.args.includes('--noproxy'));
  assert.ok(!observed.args.includes('--location'));
  const denied = githubApi(token, () => ({
    status: 0,
    stdout: `${token}\n403`,
  }));
  await assert.rejects(
    denied('/repos/Jopppardk/WebshopToolbox-Platform/branches/main'),
    (e) => e.message.includes('403') && !e.message.includes(token),
  );
  await assert.rejects(api('/repos/other/repo/branches/main'));
});
test('runtime token or existing gh session required; no setup secret persistence', () => {
  assert.equal(
    githubToken({ GH_TOKEN: 'synthetic' }, () => {
      throw Error('unused');
    }),
    'synthetic',
  );
  assert.equal(
    githubToken({}, () => ({ status: 0, stdout: 'session-token\n' })),
    'session-token',
  );
  assert.throws(() => githubToken({}, () => ({ status: 1 })), /agentfasen/);
});
test('only the exact main workflow checkout is deployable in Actions', () => {
  const env = {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'Jopppardk/WebshopToolbox-Platform',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: sha,
  };
  assert.ok(isPlatformDeployRef('', sha, env));
  assert.equal(isPlatformDeployRef('main', 'b'.repeat(40), env), false);
  assert.equal(
    isPlatformDeployRef('', sha, {
      ...env,
      GITHUB_REF: 'refs/heads/platform/unreviewed',
    }),
    false,
  );
  assert.equal(
    isPlatformDeployRef('', sha, { ...env, GITHUB_REPOSITORY: 'other/fork' }),
    false,
  );
  assert.equal(isPlatformDeployRef('', sha, {}), false);
  assert.ok(isPlatformDeployRef('platform/local', sha, {}));
});
test('run status never treats queued runs or unrelated workflows as a completed release', async () => {
  const run = {
    path: '.github/workflows/platform-deploy.yml',
    event: 'workflow_dispatch',
    head_branch: 'main',
    head_sha: sha,
    status: 'queued',
    conclusion: null,
  };
  assert.equal((await releaseStatus(async () => run, 42)).status, 'queued');
  await assert.rejects(
    releaseStatus(
      async () => ({ ...run, path: '.github/workflows/platform-check.yml' }),
      42,
    ),
  );
});

function healthFetch(target, override = {}) {
  const vars = JSON.parse(
    readFileSync(
      new URL(
        target === 'dev'
          ? '../wrangler.platform-test.json'
          : '../wrangler.platform-production.json',
        import.meta.url,
      ),
    ),
  ).vars;
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    const path = new URL(url).pathname;
    if (override[path]) return override[path]();
    if (path === '/healthz')
      return Response.json({
        status: 'ok',
        environment: vars.PLATFORM_ENV,
        bookkeeping: vars.PLATFORM_EXTERNAL_WRITES,
        customerEmail: vars.PLATFORM_CUSTOMER_EMAIL,
      });
    if (path === '/login')
      return new Response('<html>Login</html>', {
        headers: { 'content-type': 'text/html' },
      });
    if (path === '/api/orders') return new Response(null, { status: 401 });
    return new Response(null, {
      status: 302,
      headers: {
        location: `${vars.PLATFORM_ACCESS_ISSUER}/cdn-cgi/access/login/example`,
      },
    });
  };
  return { fetcher, calls };
}
test('release smoke checks use only public GETs in the selected environment', async () => {
  for (const target of ['dev', 'prod']) {
    const { fetcher, calls } = healthFetch(target);
    assert.match(await checkReleaseHealth(target, fetcher), /OK/);
    assert.equal(calls.length, 4);
    for (const c of calls) {
      assert.equal(c.options.method, 'GET');
      assert.equal(c.options.redirect, 'manual');
      assert.equal(
        new URL(c.url).hostname,
        target === 'dev' ? 'dev.webshoptoolbox.dk' : 'portal.webshoptoolbox.dk',
      );
    }
  }
});
test('release gate rejects blocked health, wrong safety flags, exposed API and wrong Access redirect', async () => {
  const bad = [
    { '/healthz': () => new Response(null, { status: 403 }) },
    {
      '/healthz': () =>
        Response.json({
          status: 'ok',
          environment: 'remote-test',
          bookkeeping: 'enabled',
          customerEmail: 'blocked',
        }),
    },
    { '/login': () => new Response(null, { status: 302 }) },
    { '/api/orders': () => new Response('{}', { status: 200 }) },
    {
      '/admin/': () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://example.test/login' },
        }),
    },
  ];
  for (const override of bad)
    await assert.rejects(
      checkReleaseHealth('dev', healthFetch('dev', override).fetcher),
    );
});
