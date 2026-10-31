// Temporary diagnostic (removed again): response shape of DAO's track-parcel endpoint and GLS rstt029.
const show = async (label, url, init = {}) => {
  try {
    const r = await fetch(url, { redirect: 'manual', ...init });
    const body = await r.text();
    console.log('==', label, r.status, r.headers.get('content-type'), r.headers.get('location') || '');
    console.log(body.slice(0, 6000));
  } catch (e) {
    console.log('==', label, 'ERROR', e.message);
  }
};
const dao = 'https://dao.as/wp-json/dao-wp/v1/track-parcel';
for (const n of ['00057151273855884362', '00057151273853841800', '00057151273844255647'])
  await show('dao ' + n, `${dao}?barcode=${n}&lang=DA`, { headers: { Accept: 'application/json' } });
await show('dao unknown', `${dao}?barcode=00057151270000000000&lang=DA`, { headers: { Accept: 'application/json' } });
for (const n of ['084154470445', '084154372435'])
  await show('gls ' + n, `https://gls-group.eu/app/service/open/rest/DK/da/rstt029?match=${n}`, { headers: { Accept: 'application/json' } });
await show('gls unknown', 'https://gls-group.eu/app/service/open/rest/DK/da/rstt029?match=084100000000', { headers: { Accept: 'application/json' } });
