// Temporary diagnostic (removed again): DAO's own track-parcel endpoint and GLS' open lookups.
const show = async (label, url, init = {}) => {
  try {
    const r = await fetch(url, { redirect: 'manual', ...init });
    const body = await r.text();
    console.log('==', label, r.status, r.headers.get('content-type'), r.headers.get('location') || '');
    console.log(body.slice(0, 3000));
    return body;
  } catch (e) {
    console.log('==', label, 'ERROR', e.message);
    return '';
  }
};
const js = await (await fetch('https://dao.as/wp-content/themes/dao-wp/public/app.js')).text();
for (const m of js.matchAll(/TRACK_PARCEL_API/g)) console.log('JS', js.slice(Math.max(0, m.index - 600), m.index + 900));
const page = await (await fetch('https://dao.as/find-din-pakke/')).text();
const api = JSON.parse(page.match(/var TRACK_PARCEL_API = (\{.*?\});/)[1]);
console.log('API', api);
const dao = '00057151273853840';
await show('dao get no nonce', `${api.endpoint}?barcode=${dao}&lang=DA`);
await show('dao get q', `${api.endpoint}?q=${dao}&lang=DA`, { headers: { 'X-WP-Nonce': api.nonce } });
await show('dao get barcode nonce', `${api.endpoint}?barcode=${dao}&lang=DA`, { headers: { 'X-WP-Nonce': api.nonce } });
await show('dao post', api.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': api.nonce }, body: JSON.stringify({ barcode: dao, lang: 'DA' }) });
const gls = '084154560436';
for (const n of ['rstt028', 'rstt027', 'rstt030', 'rstt031', 'rstt002', 'rstt003'])
  await show('gls ' + n, `https://gls-group.eu/app/service/open/rest/DK/da/${n}?match=${gls}`, { headers: { Accept: 'application/json' } });
await show('gls 029 current', `https://gls-group.eu/app/service/open/rest/DK/da/rstt029?match=${gls}`, { headers: { Accept: 'application/json' } });
