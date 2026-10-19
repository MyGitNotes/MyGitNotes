import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { BRIDGE_PROTOCOL_PREFIX, type PiBridge, type PiBridgeOptions, startPiBridge } from './pi-bridge.js';
import { signBridgeToken } from './pi-bridge-token.js';

// A stand-in for `pi --mode rpc`: answers get_state, echoes a prompt with its argv and one environment variable,
// answers bash, and on "tool" calls the bridge's note tools with the token it was started with.
const FAKE_PI = `
const out = record => process.stdout.write(JSON.stringify(record) + '\\n');
let buffer = '';
process.stdin.on('data', chunk => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const command = JSON.parse(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
    if (command.type === 'get_state') out({ id: command.id, type: 'response', command: 'get_state', success: true, data: { sessionFile: process.cwd() + '/s.jsonl' } });
    if (command.type === 'bash') out({ id: command.id, type: 'response', command: 'bash', success: true, data: { output: 'ran' } });
    if (command.type === 'prompt' && command.message === 'tool') {
      fetch(process.env.MYGITNOTES_WEB_TOOLS_URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.MYGITNOTES_WEB_TOOLS_TOKEN }, body: JSON.stringify({ tool: 'read_note', arguments: { path: 'notes/a.md' } }) })
        .then(async res => out({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: JSON.stringify({ status: res.status, body: await res.json() }) }] } }));
    } else if (command.type === 'prompt') out({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: JSON.stringify({ args: process.argv.slice(2), model: process.env.FAKE_MODEL, message: command.message }) }] } });
  }
});
process.stdin.on('end', () => process.exit(0));
`;

const token = 'bridge-token-0123456789';
const location = { repository: 'github:octo/notes@main', folder: '' };
let bridge: PiBridge | undefined;
let temp: string | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await bridge?.close();
  bridge = undefined;
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
  temp = undefined;
});

async function start(options: Partial<PiBridgeOptions> = {}) {
  // Inside the home directory, where a resumed session file must live.
  temp = fs.realpathSync(fs.mkdtempSync(path.join(os.homedir(), '.mygitnotes-pi-bridge-test-')));
  const script = path.join(temp, 'fake-pi.cjs');
  fs.writeFileSync(script, FAKE_PI);
  const command = path.join(temp, 'fake-pi');
  fs.writeFileSync(command, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  bridge = await startPiBridge({ port: 0, host: '127.0.0.1', token, publicUrl: 'https://sbx.example.run/', cwd: temp, command, piArgs: ['--no-builtin-tools', '--model', 'mygitnotes/mygitnotes'], env: { FAKE_MODEL: 'built-in' }, ...options });
  return bridge;
}

const call = (method: string, route: string, body?: unknown, bearer: string | null = token) => fetch(`${bridge!.url}${route}`, { method, headers: { 'content-type': 'application/json', ...bearer ? { authorization: `Bearer ${bearer}` } : {} }, body: body === undefined ? undefined : JSON.stringify(body) });

function open(protocol = `${BRIDGE_PROTOCOL_PREFIX}${token}`, origin = 'https://app.example.com') {
  const ws = new WebSocket(`${bridge!.url.replace('http', 'ws')}/ws`, protocol, { origin });
  sockets.push(ws);
  // A refused socket also errors; the refusal is what the tests read.
  ws.on('error', () => {});
  const received: Record<string, unknown>[] = [];
  ws.on('message', data => received.push(JSON.parse(String(data))));
  const until = (match: (record: Record<string, unknown>) => boolean) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const check = () => {
        const found = received.find(match);
        if (found) return resolve(found);
        if (ws.readyState === WebSocket.CLOSED) return reject(new Error('closed'));
        setTimeout(check, 10);
      };
      check();
    });
  return { ws, received, until, opened: new Promise<void>((resolve, reject) => ws.once('open', () => resolve()).once('unexpected-response', (_req, res) => reject(new Error(String(res.statusCode))))) };
}

