import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redisTestStores } from './test-fixture.js';

/*
 * The Redis live store in a process of its own, as an edition composes it: a command in flight keeps the process alive
 * until Redis answers, and an idle connection does not keep a finished process open. Over a real Redis only, when
 * MYGITNOTES_TEST_REDIS_URL names a throwaway one.
 */

const url = process.env.MYGITNOTES_TEST_REDIS_URL;
const product = fileURLToPath(new URL('../../../../', import.meta.url));
const index = pathToFileURL(path.join(product, 'apps/local-server/src/live-builtin/index.ts')).href;

describe.skipIf(!url)('over a real Redis (MYGITNOTES_TEST_REDIS_URL)', () => {
  const redis = redisTestStores(url);
  let dir: string, scripts = 0;
  beforeAll(async () => {
    await redis.begin();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mgn-live-process-'));
  });
  afterAll(async () => {
    fs.rmSync(dir, { recursive: true, force: true });
    expect(await redis.end()).toBe(0);
  });

  /**
   * Runs `body` as an ES module of its own, with top-level await, `builtinLiveNotes`, and `store`: a Redis live store
   * under a prefix of this run. Answers how the process ended and what it printed.
   */
  async function script(body: string) {
    const file = path.join(dir, `${++scripts}.mjs`);
    const head = `import { builtinLiveNotes, redisLiveStore } from ${JSON.stringify(index)};\nconst store = redisLiveStore({ url: ${JSON.stringify(url)}, prefix: ${JSON.stringify(redis.prefix())} });\n`;
    fs.writeFileSync(file, head + body);
    const child = spawn(process.execPath, ['--import', 'tsx', file], { cwd: product, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => stdout += chunk);
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => stderr += chunk);
    const [code, signal] = await once(child, 'close') as [number | null, NodeJS.Signals | null];
    return { ended: { code, signal, stdout }, stderr };
  }
  const composition = `const live = builtinLiveNotes({ covers: () => false, open: async () => { throw new Error('No repository.'); }, store });\n`;

  it('lets a composition await `started` before it listens, and ends the process once nothing is left to do', async () => {
    const { ended, stderr } = await script(`${composition}await live.started;\nconsole.log('started');\n`);
    expect(ended, stderr).toEqual({ code: 0, signal: null, stdout: 'started\n' });
  });

  it('keeps the process alive for a command in flight on a connection that was idle', async () => {
    // A timer holds the process while the store connects and checks; then only the command in flight is left.
    const { ended, stderr } = await script(`const hold = setInterval(() => {}, 1000);\nawait store.check();\nclearInterval(hold);\nconsole.log(JSON.stringify(await store.repositories()));\n`);
    expect(ended, stderr).toEqual({ code: 0, signal: null, stdout: '[]\n' });
  });

  it('hands a composition that awaits `started` the refusal of a server that may evict any key', async () => {
    const raw = createClient({ url, socket: { connectTimeout: 10_000, reconnectStrategy: false } });
    raw.on('error', () => {});
    await raw.connect();
    const [, was] = await raw.sendCommand(['CONFIG', 'GET', 'maxmemory-policy']) as string[];
    try {
      await raw.sendCommand(['CONFIG', 'SET', 'maxmemory-policy', 'allkeys-lru']);
      const { ended, stderr } = await script(`${composition}try {\n  await live.started;\n  console.log('started');\n} catch (error) {\n  console.log(error.message);\n}\n`);
      expect(ended, stderr).toEqual({ code: 0, signal: null, stdout: 'Redis may evict any key (maxmemory-policy allkeys-lru); the built-in live editor would lose typing. Use noeviction or a volatile-* policy.\n' });
    } finally {
      await raw.sendCommand(['CONFIG', 'SET', 'maxmemory-policy', was]);
      raw.destroy();
    }
  });
});
