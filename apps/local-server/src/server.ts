import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { assertWorkspaceCompatible, defaultMember, loadEnvDefaults } from '@mygitnotes/core';
import { applicationRoot, createApp } from './app.js';
import { writeDevPorts } from './dev-ports.js';
import type { BuiltinLiveNotes } from './live-builtin/index.js';
import { environmentLive } from './live-env.js';
import { createPiAgent } from './pi-agent.js';
import { prewarmLocalScans } from './request-workspace.js';
import { chosenRepositorySource } from './workspace-choice.js';

/*
 * The community edition's server, as `index.ts` (what `pnpm start`, `pnpm dev` and the Docker image run) starts it:
 * the app over the deployment's environment, listening, with the upgrades of whatever takes sockets handed on.
 */

const MAX_PORT_ATTEMPTS = 20;

export interface StartOptions {
  /** The command line; `--local` serves the local workspace. `process.argv` by default. */
  argv?: readonly string[];
  /** Where the start-up lines go; the console by default. */
  log?: (line: string) => void;
  /** Tests only: the clock of the built-in live editor. */
  clock?: () => number;
}

export interface RunningServer {
  server: Server;
  host: string;
  port: number;
  /** The built-in live editor, where `MYGITNOTES_LIVE_EDITOR=builtin` turned it on. */
  live?: BuiltinLiveNotes;
  /** Stops it as a SIGTERM does: the live editor compacts its documents and closes its sockets, then the server closes. */
  close(): Promise<void>;
}

/** Starts the server of this deployment's environment and resolves once it listens. */
export async function startServer({ argv = process.argv, log = console.log, clock }: StartOptions = {}): Promise<RunningServer> {
  loadEnvDefaults(`${applicationRoot()}/.env`);
  const desiredPort = Number(process.env.PORT || 4321);
  const host = process.env.HOST || '127.0.0.1';
  const repoRoot = applicationRoot();
  const isLocal = argv.includes('--local');
  if (isLocal) {
    process.env.MYGITNOTES_SOURCE = 'local';
    const localPath = process.env.REPO_ROOT || process.env.MYGITNOTES_LOCAL_PATH || process.env.GITHUB_NOTES_LOCAL_PATH;
    if (localPath) process.env.MYGITNOTES_LOCAL_PATH = localPath;
  }
  const configSource = chosenRepositorySource(repoRoot);
  if (isLocal) {
    // Fail fast: a missing workspace or a schema this Core cannot serve stops the dev server.
    const settings = await configSource.settings({ headers: {} });
    const worktree = defaultMember(settings)?.localPath;
    if (worktree) assertWorkspaceCompatible(worktree);
  }
  // The built-in live editor, where the environment turns it on; a deployment that cannot run it stops here.
  const environment = await environmentLive(repoRoot, configSource, clock ? { clock } : {});
  const live = environment?.live;
  // The agent panel bridges to a Pi process on this machine, so only a local workspace offers it.
  const piAgent = configSource.mode === 'local' ? createPiAgent() : undefined;
  const app = createApp(repoRoot, { configSource, piAgent, ...environment?.services });
  // The live store's start-up check passed before anything listens: an eviction policy that could drop typing stops the server.
  await live?.started;

  function listen(port: number, attemptsLeft: number): Promise<Server> {
    return new Promise((resolve, reject) => {
      const server = app.listen(port, host);
      if (live || piAgent) {
        // Each handler is asked in turn; a socket nobody takes is dropped.
        server.on('upgrade', (req, socket, head) => {
          if (live?.upgrade(req, socket, head)) return;
          if (!piAgent?.upgrade(req, socket, head)) socket.destroy();
        });
      }
      server.once('listening', () => resolve(server));
      server.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE' && attemptsLeft > 0) resolve(listen(port + 1, attemptsLeft - 1));
        else reject(error);
      });
    });
  }

  const server = await listen(desiredPort, MAX_PORT_ATTEMPTS);
  const { port } = server.address() as AddressInfo;
  if (isLocal) {
    process.env.APP_URL = `http://localhost:${port}`;
    // One write, so a reader never pairs this port with a previous run's pid.
    writeDevPorts(repoRoot, { serverPort: port, serverPid: process.pid });
  }
  log(`[local-server] http://${host}:${port}`);
  const warmStart = performance.now();
  prewarmLocalScans(configSource).then(
    () => log(`[local-server] notes parsed in ${Math.round(performance.now() - warmStart)} ms`),
    // Requests still scan on demand; only the head start is lost.
    (error: unknown) => console.warn(`[local-server] background note scan failed: ${error instanceof Error ? error.message : String(error)}`),
  );

  let closing: Promise<void> | undefined;
  const onTerminate = () => void close().catch(error => console.warn(`[local-server] shutdown failed: ${(error as Error)?.name ?? 'error'}`));
  /** The live editor first, so every acknowledged update is compacted and its tabs reconnect elsewhere; then the server. */
  const close = () =>
    closing ??= (async () => {
      process.off('SIGTERM', onTerminate);
      try {
        await live?.shutdown();
      } finally {
        const closed = new Promise<void>(resolve => server.close(() => resolve()));
        // Idle keep-alive connections and open event streams would hold the server, and the process, open.
        server.closeAllConnections();
        await closed;
      }
    })();
  // Only a server with a live editor has anything to finish before it goes; any other stops as it always did.
  if (live) process.once('SIGTERM', onTerminate);
  return { server, host, port, ...(live ? { live } : {}), close };
}
