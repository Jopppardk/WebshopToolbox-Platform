import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)],
  );
const label = (file) => relative(root, file).split(sep).join('/');
function closure(file, seen = new Set()) {
  if (seen.has(file) || !existsSync(file)) return seen;
  seen.add(file);
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(
    /(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g,
  )) {
    const name = match[1];
    if (!name.startsWith('.') && !name.startsWith('@/')) continue;
    const full = name.startsWith('@/')
      ? resolve(root, name.slice(2))
      : resolve(dirname(file), name);
    for (const candidate of [
      full,
      full + '.ts',
      full + '.tsx',
      resolve(full, 'index.ts'),
    ])
      if (existsSync(candidate) && /\.[cm]?[jt]sx?$/.test(candidate)) {
        closure(candidate, seen);
        break;
      }
  }
  return seen;
}
const routes = walk(resolve(root, 'app/api'))
  .filter((f) => f.endsWith('route.ts'))
  .sort();
let out =
  '# Isolationsregister – eksisterende ruter og datalag\n\nGenereret med `node scripts/platform-inventory.mjs`. Kilden er den lokale platformbranch; ingen produktionsdata er læst. Registret kortlægger statiske imports, SQL-tabeller og operationer. Dynamiske settings-nøgler og semantisk dataejerskab skal stadig følges ved P06-konvertering; dette er ikke bevis for isolation i legacy-appen.\n\nAlle nedenstående legacy-ruter er **udeladt af test-Workerens importgraf** og afvises i tests. Ingen af dem genbruges som admin-API. P06 ejer dataadskillelsen; finansielle writes og leases ligger desuden i P08.\n\n| Route | Metoder | Tabeller i afhængigheder | Filer i importgraf | Leverance |\n| --- | --- | --- | ---: | --- |\n';
for (const file of routes) {
  const source = readFileSync(file, 'utf8'),
    deps = [...closure(file)],
    joined = deps.map((f) => readFileSync(f, 'utf8')).join('\n');
  const tables = [
    ...new Set(
      [...joined.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z_0-9]*)/gi)]
        .map((m) => m[1])
        .filter(
          (t) =>
            !['set', 'the', 'your', 'a', 'this', 'select', 'or'].includes(
              t.toLowerCase(),
            ),
        ),
    ),
  ].sort();
  const methods = [
    ...source.matchAll(
      /export\s+(?:async\s+)?function\s+(GET|POST|PATCH|DELETE|PUT)\b/g,
    ),
  ].map((m) => m[1]);
  out += `| /${label(file)
    .replace(/^app\//, '')
    .replace(
      /\/route.ts$/,
      '',
    )} | ${methods.join(', ')} | ${tables.map((x) => '\`' + x + '\`').join(', ')} | ${deps.length} | P06/P08 |\n`;
}
out +=
  '\n## Datalag og ressourceadgang\n\n| Fil | Lokale adgangssignaler | Mål / næste ændring |\n| --- | --- | --- |\n';
const files = [
  ...walk(resolve(root, 'db')),
  resolve(root, 'worker-entry.ts'),
  ...walk(resolve(root, 'lib')).filter((f) => f.endsWith('.ts')),
];
let count = 0;
for (const file of files.sort()) {
  const source = readFileSync(file, 'utf8'),
    signals = [];
  if (/\.prepare\(/.test(source)) signals.push('SQL');
  if (/\bfetch\(/.test(source)) signals.push('HTTP');
  if (/INVOICES|\.put\(|\.get\(key/.test(source)) signals.push('dokumentlager');
  if (/\.send\(|cloudflare:email/.test(source)) signals.push('mail');
  if (/credential|ciphertext/i.test(source)) signals.push('credentials');
  if (/lock|lease|cursor/i.test(source)) signals.push('lås/fremdrift');
  if (/tenant|sablen|LA Trading/.test(source)) signals.push('legacy-ejer');
  if (!signals.length) continue;
  count++;
  out += `| \`${label(file)}\` | ${signals.join(', ')} | Scoped kontekst og ejerskab i P06; jobs/writes i P08. Udeladt fra admin-Worker. |\n`;
}
out += `\nOmfang: ${routes.length} API-ruter og ${count} datalag-/runtimefiler med adgangssignaler. Tabellen er en reproducerbar teknisk fortegnelse; se ADR-001.md for de besluttede ejerskabsregler og ADMIN-FOUNDATION.md for det implementerede udsnit.\n`;
writeFileSync(resolve(root, 'docs/platform/ISOLATION-INVENTORY.md'), out);
console.log(`Kortlagt ${routes.length} ruter og ${count} runtimefiler.`);
