import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError, configDirectory, DEFAULT_ORIGIN, DEFAULT_PORT, ensureSupportedPlatform, loadSecret, main, NOTE_TOOLS, parseCliArguments, PI_INSTALL_COMMAND, planBridge, runBridge, type RunningCli } from '../src/pi-bridge-cli.js';
import { startQuickTunnel } from '../src/pi-bridge-tunnel.js';
import { decodePairingCode } from '../src/pi-pairing.js';
import { signBridgeToken } from '../src/pi-bridge-token.js';

let root: string;
const running: RunningCli[] = [];
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-bridge-cli-'));
});
afterEach(async () => {
  for (const instance of running.splice(0)) await instance.stop();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

const plan = (argv: string[] = [], env: NodeJS.ProcessEnv = {}) => planBridge(parseCliArguments(argv), { XDG_CONFIG_HOME: root, ...env });
const mode = (file: string) => fs.statSync(file).mode & 0o777;

/** An executable that stands in for pi or cloudflared. */
function fakeCommand(name: string, body: string): string {
  const dir = path.join(root, 'bin');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return dir;
}
const freePort = () =>
  new Promise<number>(resolve => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
const lines = () => {
  const out: string[] = [];
  return { out, io: { log: (line: string) => void out.push(line) } };
};

describe('arguments', () => {
  it('reads every option, repeated origins and the arguments after --', () => {
    expect(parseCliArguments(['--tunnel', '--origin', 'https://a.example', '--origin', 'https://b.example', '--port', '9000', '--host', '0.0.0.0', '--model', 'sonnet', '--rotate-secret', '--', '--thinking', 'high'])).toEqual({ help: false, version: false, tunnel: true, rotateSecret: true, allowLocalTools: false, origins: ['https://a.example', 'https://b.example'], port: '9000', host: '0.0.0.0', publicUrl: undefined, model: 'sonnet', piArgs: ['--thinking', 'high'] });
    expect(parseCliArguments(['--allow-local-tools']).allowLocalTools).toBe(true);
    expect(parseCliArguments(['--public-url', 'https://pi.example.com']).publicUrl).toBe('https://pi.example.com');
    expect(parseCliArguments([])).toMatchObject({ tunnel: false, rotateSecret: false, origins: [], piArgs: [] });
  });

  it('refuses an unknown option and a stray word with a hint', () => {
    expect(() => parseCliArguments(['--nope'])).toThrow(CliError);
    expect(() => parseCliArguments(['hello'])).toThrow('--help');
  });
});

describe('the secret file', () => {
  it('is made on the first run with mode 0600, and kept on the second', () => {
    const first = plan();
    const file = path.join(root, 'mygitnotes-pi-bridge', 'config.json');
    expect(first).toMatchObject({ secretSource: 'created', configFile: file });
    expect(first.secret.length).toBeGreaterThanOrEqual(32);
    expect(mode(file)).toBe(0o600);
    expect(mode(path.dirname(file))).toBe(0o700);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ secret: first.secret });
    const second = plan();
    expect(second).toMatchObject({ secretSource: 'reused', secret: first.secret });
  });

  it('makes a different secret every time it is made', () => {
    expect(plan().secret).not.toBe(plan(['--rotate-secret']).secret);
  });

  it('is replaced by --rotate-secret and stays private', () => {
    const first = plan();
    const rotated = plan(['--rotate-secret']);
    expect(rotated.secretSource).toBe('rotated');
    expect(rotated.secret).not.toBe(first.secret);
    expect(plan().secret).toBe(rotated.secret);
    expect(mode(rotated.configFile)).toBe(0o600);
  });

  it('tightens a file that was left readable by others', () => {
    const { configFile } = plan();
    fs.chmodSync(configFile, 0o644);
    plan();
    expect(mode(configFile)).toBe(0o600);
  });

  it('tightens a config directory that was left open to others', () => {
    const { configFile } = plan();
    fs.chmodSync(path.dirname(configFile), 0o755);
    plan();
    expect(mode(path.dirname(configFile))).toBe(0o700);
    fs.chmodSync(path.dirname(configFile), 0o755);
    plan(['--rotate-secret']);
    expect(mode(path.dirname(configFile))).toBe(0o700);
  });

  it('is never silently replaced when it cannot be read', () => {
    const file = path.join(root, 'config.json');
    fs.writeFileSync(file, 'not json');
    expect(() => loadSecret(file, false)).toThrow('--rotate-secret');
    fs.writeFileSync(file, JSON.stringify({ secret: 'short' }));
    expect(() => loadSecret(file, false)).toThrow('32 characters');
    expect(fs.readFileSync(file, 'utf8')).toContain('short');
  });

  it('lives under XDG_CONFIG_HOME, else the home directory', () => {
    expect(configDirectory({ XDG_CONFIG_HOME: '/x' })).toBe('/x/mygitnotes-pi-bridge');
    expect(configDirectory({})).toBe(path.join(os.homedir(), '.config', 'mygitnotes-pi-bridge'));
  });
});

describe('what the bridge runs with', () => {
  it('defaults to the hosted page origin, port 8787, localhost and an empty working directory', () => {
    const settings = plan();
    expect(settings).toMatchObject({ origins: [DEFAULT_ORIGIN], port: DEFAULT_PORT, host: '127.0.0.1', tunnel: false, piArgs: [], publicUrl: undefined, fixedPiArgs: ['--tools', NOTE_TOOLS] });
    expect(DEFAULT_ORIGIN).toBe('https://app.mygitnotes.com');
    expect(settings.cwd).toBe(path.join(root, 'mygitnotes-pi-bridge', 'workspace'));
    expect(fs.readdirSync(settings.cwd)).toEqual([]);
  });

  it('takes options, with the model and the arguments after -- passed on to Pi', () => {
    const settings = plan(['--origin', 'https://notes.example.com', '--origin', 'https://other.example', '--port', '9100', '--public-url', 'https://pi.example.com/', '--model', 'sonnet', '--', '--thinking', 'high']);
    expect(settings).toMatchObject({ origins: ['https://notes.example.com', 'https://other.example'], port: 9100, publicUrl: 'https://pi.example.com', piArgs: ['--model', 'sonnet', '--thinking', 'high'] });
  });

  it('lets the environment override every option', () => {
    const cwd = path.join(root, 'elsewhere');
    const settings = plan(['--origin', 'https://flag.example', '--port', '9100', '--public-url', 'https://flag.example.com', '--model', 'sonnet', '--host', '127.0.0.2'], { MYGITNOTES_BRIDGE_SECRET: 'e'.repeat(40), MYGITNOTES_BRIDGE_ORIGINS: '["https://env.example"]', MYGITNOTES_BRIDGE_PORT: '9200', MYGITNOTES_BRIDGE_HOST: '0.0.0.0', MYGITNOTES_BRIDGE_PUBLIC_URL: 'https://env.example.com', MYGITNOTES_BRIDGE_CWD: cwd, MYGITNOTES_BRIDGE_PI_ARGS: '["--thinking","low"]' });
    expect(settings).toMatchObject({ secret: 'e'.repeat(40), secretSource: 'environment', origins: ['https://env.example'], port: 9200, host: '0.0.0.0', publicUrl: 'https://env.example.com', cwd, piArgs: ['--thinking', 'low'] });
    expect(fs.existsSync(cwd)).toBe(true);
  });

  it('starts Pi with only the note tools, the mcp gateway and MCP tools, unless asked for local tools', () => {
    expect(NOTE_TOOLS.split(',')).toEqual(['mygitnotes_*', 'mcp', 'mcp__*']);
    expect(plan().fixedPiArgs).toEqual(['--tools', NOTE_TOOLS]);
    expect(plan(['--allow-local-tools']).fixedPiArgs).toEqual([]);
  });

  it.each([['--tools', 'read,bash'], ['-t', 'read'], ['--tools=read'], ['--no-tools'], ['-nt'], ['--no-builtin-tools'], ['-nbt']])('refuses the Pi option %s while the note tools are fixed, from -- and from the environment', (...piArgs) => {
    expect(() => plan(['--', ...piArgs])).toThrow('--allow-local-tools');
    expect(() => plan([], { MYGITNOTES_BRIDGE_PI_ARGS: JSON.stringify(piArgs) })).toThrow('--allow-local-tools');
    expect(plan(['--allow-local-tools', '--', ...piArgs]).piArgs).toEqual(piArgs);
  });

  it('keeps an environment secret out of the config file', () => {
    plan([], { MYGITNOTES_BRIDGE_SECRET: 'e'.repeat(40) });
    expect(fs.existsSync(path.join(root, 'mygitnotes-pi-bridge', 'config.json'))).toBe(false);
  });

  it.each([['rotating an environment secret', ['--rotate-secret'], { MYGITNOTES_BRIDGE_SECRET: 'e'.repeat(40) }, 'MYGITNOTES_BRIDGE_SECRET'], ['a short environment secret', [], { MYGITNOTES_BRIDGE_SECRET: 'short' }, '32 characters'], ['a tunnel with a public address', ['--tunnel', '--public-url', 'https://pi.example.com'], {}, 'not both'], ['a tunnel with a public address from the environment', ['--tunnel'], { MYGITNOTES_BRIDGE_PUBLIC_URL: 'https://pi.example.com' }, 'not both'], ['a plain http public address', ['--public-url', 'http://pi.example.com'], {}, 'https'], ['a public address with credentials', ['--public-url', 'https://user:pass@pi.example.com'], {}, '--public-url'], ['a public address with a query', ['--public-url', 'https://pi.example.com/?a=1'], {}, 'query'], ['a public address with a fragment', ['--public-url', 'https://pi.example.com/#top'], {}, 'fragment'], ['a public address with credentials from the environment', [], { MYGITNOTES_BRIDGE_PUBLIC_URL: 'https://user@pi.example.com' }, 'MYGITNOTES_BRIDGE_PUBLIC_URL'], ['a public address that is not a URL', ['--public-url', 'pi.example.com'], {}, 'https'], ['an origin with a path', ['--origin', 'https://notes.example.com/app'], {}, 'not an origin'], ['an origin that is not a URL', ['--origin', 'notes'], {}, 'page origin'], ['a port out of range', ['--port', '70000'], {}, 'port number'], ['a port that is not a number', ['--port', 'abc'], {}, 'port number'], ['origins that are not a JSON array', [], { MYGITNOTES_BRIDGE_ORIGINS: 'https://a.example' }, 'JSON array'], ['Pi arguments that are not strings', [], { MYGITNOTES_BRIDGE_PI_ARGS: '[1]' }, 'JSON array']])('refuses %s', (_name, argv, env, message) => {
    expect(() => plan(argv, env)).toThrow(message);
  });
});

describe('quick tunnel', () => {
  const fakeChild = () => Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });

  it('reads the trycloudflare address from cloudflared output and passes the port', async () => {
    const child = fakeChild();
    const spawnImpl = vi.fn(() => child as never);
    const pending = startQuickTunnel({ port: 8787, spawnImpl });
    child.stderr.write('INF Requesting new quick Tunnel on trycloudflare.com...\nINF |  https://calm-river-1234.trycloudflare.com  |\n');
    const tunnel = await pending;
    expect(tunnel.url).toBe('https://calm-river-1234.trycloudflare.com');
    expect(spawnImpl).toHaveBeenCalledWith('cloudflared', ['tunnel', '--url', 'http://127.0.0.1:8787']);
    tunnel.stop();
    expect(child.kill).toHaveBeenCalled();
  });

  it("does not take cloudflared's own api.trycloudflare.com for the tunnel, and waits for the real address", async () => {
    const child = fakeChild();
    const pending = startQuickTunnel({ port: 1, spawnImpl: () => child as never });
    child.stderr.write('ERR Error unmarshaling QuickTunnel response: error="invalid character" url=https://api.trycloudflare.com/tunnel status_code="429 Too Many Requests"\n');
    child.stderr.write('ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp\n');
    child.stderr.write('INF |  https://calm-river-1234.trycloudflare.com  |\n');
    expect((await pending).url).toBe('https://calm-river-1234.trycloudflare.com');
  });

  it('fails, not with the api address, when cloudflared only complains and then exits', async () => {
    const child = fakeChild();
    const pending = startQuickTunnel({ port: 1, spawnImpl: () => child as never });
    child.stderr.write('ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": 429\n');
    child.emit('exit', 1);
    await expect(pending).rejects.toThrow('before it named an address');
  });

  it('fails with cloudflared output when it exits or stalls before naming an address', async () => {
    const exited = fakeChild();
    const first = startQuickTunnel({ port: 1, spawnImpl: () => exited as never });
    exited.stderr.write('ERR could not reach the edge');
    exited.emit('exit', 1);
    await expect(first).rejects.toThrow('could not reach the edge');
    const stalled = startQuickTunnel({ port: 1, timeoutMs: 20, spawnImpl: () => fakeChild() as never });
    await expect(stalled).rejects.toThrow('did not name');
  });

  it('reports cloudflared ending later', async () => {
    const child = fakeChild();
    const onExit = vi.fn();
    const pending = startQuickTunnel({ port: 1, onExit, spawnImpl: () => child as never });
    child.stderr.write('https://a-b.trycloudflare.com');
    await pending;
    child.emit('exit', 2);
    expect(onExit).toHaveBeenCalledWith(2);
  });
});

