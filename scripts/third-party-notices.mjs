// Regenerates THIRD_PARTY_NOTICES.txt from the npm packages esbuild bundles into lib/index.js.
// Run from the repo root: node scripts/third-party-notices.mjs [--check]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const esbuild = require('esbuild');
const src = fs.readFileSync('esbuild.mjs', 'utf8');
const m = src.match(/const options = (\{[\s\S]*?\n\});/);
const options = new Function('process', `return ${m[1]}`)(process);
const res = await esbuild.build({ ...options, metafile: true, write: false });

const dirs = new Set();
for (const f of Object.keys(res.metafile.inputs)) {
  const i = f.lastIndexOf('node_modules/');
  if (i >= 0) {
    const rest = f.slice(i + 13).split('/');
    const name = rest[0].startsWith('@') ? rest.slice(0, 2).join('/') : rest[0];
    dirs.add(f.slice(0, i + 13) + name);
  }
}
const pkgs = new Map();
for (const d of dirs) {
  const pj = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8'));
  const key = `${pj.name}@${pj.version}`;
  if (!pkgs.has(key)) {
    const lf = fs.readdirSync(d).find((n) => /^(licen[sc]e|copying|notice)(\.|$)/i.test(n) && fs.statSync(path.join(d, n)).isFile());
    let lic = pj.license || (pj.licenses && pj.licenses.map((l) => l.type).join(' OR ')) || 'UNKNOWN';
    if (typeof lic === 'object') lic = lic.type;
    let repo = pj.repository && (pj.repository.url || pj.repository);
    repo = (repo || pj.homepage || '').toString().replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '');
    pkgs.set(key, { name: pj.name, version: pj.version, license: lic, url: repo, author: typeof pj.author === 'object' ? [pj.author.name, pj.author.email].filter(Boolean).join(' ') : pj.author || '', text: lf ? fs.readFileSync(path.join(d, lf), 'utf8').trim() : '' });
  }
}
const list = [...pkgs.values()].sort((a, b) => a.name.localeCompare(b.name));
const bundle = res.outputFiles[0].text;
const norm = (s) => s.replace(/\s+/g, ' ');
const nb = norm(bundle);
let present = 0;
for (const p of list) {
  const c = p.text.split('\n').find((l) => /copyright/i.test(l));
  p.inBundle = !!c && nb.includes(norm(c.trim()));
  if (p.inBundle) present++;
  const bad = /GPL|MPL|EPL|UNLICENSED|UNKNOWN|SEE LICENSE/i.test(p.license) || !p.text;
  console.log(`${p.inBundle ? 'IN ' : 'OUT'} ${bad ? 'FLAG ' : ''}${p.name}@${p.version} ${p.license} ${p.text ? '' : '(no license file)'}`);
}
console.log(`packages=${list.length} noticeInBundle=${present}`);
if (process.argv.includes('--check')) process.exit(0);

const groups = new Map();
for (const p of list) {
  const k = norm(p.text) || `NO LICENSE FILE:${p.name}`;
  if (!groups.has(k)) groups.set(k, { text: p.text, pkgs: [] });
  groups.get(k).pkgs.push(p);
}
let out = `THIRD-PARTY NOTICES\n\nThis package bundles the following npm packages into lib/index.js.\nTheir copyright and license notices are reproduced below.\n`;
for (const g of groups.values()) {
  out += `\n${'='.repeat(72)}\n`;
  for (const p of g.pkgs) out += `${p.name}@${p.version} (${p.license})${p.url ? ' - ' + p.url : ''}\n`;
  out += `${'-'.repeat(72)}\n${g.text || '(no license file shipped with the package; package.json declares license ' + g.pkgs[0].license + (g.pkgs[0].author ? ', author ' + g.pkgs[0].author : '') + ')'}\n`;
}
fs.writeFileSync('THIRD_PARTY_NOTICES.txt', out);
