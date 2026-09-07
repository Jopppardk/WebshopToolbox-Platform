const [clientId, clientSecret] = process.argv.slice(2);
if (!clientId || !clientSecret) {
  console.error('Cloudflare-legitimationsoplysninger mangler.');
  process.exit(2);
}

const response = await fetch(
  'https://integration.sablen.dk/api/admin/feature-requests',
  {
    redirect: 'manual',
    headers: {
      'CF-Access-Client-Id': clientId,
      'CF-Access-Client-Secret': clientSecret,
    },
  },
);
const body = await response.text();
if (!response.ok) {
  const location = response.headers.get('location');
  const destination = location
    ? (() => {
        const target = new URL(location, response.url);
        return `${target.hostname}${target.pathname}`;
      })()
    : '';
  console.error(
    `Cloudflare returnerede HTTP ${response.status}${destination ? ` og sendte videre til ${destination}` : ''}.`,
  );
  process.exit(3);
}
if (!response.headers.get('content-type')?.includes('application/json')) {
  console.error(
    'Cloudflare viste login-siden. Service Auth-policyen mangler eller matcher ikke tokenet.',
  );
  process.exit(4);
}
process.stdout.write(body);
