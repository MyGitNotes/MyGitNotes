import type { IncomingMessage } from 'node:http';
import { isIPv4 } from 'node:net';

/** An IPv4 address in its IPv6 form (`::ffff:203.0.113.9`), as a dual-stack socket reports it, in its own. */
const plain = (address: string) => (/^::ffff:/i.test(address) && isIPv4(address.slice(7)) ? address.slice(7) : address);

/** Loopback, and the private and unique-local ranges a reverse proxy on the host or the container network reaches the app from. */
const PROXIED = [/^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^::1$/, /^f[cd][0-9a-f]{2}:/i];

/**
 * The address a socket's upgrade came from, for counting sockets by who opened them (docs/specs/2026-11-15-builtin-live-editor
 * §4.6). The server has no trust-proxy setting; deploy.md routes the public origin through a reverse proxy on the host
 * or the container network. From such a peer, the last X-Forwarded-For entry, the one that proxy appended, names the
 * client; from any other peer the header is the client's own word and is ignored.
 */
export function socketAddress(request: IncomingMessage): string {
  const peer = request.socket.remoteAddress;
  if (!peer) return 'unknown';
  const address = plain(peer);
  if (!PROXIED.some(range => range.test(address))) return address;
  const header = request.headers['x-forwarded-for'];
  const forwarded = (Array.isArray(header) ? header.join(',') : header ?? '').split(',').map(entry => entry.trim()).filter(Boolean).at(-1);
  return forwarded ? plain(forwarded) : address;
}
