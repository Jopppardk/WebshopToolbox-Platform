// Temporary diagnostic (removed again): reads two public tracking pages and runs the platform parser on them.
import { loader } from '../lib/automation-test-fixture.mjs';
const t = loader({})('platform/public-tracking.ts');
for (const [carrier, number] of [
  ['gls', '084154560436'],
  ['dao', '00057151273853840'],
]) {
  const url = `https://track.shipmondo.com/${carrier}/${number}`;
  const r = await fetch(url, {
    redirect: 'manual',
    headers: { Accept: 'text/html', 'Accept-Language': 'da-DK,da;q=0.9' },
  });
  const html = await r.text();
  console.log(
    '==',
    url,
    r.status,
    r.headers.get('content-type'),
    r.headers.get('location'),
    html.length,
  );
  const i = html.search(/window\.tracking\s*=/);
  console.log('window.tracking at', i);
  console.log(i >= 0 ? html.slice(i, i + 1500) : html.slice(0, 1500));
  try {
    const target = t.trackingTarget({
      carrier,
      trackingNumber: number,
      trackingUrl: url,
    });
    console.log('target', JSON.stringify(target));
    const p = t.parsePublicTracking(
      html,
      target,
      new Date(Date.now() - 5 * 86400000).toISOString(),
    );
    console.log('parsed OK', p.status, p.events.length);
  } catch (e) {
    console.log('PARSE ERROR', e && e.message);
  }
}
