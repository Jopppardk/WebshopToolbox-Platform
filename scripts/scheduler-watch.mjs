// External watch on the production scheduler, run by .github/workflows/platform-scheduler-watch.yml.
// The operations check inside the Worker cannot report a cron that has stopped altogether, so this asks
// GET /healthz/scheduler from outside and fails (GitHub mails the owner) when it does not answer ok.
// Network errors are retried a few times; a 503 with ok:false is the answer and is not retried.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const schedulerUrl =
  'https://portal.webshoptoolbox.dk/healthz/scheduler';

export async function checkScheduler({
  fetcher = fetch,
  attempts = 3,
  pauseMs = 30_000,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response;
    try {
      response = await fetcher(schedulerUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
        headers: { 'Cache-Control': 'no-cache' },
      });
    } catch (error) {
      lastError = `Ingen forbindelse til ${schedulerUrl}: ${error.message}`;
      if (attempt < attempts) await sleep(pauseMs);
      continue;
    }
    let data = null;
    try {
      data = await response.json();
    } catch {
      /* Not the Worker's JSON answer. */
    }
    if (response.status === 200 && data?.ok === true)
      return `Den automatiske kørsel er sund (seneste gennemførte kørsel for ${data.minutesSinceLastRun ?? '?'} minutter siden).`;
    if (response.status === 503 && data?.ok === false)
      throw Error(
        data.minutesSinceLastRun === null
          ? 'Den automatiske kørsel har aldrig gennemført en kørsel.'
          : `Den automatiske kørsel har ikke gennemført en kørsel i ${data.minutesSinceLastRun} minutter.`,
      );
    lastError = `${schedulerUrl} svarede ${response.status} uden gyldigt svar.`;
    if (attempt < attempts) await sleep(pauseMs);
  }
  throw Error(lastError);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  checkScheduler()
    .then(console.log)
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
