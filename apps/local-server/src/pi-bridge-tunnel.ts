import { type ChildProcess, spawn } from 'node:child_process';

export interface QuickTunnel {
  /** The `https://….trycloudflare.com` address the tunnel serves the local port at. */
  url: string;
  /** Ends the tunnel's process. */
  stop: () => void;
}

export interface QuickTunnelOptions {
  command?: string;
  port: number;
  /** How long to wait for cloudflared to name its address, in milliseconds. */
  timeoutMs?: number;
  /** Called when cloudflared ends on its own after it named its address, so the caller can stop serving. */
  onExit?: (code: number | null) => void;
  spawnImpl?: (command: string, args: string[]) => ChildProcess;
}

// A quick tunnel's name is several words joined by hyphens. Requiring a hyphen keeps cloudflared's error lines, which
// name its own https://api.trycloudflare.com, from being taken for the tunnel.
const ADDRESS = /https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com(?![a-z0-9-])/;
const OUTPUT_LIMIT = 4000;

/**
 * Starts `cloudflared tunnel --url http://127.0.0.1:<port>` and resolves with the quick tunnel address it prints on
 * stderr. A quick tunnel needs no Cloudflare account, but its address is new on every start.
 */
export function startQuickTunnel(options: QuickTunnelOptions): Promise<QuickTunnel> {
  const { command = 'cloudflared', port, timeoutMs = 30_000 } = options;
  const child = (options.spawnImpl ?? ((cmd, args) => spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })))(command, ['tunnel', '--url', `http://127.0.0.1:${port}`]);
  const stop = () => void child.kill('SIGTERM');
  return new Promise((resolve, reject) => {
    let output = '', named = false;
    const fail = (message: string) => {
      clearTimeout(timer);
      stop();
      reject(new Error(`${message}${output.trim() ? `\n${output.trim().slice(-OUTPUT_LIMIT)}` : ''}`));
    };
    const timer = setTimeout(() => fail(`cloudflared did not name a trycloudflare.com address within ${Math.round(timeoutMs / 1000)} seconds.`), timeoutMs);
    const read = (chunk: Buffer) => {
      if (named) return;
      output = (output + chunk.toString('utf8')).slice(-OUTPUT_LIMIT);
      const url = output.match(ADDRESS)?.[0];
      if (!url) return;
      named = true;
      clearTimeout(timer);
      resolve({ url, stop });
    };
    child.stdout?.on('data', read);
    child.stderr?.on('data', read);
    child.once('error', error => fail(`cloudflared could not start: ${error.message}`));
    child.once('exit', code => {
      if (named) options.onExit?.(code);
      else fail(`cloudflared stopped (exit ${code ?? 'by signal'}) before it named an address.`);
    });
  });
}
