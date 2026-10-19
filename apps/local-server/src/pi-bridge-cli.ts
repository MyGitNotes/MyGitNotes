// The `mygitnotes-pi-bridge` command: runs the Pi bridge on your own computer and prints the pairing code that connects
// a MyGitNotes deployment to it. The package in apps/pi-bridge bundles this file with the two extension files.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { type PiBridge, startPiBridge } from './pi-bridge.js';
import { startQuickTunnel } from './pi-bridge-tunnel.js';
import { encodePairingCode, MIN_PAIRING_SECRET_LENGTH } from './pi-pairing.js';
import { commandAvailable, piCommand } from './pi-session.js';

export const DEFAULT_ORIGIN = 'https://app.mygitnotes.com';
export const DEFAULT_PORT = 8787;
export const PI_INSTALL_COMMAND = 'npm install -g @earendil-works/pi-coding-agent';
const CLOUDFLARED_URL = 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/';
const MIN_NODE_MAJOR = 22;

/** A problem the person can fix; the command prints its message and exits with 1. */
export class CliError extends Error {}

export const USAGE = `Usage: mygitnotes-pi-bridge [options] [-- <extra Pi arguments>]

Runs Pi on this computer for a MyGitNotes page and prints a pairing code to paste into MyGitNotes.

Options:
  --tunnel              Start a Cloudflare quick tunnel (needs cloudflared) and use its address
  --public-url <url>    The https address people reach this bridge at, when you run your own HTTPS
  --origin <origin>     A page origin allowed to use the bridge; repeat for several (default ${DEFAULT_ORIGIN})
  --port <port>         The port to listen on (default ${DEFAULT_PORT})
  --host <address>      The address to listen on (default 127.0.0.1)
  --model <pattern>     The Pi model to use, passed to Pi as --model
  --rotate-secret       Make a new secret; the old pairing code stops working
  --version             Print the version
  --help                Print this help

Arguments after -- go to Pi unchanged, for example: mygitnotes-pi-bridge --tunnel -- --thinking high

Settings in the environment win over options: MYGITNOTES_BRIDGE_SECRET, MYGITNOTES_BRIDGE_PUBLIC_URL,
MYGITNOTES_BRIDGE_ORIGINS (a JSON array), MYGITNOTES_BRIDGE_PORT, MYGITNOTES_BRIDGE_HOST, MYGITNOTES_BRIDGE_CWD and
MYGITNOTES_BRIDGE_PI_ARGS (a JSON array).`;

export interface CliArguments {
  help: boolean;
  version: boolean;
  tunnel: boolean;
  rotateSecret: boolean;
  origins: string[];
  port?: string;
  host?: string;
  publicUrl?: string;
  model?: string;
  /** What follows `--`. */
  piArgs: string[];
}

export function parseCliArguments(argv: string[]): CliArguments {
  const split = argv.indexOf('--');
  const own = split === -1 ? argv : argv.slice(0, split);
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    ({ values } = parseArgs({ args: own, allowPositionals: false, options: { tunnel: { type: 'boolean' }, 'public-url': { type: 'string' }, origin: { type: 'string', multiple: true }, port: { type: 'string' }, host: { type: 'string' }, model: { type: 'string' }, 'rotate-secret': { type: 'boolean' }, version: { type: 'boolean' }, help: { type: 'boolean' } } }));
  } catch (error) {
    throw new CliError(`${(error as Error).message}\nRun mygitnotes-pi-bridge --help for the options.`);
  }
  return { help: values.help === true, version: values.version === true, tunnel: values.tunnel === true, rotateSecret: values['rotate-secret'] === true, origins: (values.origin as string[] | undefined) ?? [], port: values.port as string | undefined, host: values.host as string | undefined, publicUrl: values['public-url'] as string | undefined, model: values.model as string | undefined, piArgs: split === -1 ? [] : argv.slice(split + 1) };
}

/** Where the bridge keeps its secret and Pi's working directory: `$XDG_CONFIG_HOME/mygitnotes-pi-bridge`, else `~/.config/…` (`%APPDATA%` on Windows). */
export function configDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME?.trim() || (process.platform === 'win32' && env.APPDATA?.trim()) || path.join(os.homedir(), '.config');
  return path.join(base, 'mygitnotes-pi-bridge');
}

export type SecretSource = 'created' | 'rotated' | 'reused' | 'environment';

const newSecret = () => randomBytes(32).toString('base64url');

function writePrivately(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, file);
}

