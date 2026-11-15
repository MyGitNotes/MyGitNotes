import { randomBytes } from 'node:crypto';
import { createClient } from 'redis';

const TURN = 'mgn-test:turn';
/** A turn nobody gave back (a run that was killed) frees itself after this long. */
const TURN_MS = 120_000;

/**
 * One test file at a time on the throwaway Redis of `MYGITNOTES_TEST_REDIS_URL`. Two store tests change the server's
 * configuration for a moment (`maxmemory 1`, `maxmemory-policy allkeys-lru`), and test files run side by side: without
 * a turn, the Redis tests of another file fail whenever they overlap one of those. A file's Redis tests take the turn in
 * `beforeAll` and give it back in `afterAll`.
 */
export function redisTestTurn(url: string | undefined) {
  const mine = randomBytes(8).toString('hex');
  let raw: ReturnType<typeof createClient> | undefined;
  return {
    /** Resolves when this file has the turn. */
    async take(): Promise<void> {
      raw = createClient({ url, socket: { connectTimeout: 10_000, reconnectStrategy: false } });
      raw.on('error', () => {});
      await raw.connect();
      for (;;) {
        // Refused while the file that has the turn keeps the server full: that is a turn taken, too.
        const taken: unknown = await raw.sendCommand(['SET', TURN, mine, 'NX', 'PX', String(TURN_MS)]).catch(() => null);
        if (taken === 'OK') return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    },
    async give(): Promise<void> {
      if (!raw) return;
      const holder: unknown = await raw.sendCommand(['GET', TURN]);
      if (holder === mine) await raw.sendCommand(['DEL', TURN]);
      raw.destroy();
      raw = undefined;
    },
  };
}
