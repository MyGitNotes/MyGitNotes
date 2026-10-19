import { describe, expect, it } from 'vitest';
import { decodePairingCode, encodePairingCode } from '../src/edition.js';

const secret = 's'.repeat(43);
const forge = (value: unknown) => `mgnpi1.${Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')}`;
const good = { v: 1, url: 'https://pi.example.com', secret };

describe('pairing code', () => {
  it('round trips an address and a secret, and writes the documented shape', () => {
    const code = encodePairingCode({ url: 'https://pi.example.com', secret });
    expect(code).toMatch(/^mgnpi1\.[A-Za-z0-9_-]+$/);
    expect(JSON.parse(Buffer.from(code.slice(7), 'base64url').toString('utf8'))).toEqual(good);
    expect(decodePairingCode(code)).toEqual({ url: 'https://pi.example.com', secret });
  });

  it('drops a trailing slash, keeps a path prefix and forgives pasted whitespace', () => {
    expect(decodePairingCode(`  ${encodePairingCode({ url: 'https://pi.example.com/bridge/', secret })}\n`)).toEqual({ url: 'https://pi.example.com/bridge', secret });
    expect(decodePairingCode(forge({ ...good, url: 'https://pi.example.com/' })).url).toBe('https://pi.example.com');
  });

  it('refuses to make a code from an address or secret it would later reject', () => {
    expect(() => encodePairingCode({ url: 'http://pi.example.com', secret })).toThrow('https');
    expect(() => encodePairingCode({ url: 'https://pi.example.com', secret: 'short' })).toThrow('secret');
  });

  it.each([['a wrong prefix', `mgnpi2.${forge(good).slice(7)}`, 'starts with mgnpi1.'], ['no prefix', forge(good).slice(7), 'starts with mgnpi1.'], ['an empty body', 'mgnpi1.', 'base64url'], ['characters outside base64url', 'mgnpi1.abc+/=', 'base64url'], ['a body that is not JSON', forge('not json'), 'readable'], ['JSON that is not an object', forge('[1]'), 'does not hold a pairing'], ['null', forge('null'), 'does not hold a pairing'], ['another version', forge({ ...good, v: 2 }), 'version 2'], ['no version', forge({ url: good.url, secret }), 'version undefined'], ['a version written as text', forge({ ...good, v: '1' }), 'version 1'], ['an unknown field', forge({ ...good, extra: true }), 'fields this version does not know'], ['no address', forge({ v: 1, secret }), 'no address'], ['an address that is not a URL', forge({ ...good, url: 'pi.example.com' }), 'not a URL'], ['a plain http address', forge({ ...good, url: 'http://pi.example.com' }), 'https'], ['another scheme', forge({ ...good, url: 'wss://pi.example.com' }), 'https'], ['credentials in the address', forge({ ...good, url: 'https://user:pw@pi.example.com' }), 'credentials'], ['a query in the address', forge({ ...good, url: 'https://pi.example.com/?a=1' }), 'query'], ['a fragment in the address', forge({ ...good, url: 'https://pi.example.com/#x' }), 'fragment'], ['no secret', forge({ v: 1, url: good.url }), 'secret'], ['a secret that is not text', forge({ ...good, secret: 12345 }), 'secret'], ['a secret of 31 characters', forge({ ...good, secret: 's'.repeat(31) }), '32 characters']])('rejects %s', (_name, code, message) => {
    expect(() => decodePairingCode(code)).toThrow(message);
  });

  it('accepts a secret of exactly 32 characters', () => {
    expect(decodePairingCode(forge({ ...good, secret: 's'.repeat(32) })).secret).toHaveLength(32);
  });
});
