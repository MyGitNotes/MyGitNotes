import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';

const pkg = path.resolve(import.meta.dirname, '..');
// Inside the package, so the bundle resolves the dependencies it leaves out from the workspace's node_modules.
const out = fs.mkdtempSync(path.join(pkg, 'node_modules', '.entry-test-'));
afterAll(() => fs.rmSync(out, { recursive: true, force: true }));

/** Bundles one source file into a single ESM file, as an edition's build does, and runs it with `args`. */
async function bundled(entry: string, args: string[] = []) {
  const outfile = path.join(out, `${path.basename(entry, '.ts')}.mjs`);
  await build({ entryPoints: [path.join(pkg, 'src', entry)], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile, logLevel: 'silent' });
  const child = spawn(process.execPath, [outfile, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => stderr += chunk);
  return { child, stderr: () => stderr };
}

describe('the stdio entry', () => {
  it('is not started by bundling or importing the package entry', async () => {
    const { child, stderr } = await bundled('index.ts');
    const code = await new Promise<number | null>(resolve => {
      const timer = setTimeout(() => (child.kill(), resolve(null)), 5000);
      child.on('exit', status => (clearTimeout(timer), resolve(status)));
    });
    expect(stderr()).not.toContain('Stdio server running');
    expect(code).toBe(0);
  });

  it('starts from its own file, bundled too, for the repository it is given', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mgn-entry-'));
    try {
      const { child, stderr } = await bundled('main.ts', [root]);
      const started = await new Promise<boolean>(resolve => {
        const timer = setTimeout(() => resolve(false), 10000);
        child.stderr.on('data', () => stderr().includes('Stdio server running') && (clearTimeout(timer), resolve(true)));
      });
      child.kill();
      expect(started).toBe(true);
      expect(stderr()).toContain(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