/** The secret kept in `file`: made on the first run, kept on later runs, replaced when `rotate`. A file that cannot be read is an error, never silently replaced. */
export function loadSecret(file: string, rotate: boolean): { secret: string; source: SecretSource; } {
  const exists = fs.existsSync(file);
  if (exists && !rotate) {
    let secret: unknown;
    try {
      secret = (JSON.parse(fs.readFileSync(file, 'utf8')) as { secret?: unknown; }).secret;
    } catch {
      throw new CliError(`${file} is not readable JSON. Fix it, or run with --rotate-secret to make a new one.`);
    }
    if (typeof secret !== 'string' || secret.length < MIN_PAIRING_SECRET_LENGTH) throw new CliError(`${file} holds no secret of at least ${MIN_PAIRING_SECRET_LENGTH} characters. Fix it, or run with --rotate-secret to make a new one.`);
    fs.chmodSync(file, 0o600);
    return { secret, source: 'reused' };
  }
  const secret = newSecret();
  writePrivately(file, `${JSON.stringify({ secret }, null, 2)}\n`);
  return { secret, source: exists ? 'rotated' : 'created' };
}

export interface BridgePlan {
  secret: string;
  secretSource: SecretSource;
  configFile: string;
  /** The directory Pi starts in. */
  cwd: string;
  origins: string[];
  port: number;
  host: string;
  /** The https address named by `--public-url` or the environment, when there is one. */
  publicUrl?: string;
  tunnel: boolean;
  piArgs: string[];
}

function jsonList(env: NodeJS.ProcessEnv, name: string): string[] | undefined {
  const value = env[name]?.trim();
  if (!value) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new CliError(`${name} must be a JSON array of strings.`);
  }
  if (!Array.isArray(parsed) || parsed.some(entry => typeof entry !== 'string')) throw new CliError(`${name} must be a JSON array of strings.`);
  return parsed as string[];
}

function httpsAddress(name: string, value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CliError(`${name} must be an https address such as https://pi.example.com.`);
  }
  if (parsed.protocol !== 'https:') throw new CliError(`${name} must be an https address such as https://pi.example.com; browsers refuse a plain http socket from an https page.`);
  return value.replace(/\/+$/, '');
}

function portNumber(name: string, value: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value.trim()) || port < 1 || port > 65535) throw new CliError(`${name} must be a port number from 1 to 65535.`);
  return port;
}

/**
 * Settles what the bridge runs with: options, then the environment over them, then defaults. Reads or writes the
 * secret file unless the environment brings its own secret, and makes Pi's working directory.
 */
export function planBridge(args: CliArguments, env: NodeJS.ProcessEnv = process.env): BridgePlan {
  const directory = configDirectory(env);
  const configFile = path.join(directory, 'config.json');
  const envSecret = env.MYGITNOTES_BRIDGE_SECRET?.trim();
  if (envSecret && args.rotateSecret) throw new CliError('--rotate-secret has no effect while MYGITNOTES_BRIDGE_SECRET is set. Change that variable instead.');
  if (envSecret && envSecret.length < MIN_PAIRING_SECRET_LENGTH) throw new CliError(`MYGITNOTES_BRIDGE_SECRET must be at least ${MIN_PAIRING_SECRET_LENGTH} characters.`);
  const rawPublicUrl = env.MYGITNOTES_BRIDGE_PUBLIC_URL?.trim() || args.publicUrl;
  const publicUrl = rawPublicUrl ? httpsAddress(env.MYGITNOTES_BRIDGE_PUBLIC_URL?.trim() ? 'MYGITNOTES_BRIDGE_PUBLIC_URL' : '--public-url', rawPublicUrl) : undefined;
  if (publicUrl && args.tunnel) throw new CliError('Use --tunnel or a public address (--public-url, MYGITNOTES_BRIDGE_PUBLIC_URL), not both.');
  const origins = jsonList(env, 'MYGITNOTES_BRIDGE_ORIGINS') ?? (args.origins.length ? args.origins : [DEFAULT_ORIGIN]);
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new CliError(`${origin} is not a page origin such as ${DEFAULT_ORIGIN}.`);
    }
    if (parsed.origin !== origin) throw new CliError(`${origin} is not an origin: write it without a path or trailing slash, such as ${parsed.origin}.`);
  }
  const port = env.MYGITNOTES_BRIDGE_PORT?.trim() ? portNumber('MYGITNOTES_BRIDGE_PORT', env.MYGITNOTES_BRIDGE_PORT) : args.port ? portNumber('--port', args.port) : DEFAULT_PORT;
  const piArgs = jsonList(env, 'MYGITNOTES_BRIDGE_PI_ARGS') ?? [...args.model ? ['--model', args.model] : [], ...args.piArgs];
  const cwd = env.MYGITNOTES_BRIDGE_CWD?.trim() || path.join(directory, 'workspace');
  const { secret, source } = envSecret ? { secret: envSecret, source: 'environment' as const } : loadSecret(configFile, args.rotateSecret);
  fs.mkdirSync(cwd, { recursive: true });
  return { secret, secretSource: source, configFile, cwd, origins, port, host: env.MYGITNOTES_BRIDGE_HOST?.trim() || args.host || '127.0.0.1', publicUrl, tunnel: args.tunnel, piArgs };
}

export interface CliIo {
  log: (line: string) => void;
}

export interface RunningCli {
  bridge: PiBridge;
  /** The address the pairing code names, or undefined while the bridge has only its local address. */
  publicUrl: string | undefined;
  pairingCode: string | undefined;
  stop: () => Promise<void>;
}

