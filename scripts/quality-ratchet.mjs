// Lint and formatting may only get better (npm run lint, also in CI).
// - Lint: oxlint findings per file and rule may not exceed scripts/lint-baseline.json.
// - Formatting: every file must match oxfmt, except those still listed in scripts/format-baseline.json.
//   New files are therefore always formatted; a listed file leaves the list once it has been formatted.
// After fixing findings or formatting a file, run `npm run lint:update` to lock the improvement in.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const bin = (name, path) =>
  resolve(dirname(require.resolve(`${name}/package.json`)), path);
const update = process.argv.includes('--update');
const lintFile = 'scripts/lint-baseline.json',
  formatFile = 'scripts/format-baseline.json';
const slash = (file) => file.replaceAll('\\', '/').replace(/^\.\//, '');

function run(path, args) {
  const result = spawnSync(process.execPath, [path, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

const lint = JSON.parse(
  run(bin('oxlint', 'bin/oxlint'), ['--format', 'json']).stdout,
).diagnostics;
const counts = {};
for (const d of lint) {
  const key = `${slash(d.filename)} :: ${d.code}`;
  counts[key] = (counts[key] || 0) + 1;
}
const unformatted = run(bin('oxfmt', 'bin/oxfmt'), ['--list-different'])
  .stdout.split(/\r?\n/)
  .map(slash)
  .filter(Boolean)
  .sort();

if (update) {
  writeFileSync(
    lintFile,
    JSON.stringify(Object.fromEntries(Object.entries(counts).sort()), null, 1) +
      '\n',
  );
  writeFileSync(formatFile, JSON.stringify(unformatted, null, 1) + '\n');
  console.log(
    `Baseline opdateret: ${lint.length} lint-fund, ${unformatted.length} uformaterede filer.`,
  );
  process.exit(0);
}

const lintBaseline = JSON.parse(readFileSync(lintFile, 'utf8')),
  formatBaseline = new Set(JSON.parse(readFileSync(formatFile, 'utf8')));
const worse = Object.keys(counts).filter(
  (key) => counts[key] > (lintBaseline[key] || 0),
);
const newlyUnformatted = unformatted.filter(
  (file) => !formatBaseline.has(file),
);
for (const key of worse) {
  const [file, code] = key.split(' :: ');
  console.error(
    `Nye lint-fund i ${file} (${code}): ${counts[key]} mod tidligere ${lintBaseline[key] || 0}`,
  );
  for (const d of lint.filter(
    (d) => slash(d.filename) === file && d.code === code,
  ))
    console.error(
      `  ${file}:${d.labels?.[0]?.span?.line ?? '?'} ${d.message.split('\n')[0]}`,
    );
}
for (const file of newlyUnformatted)
  console.error(`Ikke formateret: ${file} (kør npx oxfmt ${file})`);
const baselineTotal = Object.values(lintBaseline).reduce((a, b) => a + b, 0);
const better = baselineTotal - lint.length,
  formatted = [...formatBaseline].filter(
    (file) => !unformatted.includes(file),
  ).length;
if (worse.length || newlyUnformatted.length) {
  console.error(
    'Lint eller formatering er blevet dårligere. Ret fundene ovenfor; se scripts/quality-ratchet.mjs.',
  );
  process.exit(1);
}
console.log(
  `Lint: ${lint.length} fund (baseline ${baselineTotal}). Formatering: ${unformatted.length} filer mangler (baseline ${formatBaseline.size}).`,
);
if (better > 0 || formatted > 0)
  console.log(
    'Forbedret siden baseline. Kør npm run lint:update for at låse forbedringen.',
  );
