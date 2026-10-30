// Temporary diagnostic (removed again): which public/customer tracking endpoints GLS and DAO answer on.
const show = async (label, url, init = {}) => {
  try {
    const r = await fetch(url, { redirect: 'manual', ...init });
    const body = await r.text();
    console.log('==', label, r.status, r.headers.get('content-type'), r.headers.get('location') || '');
    console.log(body.slice(0, 1200).replace(/\s+/g, ' '));
    return body;
  } catch (e) {
    console.log('==', label, 'ERROR', e.message);
    return '';
  }
};
await show('gls rstt001', 'https://gls-group.eu/app/service/open/rest/DK/da/rstt001?match=084154560436', { headers: { Accept: 'application/json' } });
await show('gls rstt029', 'https://gls-group.eu/app/service/open/rest/DK/da/rstt029?match=084154560436', { headers: { Accept: 'application/json' } });
await show('gls find-pakke', 'https://gls-group.eu/DK/da/find-pakke?match=084154560436');
await show('dao trackntrace v2 no creds', 'https://api.dao.as/TrackNTrace_v2.php?stregkode=00057151273853840&format=json');
await show('dao trackntrace no creds', 'https://api.dao.as/TrackNTrace.php?stregkode=00057151273853840&format=json');
const page = await show('dao find-din-pakke', 'https://dao.as/find-din-pakke/');
console.log('scripts:', [...page.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]).join('\n'));
console.log('api-ish:', [...new Set(page.match(/https?:\/\/[a-z0-9.-]*dao\.as\/[^"' )<>]*/g) || [])].join('\n'));
for (const m of page.matchAll(/<script[^>]+src="([^"]+)"/g)) {
  const src = new URL(m[1], 'https://dao.as/').toString();
  if (!/dao/.test(src)) continue;
  const r = await fetch(src);
  const js = await r.text();
  const hits = [...new Set(js.match(/https?:\/\/[a-z0-9.-]+\/[A-Za-z0-9_\/.-]*(track|Track|pakke|parcel)[A-Za-z0-9_\/.-]*/g) || [])];
  const rel = [...new Set(js.match(/["'`]\/?(wp-json|api)\/[^"'`]{0,80}["'`]/g) || [])];
  if (hits.length || rel.length) console.log('JS', src, '\n ', hits.join('\n  '), '\n ', rel.join('\n  '));
}