declare const PACKAGE_VERSION: string | undefined;
export const packageVersion = () => typeof PACKAGE_VERSION === 'string' ? PACKAGE_VERSION : 'development';

const SECRET_NOTES: Record<SecretSource, (file: string) => string> = { created: file => `Made a new secret and kept it in ${file}.`, rotated: file => `Made a new secret in ${file}. The old pairing code no longer works; paste the new one wherever you used it.`, reused: file => `Using the secret kept in ${file}.`, environment: () => 'Using the secret from MYGITNOTES_BRIDGE_SECRET.' };

/**
 * Starts the bridge and prints how to pair it. Resolves once it listens; `stop` ends Pi, the bridge and any tunnel.
 * Throws a CliError for anything the person must fix first.
 */
export async function runBridge(args: CliArguments, env: NodeJS.ProcessEnv, io: CliIo): Promise<RunningCli> {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE_MAJOR) throw new CliError(`mygitnotes-pi-bridge needs Node ${MIN_NODE_MAJOR} or newer; this is Node ${process.versions.node}.`);
  const command = piCommand(env);
  if (!commandAvailable(command, env)) throw new CliError(`Pi was not found (looked for "${command}").\nInstall it with:\n  ${PI_INSTALL_COMMAND}\nThen run pi once to sign in to a model provider, and start this command again.`);
  if (args.tunnel && !commandAvailable('cloudflared', env)) throw new CliError(`--tunnel needs cloudflared, which was not found.\nInstall it from ${CLOUDFLARED_URL}, or give your own https address with --public-url.`);
  const plan = planBridge(args, env);
  io.log(`MyGitNotes Pi bridge ${packageVersion()}`);
  io.log(SECRET_NOTES[plan.secretSource](plan.configFile));

  let tunnelStop: (() => void) | undefined;
  let publicUrl = plan.publicUrl;
  let closing = false;
  let closeAll: () => Promise<void> = async () => {};
  if (plan.tunnel) {
    io.log('Starting a Cloudflare quick tunnel…');
    try {
      const tunnel = await startQuickTunnel({
        port: plan.port,
        onExit: code => {
          if (closing) return;
          io.log(`cloudflared stopped (exit ${code ?? 'by signal'}), so the pairing code no longer reaches this computer. Stopping.`);
          void closeAll().then(() => process.exit(1));
        },
      });
      tunnelStop = tunnel.stop;
      publicUrl = tunnel.url;
    } catch (error) {
      throw new CliError((error as Error).message);
    }
  }

  let bridge: PiBridge;
  try {
    bridge = await startPiBridge({ port: plan.port, host: plan.host, secret: plan.secret, publicUrl: publicUrl ?? `http://127.0.0.1:${plan.port}`, allowedOrigins: plan.origins, cwd: plan.cwd, piArgs: plan.piArgs, command });
  } catch (error) {
    tunnelStop?.();
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') throw new CliError(`Port ${plan.port} is already in use. Pick another with --port.`);
    throw error;
  }
  const stop = async () => {
    closing = true;
    tunnelStop?.();
    await bridge.close();
  };
  closeAll = stop;

  io.log(`Listening on ${plan.host}:${plan.port}. Pi starts when MyGitNotes asks for a session, in ${plan.cwd}.`);
  io.log(`Pages allowed to use it: ${plan.origins.join(', ')}`);
  const pairingCode = publicUrl ? encodePairingCode({ url: publicUrl, secret: plan.secret }) : undefined;
  if (pairingCode) {
    io.log('');
    io.log('Paste this pairing code into MyGitNotes Pro (Settings), or set it as MYGITNOTES_EXTERNAL_PI_PAIRING on a self-hosted deployment:');
    io.log('');
    io.log(pairingCode);
    io.log('');
    io.log('The code holds your secret. Share it with no one, and leave this window open while you use the agent.');
    if (plan.tunnel) io.log('This quick tunnel address changes every time the bridge restarts, and then you must paste the new pairing code again. For a stable address use a named Cloudflare tunnel or your own HTTPS with --public-url.');
  } else {
    io.log('');
    io.log('There is no public address yet, so there is no pairing code. Restart with --tunnel (a Cloudflare quick tunnel) or --public-url <https address> to get one.');
  }
  return { bridge, publicUrl, pairingCode, stop };
}

/** The command's entry: runs the bridge until Ctrl+C or SIGTERM. Returns the exit code when it does not keep running. */
export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env, io: CliIo = { log: line => console.log(line) }): Promise<number | undefined> {
  try {
    const args = parseCliArguments(argv);
    if (args.help) return io.log(USAGE), 0;
    if (args.version) return io.log(packageVersion()), 0;
    const running = await runBridge(args, env, io);
    const shutdown = () => void running.stop().then(() => process.exit(0));
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return undefined;
  } catch (error) {
    if (error instanceof CliError) {
      console.error(`mygitnotes-pi-bridge: ${error.message}`);
      return 1;
    }
    throw error;
  }
}
