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
await build({ entryPoints: [path.join(here, 'src/cli.ts')], outfile: path.join(dist, 'mygitnotes-pi-bridge.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22', define: { PACKAGE_VERSION: JSON.stringify(version) }, banner: { js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);" }, logLevel: 'warning' });
for (const file of ['pi-trust-extension.mjs', 'pi-web-tools-extension.mjs']) fs.copyFileSync(path.join(here, '../local-server/src', file), path.join(dist, file));
fs.chmodSync(path.join(dist, 'mygitnotes-pi-bridge.mjs'), 0o755);
// npm packs a LICENSE at the package root; the repository keeps one copy.
fs.copyFileSync(path.join(here, '../../LICENSE'), path.join(here, 'LICENSE'));
console.log(`Built mygitnotes-pi-bridge ${version} in ${dist}`);
