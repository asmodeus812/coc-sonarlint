// Golden snapshot of the SonarLint views' htmlview output (not shipped): `CHECKOUT_HTMLVIEW=<coc-htmlview> node
// tests/integration/golden/dump.mjs <outdir>` (default .cache/golden/cur). Bundles entry.ts with htmlview's `open`
// replaced by view-shim.ts, then runs it from the repo root. Compare two dumps with `diff -r <a> <b>`.
import * as esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
if (!process.env.CHECKOUT_HTMLVIEW) {
  console.error('set CHECKOUT_HTMLVIEW to a coc-htmlview checkout');
  process.exit(2);
}
const htmlview = resolve(process.env.CHECKOUT_HTMLVIEW);
const bundle = resolve(root, '.cache/golden/entry.js');
await esbuild.build({
  entryPoints: [resolve(here, 'entry.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs',
  loader: { '.css': 'text', '.lua': 'text' }, external: ['coc.nvim'], logLevel: 'warning',
  nodePaths: [join(htmlview, 'node_modules')],
  plugins: [{ name: 'htmlview', setup(b) {
    b.onResolve({ filter: /^@htmlview-tests\// }, (a) => b.resolve(join(htmlview, 'tests', a.path.slice('@htmlview-tests/'.length)), { resolveDir: htmlview, kind: a.kind }));
    b.onResolve({ filter: /^@htmlview\// }, (a) => b.resolve(join(htmlview, 'src', a.path.slice('@htmlview/'.length)), { resolveDir: htmlview, kind: a.kind }));
    b.onResolve({ filter: /^\.\/view$/ }, (a) => (a.importer === join(htmlview, 'src/render.ts') ? { path: resolve(here, 'view-shim.ts') } : undefined));
  } }],
});
const outdir = resolve(process.argv[2] ?? resolve(root, '.cache/golden/cur'));
const result = spawnSync(process.execPath, [bundle, outdir], { stdio: 'inherit', cwd: root });
process.exit(result.status ?? 1);
