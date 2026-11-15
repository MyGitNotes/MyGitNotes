import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { socketAddress } from './socket-address.js';

const request = (remoteAddress: string | undefined, forwarded?: string | string[]) => ({ socket: { remoteAddress }, headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded } }) as unknown as IncomingMessage;

describe('socketAddress', () => {
  it('takes the address a reverse proxy on the host or the private network forwarded: the last one, which it wrote', () => {
    expect(socketAddress(request('127.0.0.1', '203.0.113.5'))).toBe('203.0.113.5');
    expect(socketAddress(request('::1', '198.51.100.1, 203.0.113.5'))).toBe('203.0.113.5');
    expect(socketAddress(request('::ffff:172.18.0.3', ['198.51.100.1', '203.0.113.5 ']))).toBe('203.0.113.5');
    expect(socketAddress(request('10.0.0.2', '2001:db8::1'))).toBe('2001:db8::1');
    expect(socketAddress(request('fd00::2', '203.0.113.5'))).toBe('203.0.113.5');
  });

  it('ignores the header from any other peer, which could write any address in it', () => {
    expect(socketAddress(request('203.0.113.9', '203.0.113.5'))).toBe('203.0.113.9');
    expect(socketAddress(request('::ffff:203.0.113.9', '203.0.113.5'))).toBe('203.0.113.9');
    expect(socketAddress(request('172.32.0.1', '203.0.113.5'))).toBe('172.32.0.1');
  });

  it('takes the peer without a header, or with an empty one', () => {
    expect(socketAddress(request('127.0.0.1'))).toBe('127.0.0.1');
    expect(socketAddress(request('127.0.0.1', ' , '))).toBe('127.0.0.1');
    expect(socketAddress(request(undefined))).toBe('unknown');
  });

  it('takes an entry written as address:port by its address, and falls back to the peer for one that is no address (BG-F004)', () => {
    expect(socketAddress(request('127.0.0.1', '203.0.113.5:52114'))).toBe('203.0.113.5');
    expect(socketAddress(request('127.0.0.1', '[2001:db8::1]:443'))).toBe('2001:db8::1');
    expect(socketAddress(request('127.0.0.1', '[2001:db8::1]'))).toBe('2001:db8::1');
    expect(socketAddress(request('127.0.0.1', '198.51.100.1, unknown'))).toBe('127.0.0.1');
    expect(socketAddress(request('10.0.0.2', 'not-an-address'))).toBe('10.0.0.2');
    expect(socketAddress(request('10.0.0.2', '203.0.113.5:x'))).toBe('10.0.0.2');
    expect(socketAddress(request('10.0.0.2', '::ffff:203.0.113.7'))).toBe('203.0.113.7');
  });
});
