import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
export function loader(overrides = {}) {
  const cache = new Map();
  return function load(file) {
    const full = path.resolve(root, file);
    if (cache.has(full)) return cache.get(full);
    const exports = {};
    cache.set(full, exports);
    const code = ts.transpileModule(readFileSync(full, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    // oxlint-disable-next-line typescript/no-implied-eval -- Execute repository TypeScript with isolated fixture dependencies, never user input.
    new Function('exports', 'require', 'fetch', code)(
      exports,
      (name) => {
        if (name in overrides) return overrides[name];
        return load(
          (name.startsWith('@/')
            ? path.join(root, name.slice(2))
            : path.resolve(path.dirname(full), name)) + '.ts',
        );
      },
      overrides.fetch ||
        (() => {
          throw Error('Unexpected network call in isolated test');
        }),
    );
    return exports;
  };
}
