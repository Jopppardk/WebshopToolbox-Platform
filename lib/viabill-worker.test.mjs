import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Miniflare } from 'miniflare';

// Actual Workerd runtime with an intercepted outbound service: no live keys,
// network calls, database writes or production records. This catches options
// that Node's fetch supports but our deployed Worker runtime rejects.
test('ViaBill client runs in Workerd and rejects redirects without following them', async () => {
  const source = ts.transpileModule(readFileSync(new URL('./viabill.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  let calls = 0; let redirect = false;
  const mf = new Miniflare({ modules: true, compatibilityDate: '2026-05-15', script: source + `
    export default { async fetch() {
      try { return Response.json({ accounts: await accounts({apiKey:"fixture-key",secret:"fixture-secret"}) }); }
      catch(error) { return Response.json({error:publicError(error)}, {status:400}); }
    } }`,
    outboundService: async request => {
      calls++;
      assert.equal(new URL(request.url).origin, 'https://secure.viabill.com');
      return redirect ? new Response(null, { status: 302, headers: { Location: 'https://other.example' } }) : Response.json([{ accountId: 4566, name: 'Fixture' }]);
    },
  });
  try {
    const response = await mf.dispatchFetch('http://localhost/');
    assert.equal(response.status, 200); assert.equal((await response.json()).accounts[0].id, '4566'); assert.equal(calls, 1);
    redirect = true;
    const blocked = await mf.dispatchFetch('http://localhost/');
    assert.equal(blocked.status, 400); assert.match((await blocked.json()).error, /omdirigerede/); assert.equal(calls, 2);
  } finally { await mf.dispose(); }
});
