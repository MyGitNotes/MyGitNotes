import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { WorkspaceConfigSource } from '@mygitnotes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { encodePairingCode } from '../src/edition.js';
import { externalPiEnvironment } from '../src/pi-external-agent.js';
import { workspaceSettings } from './workspace-settings.js';

const secret = 'p'.repeat(43);
const pairing = encodePairingCode({ url: 'https://pi.example.com/', secret });
const owners = { MYGITNOTES_EXTERNAL_PI_OWNERS: 'octo, id:3' };

describe('MYGITNOTES_EXTERNAL_PI_PAIRING', () => {
  it('takes the address and secret from the pairing code', () => {
    expect(externalPiEnvironment({ MYGITNOTES_EXTERNAL_PI_PAIRING: ` ${pairing} `, ...owners })).toEqual({ bridgeUrl: 'https://pi.example.com', secret, owners: ['octo', 'id:3'] });
  });

  it('still takes the address and secret as two variables', () => {
    expect(externalPiEnvironment({ MYGITNOTES_EXTERNAL_PI_URL: 'https://pi.example.com', MYGITNOTES_EXTERNAL_PI_SECRET: secret, ...owners })).toMatchObject({ bridgeUrl: 'https://pi.example.com', secret });
  });

  it('refuses a pairing code together with either of the two variables', () => {
    for (const extra of [{ MYGITNOTES_EXTERNAL_PI_URL: 'https://pi.example.com' }, { MYGITNOTES_EXTERNAL_PI_SECRET: secret }]) {
      expect(() => externalPiEnvironment({ MYGITNOTES_EXTERNAL_PI_PAIRING: pairing, ...extra, ...owners })).toThrow('not both');
    }
  });

  it('refuses a pairing code that is not valid, and one without owners', () => {
    expect(() => externalPiEnvironment({ MYGITNOTES_EXTERNAL_PI_PAIRING: 'mgnpi1.nope', ...owners })).toThrow('readable');
    expect(() => externalPiEnvironment({ MYGITNOTES_EXTERNAL_PI_PAIRING: pairing })).toThrow('OWNERS');
  });

  it('stays off when no variable is set, a blank pairing included', () => {
    expect(externalPiEnvironment({ MYGITNOTES_EXTERNAL_PI_PAIRING: '  ' })).toBeUndefined();
  });
});

describe('createApp with a pairing code', () => {
  let server: Server | undefined;
  let dir: string;
  const remote: WorkspaceConfigSource = { mode: 'remote', settings: async () => workspaceSettings([{ type: 'github', repository: 'o/r', branch: 'main' }]) };
  const stub = (env: Record<string, string>) => Object.entries(env).forEach(([key, value]) => vi.stubEnv(key, value));
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'external-pairing-'));
    vi.stubEnv('APP_URL', '');
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('SESSION_SECRET', 'external-pairing'.repeat(3));
  });
  afterEach(async () => {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    server = undefined;
    fs.rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('mounts the external agent from the pairing code alone', async () => {
    stub({ MYGITNOTES_EXTERNAL_PI_PAIRING: pairing, ...owners });
    server = createServer(createApp(dir, { configSource: remote, remoteCache: undefined }));
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    // Mounted: a request from nobody is answered by the agent's own 404 for people who are not owners.
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number; }).port}/api/pi/session`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'This deployment offers no agent to you.' });
  });

  it('refuses to start when both forms are given', () => {
    stub({ MYGITNOTES_EXTERNAL_PI_PAIRING: pairing, MYGITNOTES_EXTERNAL_PI_URL: 'https://pi.example.com', MYGITNOTES_EXTERNAL_PI_SECRET: secret, ...owners });
    expect(() => createApp(dir, { configSource: remote, remoteCache: undefined })).toThrow('not both');
  });
});
