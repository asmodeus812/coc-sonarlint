// Runs the unit tests: bundles every *.test.ts under the roots below with esbuild into .cache/test, then runs
// them with the built-in `node --test`. No test framework dependency. Extra arguments go to `node --test`
// (e.g. `npm test -- --test-name-pattern=layout`).
import * as esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// the SonarLint adapters and utilities; the integration tests (tests/integration) run against a coc-htmlview checkout
// and are skipped unless CHECKOUT_HTMLVIEW points at one.
const htmlview = process.env.CHECKOUT_HTMLVIEW ? resolve(process.env.CHECKOUT_HTMLVIEW) : undefined;
const roots = ['tests/util', 'tests/rules', 'tests/hotspot', 'tests/connected'];
if (htmlview !== undefined) {
  roots.push('tests/integration');
} else {
  console.log('integration tests skipped (set CHECKOUT_HTMLVIEW to a coc-htmlview checkout)');
}
// `@htmlview/<path>` is `<CHECKOUT_HTMLVIEW>/src/<path>`, `@htmlview-tests/<path>` its `tests/<path>` (test helpers)
const alias = {
  name: 'htmlview-alias',
  setup(b) {
    b.onResolve({ filter: /^@htmlview-tests\// }, (a) => b.resolve(join(htmlview, 'tests', a.path.slice('@htmlview-tests/'.length)), { resolveDir: htmlview, kind: a.kind }));
    b.onResolve({ filter: /^@htmlview\// }, (a) => b.resolve(join(htmlview, 'src', a.path.slice('@htmlview/'.length)), { resolveDir: htmlview, kind: a.kind }));
  },
};
const outbase = 'tests';
const outdir = '.cache/test';

function findTests(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? findTests(full) : name.endsWith('.test.ts') ? [full] : [];
  });
}

const entryPoints = roots.flatMap(findTests);
rmSync(outdir, { recursive: true, force: true });
await esbuild.build({
  entryPoints,
  outdir,
  outbase,
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  sourcemap: 'inline',
  external: ['coc.nvim'],
  loader: { '.css': 'text', '.lua': 'text' },
  plugins: htmlview === undefined ? [] : [alias],
  nodePaths: htmlview === undefined ? [] : [join(htmlview, 'node_modules')],
  logLevel: 'warning',
});

const files = entryPoints.map((f) => join(outdir, relative(outbase, f)).replace(/\.ts$/, '.js'));
const result = spawnSync(process.execPath, ['--enable-source-maps', '--test', ...process.argv.slice(2), ...files], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