const reply = (record: Record<string, unknown>) => JSON.parse((record.message as { content: { text: string; }[]; }).content[0].text);

it('answers health to anyone, and the session only to the bridge token', async () => {
  await start();
  expect((await fetch(`${bridge!.url}/health`)).status).toBe(200);
  expect((await call('GET', '/session', undefined, null)).status).toBe(401);
  expect((await call('GET', '/session', undefined, 'wrong')).status).toBe(401);
  expect(await (await call('GET', '/session')).json()).toEqual({ session: null });
});

it("starts Pi with the host's arguments and environment, and names the socket at the public URL", async () => {
  await start();
  const { session } = await (await call('POST', '/session', { location })).json();
  expect(session).toMatchObject({ location, socket: { url: 'wss://sbx.example.run/ws', protocols: [`${BRIDGE_PROTOCOL_PREFIX}${token}`] } });
  expect((await (await call('POST', '/session', { location })).json()).session.id).toBe(session.id);
  const page = open();
  await page.opened;
  page.ws.send(JSON.stringify({ type: 'prompt', message: 'hi' }));
  const answer = reply(await page.until(record => record.type === 'message_end'));
  expect(answer.model).toBe('built-in');
  expect(answer.args.slice(-3)).toEqual(['--no-builtin-tools', '--model', 'mygitnotes/mygitnotes']);
});

it('refuses a socket without the token, from another origin, or before a session', async () => {
  await start({ allowedOrigins: ['https://app.example.com'] });
  await expect(open().opened).rejects.toThrow('409');
  await call('POST', '/session', { location });
  await expect(open(`${BRIDGE_PROTOCOL_PREFIX}wrong`).opened).rejects.toThrow('401');
  await expect(open(undefined, 'https://evil.example.com').opened).rejects.toThrow('403');
  const page = open();
  await page.opened;
  expect(page.ws.protocol).toBe(`${BRIDGE_PROTOCOL_PREFIX}${token}`);
});

it("refuses a client's shell commands unless the host allows them", async () => {
  await start();
  await call('POST', '/session', { location });
  const page = open();
  await page.opened;
  page.ws.send(JSON.stringify({ id: 'b1', type: 'bash', command: 'whoami' }));
  expect(await page.until(record => record.type === 'bridge_error')).toEqual({ type: 'bridge_error', error: 'Command is not allowed.' });
});

