import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repository = 'Jopppardk/WebshopToolbox-Platform';
const workflow = 'platform-deploy.yml';
const prefix = `/repos/${repository}`;
export const workflowUrl = `https://github.com/${repository}/actions/workflows/${workflow}`;

export function githubToken(env = process.env, run = spawnSync) {
  const configured = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (configured?.trim()) return configured.trim();
  const session = run('gh', ['auth', 'token', '--hostname', 'github.com'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000,
  });
  if (session.status === 0 && session.stdout?.trim()) return session.stdout.trim();
  throw Error('GitHub-adgang mangler. Se docs/platform/CODEX-CLOUD-DEPLOY.md: GH_TOKEN skal være tilgængelig under agentfasen; et setup-secret eller GitHub-connector-login er ikke en CLI-session.');
}

// curl honours the Cloud environment's HTTPS proxy. Send the credential via stdin,
// never in command-line arguments, request logs, Git, or a persistent file.
export function githubApi(token, run = spawnSync) {
  if (!/^[A-Za-z0-9_]+$/.test(token)) throw Error('Ugyldigt GitHub-tokenformat.');
  return async (path, { method = 'GET', body } = {}) => {
    if (!path.startsWith(`${prefix}/`) || !['GET', 'POST'].includes(method))
      throw Error('Kun platformrepositoryets GitHub-API må anvendes.');
    const args = ['-q', '--silent', '--show-error', '--max-time', '30',
      '--proto', '=https', '--request', method, '--url', `https://api.github.com${path}`,
      '--header', 'Accept: application/vnd.github+json',
      '--header', 'X-GitHub-Api-Version: 2026-03-10',
      '--header', 'Content-Type: application/json', '--config', '-',
      '--write-out', '\n%{http_code}'];
    if (body !== undefined) args.push('--data-binary', JSON.stringify(body));
    const result = run('curl', args, { encoding: 'utf8', timeout: 35_000,
      maxBuffer: 2 * 1024 * 1024, windowsHide: true,
      input: `header = "Authorization: Bearer ${token}"\n` });
    if (result.error || result.status !== 0)
      throw Error('GitHub-kaldet kunne ikke afsluttes. Kontrollér curl og Cloud-netværksadgang til api.github.com.');
    const boundary = result.stdout.lastIndexOf('\n');
    const status = Number(result.stdout.slice(boundary + 1));
    if (status < 200 || status > 299 || !Number.isInteger(status))
      throw Error(`GitHub HTTP ${status || 'ukendt'}: kontrollér tokenrettigheder, udløb og netværkets tilladte HTTP-metoder. Intet automatisk genforsøg.`);
    const content = result.stdout.slice(0, boundary);
    return content ? JSON.parse(content) : null;
  };
}

export async function preflight(api) {
  const branch = await api(`${prefix}/branches/main`);
  const available = await api(`${prefix}/actions/workflows/${workflow}`);
  if (!/^[a-f0-9]{40}$/.test(branch.commit?.sha) || available.state !== 'active')
    throw Error('Main eller udgivelsesworkflowet er ikke klar.');
  return branch.commit.sha;
}

export async function dispatchRelease(api, target, sha, requestId = randomUUID()) {
  if (!['dev', 'prod'].includes(target)) throw Error('Miljø skal være dev eller prod.');
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw Error('Angiv den godkendte main-commits fulde SHA med --sha.');
  if (!/^[A-Za-z0-9-]{1,64}$/.test(requestId)) throw Error('Ugyldigt sporings-ID.');
  if (await preflight(api) !== sha)
    throw Error('Den godkendte SHA er ikke længere main. Gennemgå den nye version før deployment.');
  try {
    const result = await api(`${prefix}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST', body: { ref: 'main', inputs: { target, expected_sha: sha, request_id: requestId } },
    });
    return { requestId, runId: result?.workflow_run_id ?? null };
  } catch (error) {
    throw Error(`${error.message} Udfaldet kan være ukendt; find sporings-ID ${requestId} på ${workflowUrl} før et nyt deployforsøg.`);
  }
}

export async function releaseStatus(api, runId) {
  if (!/^[1-9][0-9]*$/.test(String(runId))) throw Error('Angiv GitHub-run-ID.');
  const run = await api(`${prefix}/actions/runs/${runId}`);
  if (run.path !== `.github/workflows/${workflow}` || run.event !== 'workflow_dispatch' || run.head_branch !== 'main')
    throw Error('Kørslen er ikke platformens manuelle main-udgivelse.');
  return { sha: run.head_sha, status: run.status, conclusion: run.conclusion,
    url: `https://github.com/${repository}/actions/runs/${runId}` };
}

async function main(args) {
  const [command = 'check', flag, value, ...extra] = args;
  if (!['check', 'dev', 'prod', 'status'].includes(command) || extra.length ||
      (command === 'check' && flag) || (command === 'status' && value) ||
      (['dev', 'prod'].includes(command) && (flag !== '--sha' || !/^[a-f0-9]{40}$/.test(value || ''))))
    throw Error('Brug check | dev --sha <40 tegn> | prod --sha <40 tegn> | status <run-id>.');
  const api = githubApi(githubToken());
  if (command === 'check') {
    console.log(`GitHub-læseadgang og aktivt workflow OK. Main: ${await preflight(api)}\nActions-write bekræftes først ved dispatch. ${workflowUrl}`);
  } else if (command === 'status') {
    const result = await releaseStatus(api, flag);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status !== 'completed' ? 2 : result.conclusion === 'success' ? 0 : 1;
  } else {
    const result = await dispatchRelease(api, command, value);
    console.log(`Udgivelse bestilt; ikke færdigverificeret. Sporings-ID: ${result.requestId}`);
    console.log(result.runId ? `node scripts/platform-release.mjs status ${result.runId}` : `Find kørslen via sporings-ID på ${workflowUrl}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
