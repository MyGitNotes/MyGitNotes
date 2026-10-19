// Bundles the bridge, its WebSocket server and the two Pi extension files into dist/, so the package runs on plain Node
// with no dependencies. pi-session.ts finds the extensions beside the bundle through import.meta.url.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
const { version } = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));
fs.rmSync(dist, { recursive: true, force: true });
const { metafile } = await build({ metafile: true, entryPoints: [path.join(here, 'src/cli.ts')], outfile: path.join(dist, 'mygitnotes-pi-bridge.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22', define: { PACKAGE_VERSION: JSON.stringify(version) }, banner: { js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);" }, logLevel: 'warning' });
for (const file of ['pi-trust-extension.mjs', 'pi-web-tools-extension.mjs']) fs.copyFileSync(path.join(here, '../local-server/src', file), path.join(dist, file));
fs.chmodSync(path.join(dist, 'mygitnotes-pi-bridge.mjs'), 0o755);
// Third-party code in the bundle keeps its license text: a notice file listing each bundled package, built from what esbuild actually included.
const packageDirectories = new Set();
for (const input of Object.keys(metafile.inputs)) {
  const match = path.resolve(here, input).match(/^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/);
  if (match) packageDirectories.add(match[1]);
}
const notices = [...packageDirectories].sort().map(directory => {
  const { name, version, license } = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const file = fs.readdirSync(directory).find(entry => /^licen[sc]e(\.|$)/i.test(entry));
  if (!file) throw new Error(`${name} is bundled but ships no license file; add its notice by hand before publishing.`);
  return `${name} ${version} (${license})\n\n${fs.readFileSync(path.join(directory, file), 'utf8').trim()}`;
});
fs.writeFileSync(path.join(here, 'THIRD_PARTY_NOTICES.txt'), `This package bundles the third-party code below. Its own code is AGPL-3.0-only (see LICENSE).\n\n${notices.join(`\n\n${'='.repeat(72)}\n\n`)}\n`);
// npm packs a LICENSE at the package root; the repository keeps one copy.
fs.copyFileSync(path.join(here, '../../LICENSE'), path.join(here, 'LICENSE'));
console.log(`Built mygitnotes-pi-bridge ${version} in ${dist}`);