it("answers Pi's note tools from the page holding the panel", async () => {
  await start();
  await call('POST', '/session', { location });
  const page = open();
  await page.opened;
  page.ws.send(JSON.stringify({ type: 'prompt', message: 'tool' }));
  const request = await page.until(record => record.type === 'web_tool_request');
  expect(request).toMatchObject({ tool: 'read_note', arguments: { path: 'notes/a.md' } });
  page.ws.send(JSON.stringify({ type: 'web_tool_response', id: request.id, result: { content: 'From the page.' } }));
  expect(reply(await page.until(record => record.type === 'message_end'))).toEqual({ status: 200, body: { result: { content: 'From the page.' } } });
  expect((await fetch(`${bridge!.url}/web-tools`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{}' })).status).toBe(401);
});

it('restarts in a new place and ends on request', async () => {
  await start();
  const first = (await (await call('POST', '/session', { location })).json()).session;
  const other = { repository: 'github:octo/other@main', folder: '' };
  const second = (await (await call('PUT', '/session', { location: other })).json()).session;
  expect(second.id).not.toBe(first.id);
  expect(second.location).toEqual(other);
  expect((await call('POST', '/session', { location: 'nowhere' })).status).toBe(400);
  expect(await (await call('DELETE', '/session')).json()).toEqual({ session: null });
  expect(await (await call('GET', '/session')).json()).toEqual({ session: null });
});

it('reports activity at most once per interval while the page and Pi talk', async () => {
  let reports = 0;
  await start({ activity: () => reports++, activityIntervalMs: 60_000 });
  await call('POST', '/session', { location });
  const page = open();
  await page.opened;
  page.ws.send(JSON.stringify({ type: 'prompt', message: 'one' }));
  page.ws.send(JSON.stringify({ type: 'prompt', message: 'two' }));
  await page.until(record => record.type === 'message_end' && reply(record).message === 'two');
  expect(reports).toBe(1);
});

describe('signed tokens', () => {
  const secret = 'shared-secret-0123456789';
  let clock = new Date('2026-10-19T12:00:00Z');
  const now = () => clock;
  const http = (expiresAt = new Date(clock.getTime() + 60_000), withSecret = secret) => signBridgeToken(withSecret, 'http', expiresAt);
  const signed = () => start({ token: undefined, secret, now });

  it('accepts a valid HTTP token and refuses expired, forged and wrong-scope ones', async () => {
    clock = new Date('2026-10-19T12:00:00Z');
    await signed();
    expect((await call('GET', '/session', undefined, http())).status).toBe(200);
    expect((await call('GET', '/session', undefined, http(new Date(clock.getTime() - 1000)))).status).toBe(401);
    expect((await call('GET', '/session', undefined, http(undefined, 'other-secret'))).status).toBe(401);
    expect((await call('GET', '/session', undefined, signBridgeToken(secret, 'socket', new Date(clock.getTime() + 60_000)))).status).toBe(401);
    expect((await call('GET', '/session', undefined, `${http().slice(0, -2)}xx`)).status).toBe(401);
    expect((await call('GET', '/session', undefined, token)).status).toBe(401);
  });

  it('names a socket token for the session and accepts it on the socket only until it expires', async () => {
    clock = new Date('2026-10-19T12:00:00Z');
    await signed();
    const { session } = await (await call('POST', '/session', { location }, http())).json();
    const [protocol] = session.socket.protocols as string[];
    expect(protocol.startsWith(BRIDGE_PROTOCOL_PREFIX)).toBe(true);
    expect(protocol).not.toContain(secret);
    const page = open(protocol);
    await page.opened;
    expect(page.ws.protocol).toBe(protocol);
    // An HTTP token is not a socket token, a forged one fails, and the socket token expires.
    await expect(open(`${BRIDGE_PROTOCOL_PREFIX}${http()}`).opened).rejects.toThrow('401');
    await expect(open(`${protocol.slice(0, -2)}xx`).opened).rejects.toThrow('401');
    clock = new Date(clock.getTime() + 11 * 60_000);
    await expect(open(protocol).opened).rejects.toThrow('401');
    // A token issued for an earlier session does not open the next one.
    const restarted = (await (await call('PUT', '/session', { location }, http())).json()).session;
    expect(restarted.id).not.toBe(session.id);
    clock = new Date('2026-10-19T12:00:00Z');
    await expect(open(protocol).opened).rejects.toThrow('401');
    await expect(open(restarted.socket.protocols[0]).opened).resolves.toBeUndefined();
  });

  it('echoes the subprotocol that verified when several are offered', async () => {
    clock = new Date('2026-10-19T12:00:00Z');
    await signed();
    const { session } = await (await call('POST', '/session', { location }, http())).json();
    const [protocol] = session.socket.protocols as string[];
    const page = open([`${BRIDGE_PROTOCOL_PREFIX}${http()}`, protocol] as never);
    await page.opened;
    expect(page.ws.protocol).toBe(protocol);
  });

  it('keeps the equal-token mode working when only a token is given', async () => {
    await start();
    expect((await call('GET', '/session')).status).toBe(200);
    expect((await call('GET', '/session', undefined, http())).status).toBe(401);
  });

  it('needs a token or a secret', async () => {
    await expect(start({ token: undefined })).rejects.toThrow('token or a secret');
  });
});