describe('running the bridge', () => {
  const start = async (argv: string[], env: NodeJS.ProcessEnv) => {
    const { out, io } = lines();
    const port = await freePort();
    const instance = await runBridge(parseCliArguments(['--port', String(port), ...argv]), { XDG_CONFIG_HOME: root, ...env }, io);
    running.push(instance);
    return { instance, out, port };
  };
  const pi = () => fakeCommand('pi', 'exit 0');

  it('listens, answers /health and prints a pairing code that names the public address and the secret', async () => {
    const { instance, out, port } = await start(['--public-url', 'https://pi.example.com'], { PATH: pi() });
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    const code = out.find(line => line.startsWith('mgnpi1.'))!;
    expect(code).toBe(instance.pairingCode);
    const { url, secret } = decodePairingCode(code);
    expect(url).toBe('https://pi.example.com');
    expect(fs.readFileSync(path.join(root, 'mygitnotes-pi-bridge', 'config.json'), 'utf8')).toContain(secret);
    expect(out.join('\n')).toMatch(/Pages allowed to use it: https:\/\/app\.mygitnotes\.com/);
    // The bridge takes tokens signed with the secret in the code, and nothing else.
    const session = (token: string) => fetch(`http://127.0.0.1:${port}/session`, { headers: { authorization: `Bearer ${token}` } });
    expect((await session('wrong')).status).toBe(401);
    expect((await session(signBridgeToken(secret, 'http', new Date(Date.now() + 60_000)))).status).toBe(200);
  });

  it('says there is no pairing code while it has no public address', async () => {
    const { instance, out } = await start([], { PATH: pi() });
    expect(instance.pairingCode).toBeUndefined();
    expect(out.join('\n')).toContain('no pairing code');
  });

  it('uses the quick tunnel address, warns that it changes, and ends cloudflared when stopped', async () => {
    const marker = path.join(root, 'cloudflared.pid');
    const bin = fakeCommand('cloudflared', `echo $$ > ${marker}\necho 'INF https://quiet-tunnel-1.trycloudflare.com' >&2\nexec sleep 60`);
    fs.copyFileSync(path.join(pi(), 'pi'), path.join(bin, 'pi'));
    fs.chmodSync(path.join(bin, 'pi'), 0o755);
    vi.stubEnv('PATH', `${bin}${path.delimiter}${process.env.PATH}`);
    const { instance, out } = await start(['--tunnel'], { PATH: bin });
    expect(decodePairingCode(instance.pairingCode!).url).toBe('https://quiet-tunnel-1.trycloudflare.com');
    expect(out.join('\n')).toMatch(/changes every time the bridge restarts.*named Cloudflare tunnel/s);
    const pid = Number(fs.readFileSync(marker, 'utf8'));
    expect(() => process.kill(pid, 0)).not.toThrow();
    await instance.stop();
    running.pop();
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 3000 });
  });

  it('refuses Windows with a plain message, and runs on macOS and Linux', async () => {
    expect(() => ensureSupportedPlatform('win32')).toThrow(CliError);
    expect(() => ensureSupportedPlatform('win32')).toThrow('macOS and Linux');
    expect(() => ensureSupportedPlatform('darwin')).not.toThrow();
    expect(() => ensureSupportedPlatform('linux')).not.toThrow();
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      await expect(runBridge(parseCliArguments([]), { XDG_CONFIG_HOME: root, PATH: pi() }, lines().io)).rejects.toThrow('macOS and Linux');
      expect(fs.existsSync(path.join(root, 'mygitnotes-pi-bridge'))).toBe(false);
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
  });

  it('starts Pi with only the note tools by default, last among its arguments, and without the bridge secret in its environment', async () => {
    const record = path.join(root, 'pi-record');
    const bin = fakeCommand('pi', `printf '%s\\n' "$@" > ${record}.argv\n/usr/bin/env > ${record}.vars.tmp\n/bin/mv ${record}.vars.tmp ${record}.vars\n/bin/cat > /dev/null`);
    vi.stubEnv('PATH', bin);
    vi.stubEnv('MYGITNOTES_BRIDGE_SECRET', 's'.repeat(40));
    const { instance, out, port } = await start(['--public-url', 'https://pi.example.com', '--model', 'sonnet'], { PATH: bin, MYGITNOTES_BRIDGE_SECRET: 's'.repeat(40) });
    expect(out.join('\n')).not.toContain('--allow-local-tools');
    const secret = decodePairingCode(instance.pairingCode!).secret;
    const response = await fetch(`http://127.0.0.1:${port}/session`, { method: 'POST', headers: { authorization: `Bearer ${signBridgeToken(secret, 'http', new Date(Date.now() + 60_000))}`, 'content-type': 'application/json' }, body: JSON.stringify({ location: { repository: 'github:octo/notes@main', folder: '' } }) });
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(fs.existsSync(`${record}.vars`)).toBe(true), { timeout: 3000 });
    const argv = fs.readFileSync(`${record}.argv`, 'utf8').trim().split('\n');
    expect(argv.slice(-2)).toEqual(['--tools', NOTE_TOOLS]);
    expect(argv).toContain('sonnet');
    const environment = fs.readFileSync(`${record}.vars`, 'utf8');
    expect(environment).toContain('MYGITNOTES_WEB_TOOLS_URL=');
    expect(environment).not.toContain('MYGITNOTES_BRIDGE_');
    expect(environment).not.toContain('s'.repeat(40));
  });

  it('gives Pi its own tools with --allow-local-tools, and warns what that exposes', async () => {
    const record = path.join(root, 'pi-record');
    const bin = fakeCommand('pi', `printf '%s\\n' "$@" > ${record}.argv.tmp\n/bin/mv ${record}.argv.tmp ${record}.argv\n/bin/cat > /dev/null`);
    vi.stubEnv('PATH', bin);
    const { instance, out, port } = await start(['--public-url', 'https://pi.example.com', '--allow-local-tools'], { PATH: bin });
    expect(out.join('\n')).toMatch(/WARNING.*local tools.*files and commands/s);
    const secret = decodePairingCode(instance.pairingCode!).secret;
    await fetch(`http://127.0.0.1:${port}/session`, { method: 'POST', headers: { authorization: `Bearer ${signBridgeToken(secret, 'http', new Date(Date.now() + 60_000))}`, 'content-type': 'application/json' }, body: JSON.stringify({ location: { repository: 'github:octo/notes@main', folder: '' } }) });
    await vi.waitFor(() => expect(fs.existsSync(`${record}.argv`)).toBe(true), { timeout: 3000 });
    expect(fs.readFileSync(`${record}.argv`, 'utf8')).not.toContain('--tools');
  });

  it('fails through CliError, and stops serving, when cloudflared ends after it named an address but before the bridge is up', async () => {
    const port = await freePort();
    const startTunnel = vi.fn(async (options: { onExit?: (code: number | null) => void; }) => {
      queueMicrotask(() => options.onExit?.(1));
      return { url: 'https://a-b.trycloudflare.com', stop: vi.fn() };
    });
    await expect(runBridge(parseCliArguments(['--tunnel', '--port', String(port)]), { XDG_CONFIG_HOME: root, PATH: (pi(), fakeCommand('cloudflared', 'exit 0')) }, lines().io, { startTunnel: startTunnel as never })).rejects.toThrow(/cloudflared stopped.*exit 1/);
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  });

  it('names the install command when Pi is missing, and writes nothing', async () => {
    const empty = path.join(root, 'empty');
    fs.mkdirSync(empty);
    await expect(runBridge(parseCliArguments([]), { XDG_CONFIG_HOME: root, PATH: empty }, lines().io)).rejects.toThrow(PI_INSTALL_COMMAND);
    expect(fs.existsSync(path.join(root, 'mygitnotes-pi-bridge'))).toBe(false);
  });

  it('says cloudflared is missing for --tunnel, before it writes anything', async () => {
    await expect(runBridge(parseCliArguments(['--tunnel']), { XDG_CONFIG_HOME: root, PATH: pi() }, lines().io)).rejects.toThrow('cloudflared');
    expect(fs.existsSync(path.join(root, 'mygitnotes-pi-bridge'))).toBe(false);
  });

  it('names the port when it is taken', async () => {
    const taken = net.createServer();
    await new Promise<void>(resolve => taken.listen(0, '127.0.0.1', resolve));
    const { port } = taken.address() as net.AddressInfo;
    await expect(runBridge(parseCliArguments(['--port', String(port)]), { XDG_CONFIG_HOME: root, PATH: pi() }, lines().io)).rejects.toThrow(`Port ${port} is already in use`);
    taken.close();
  });

  it('prints help and the version without starting anything', async () => {
    const { out, io } = lines();
    expect(await main(['--help'], {}, io)).toBe(0);
    expect(out[0]).toContain('Usage: mygitnotes-pi-bridge');
    expect(await main(['--version'], {}, io)).toBe(0);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main(['--bogus'], {}, io)).toBe(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
