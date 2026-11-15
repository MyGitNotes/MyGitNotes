import type { IncomingMessage } from 'node:http';
import { isIP, isIPv4 } from 'node:net';

/** An IPv4 address in its IPv6 form (`::ffff:203.0.113.9`), as a dual-stack socket reports it, in its own. */
const plain = (address: string) => (/^::ffff:/i.test(address) && isIPv4(address.slice(7)) ? address.slice(7) : address);

/** Loopback, and the private and unique-local ranges a reverse proxy on the host or the container network reaches the app from. */
const PROXIED = [/^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^::1$/, /^f[cd][0-9a-f]{2}:/i];

/**
 * The address a socket's upgrade came from, for counting sockets by who opened them (docs/specs/2026-11-15-builtin-live-editor
 * §4.6). The server has no trust-proxy setting; deploy.md routes the public origin through a reverse proxy on the host
 * or the container network. From such a peer, the last X-Forwarded-For entry, the one that proxy appended, names the
 * client, when it is an address (a port the proxy wrote after it is dropped); an entry that is no address counts as
 * none. From any other peer the header is the client's own word and is ignored. Only the proxy directly in front of the
 * app is trusted: a CDN in front of it must reach the app with the client in that last entry (docs/deploy.md).
 */
/**
 * The address in one X-Forwarded-For entry: as written, `[v6]` or `[v6]:port`, or `v4:port` as some proxies write it.
 * Anything else is no address, and undefined.
 */
const entryAddress = (entry: string) => {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(entry);
  const address = bracketed ? bracketed[1] : isIP(entry) ? entry : /^([^:]+):\d+$/.exec(entry)?.[1];
  return address && isIP(address) ? plain(address) : undefined;
};

export function socketAddress(request: IncomingMessage): string {
  const peer = request.socket.remoteAddress;
  if (!peer) return 'unknown';
  const address = plain(peer);
  if (!PROXIED.some(range => range.test(address))) return address;
  const header = request.headers['x-forwarded-for'];
  const forwarded = (Array.isArray(header) ? header.join(',') : header ?? '').split(',').map(entry => entry.trim()).filter(Boolean).at(-1);
  return (forwarded && entryAddress(forwarded)) ?? address;
}
