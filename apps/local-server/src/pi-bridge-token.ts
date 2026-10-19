import { createHmac, timingSafeEqual } from 'node:crypto';

/** What a signed bridge token may be used for: the host's `/session` calls, or one session's socket. */
export type BridgeTokenScope = 'http' | 'socket';

const PREFIX = 'v1';
const AUDIENCE = 'mygitnotes-bridge';

const mac = (secret: string, body: string) => createHmac('sha256', secret).update(`${AUDIENCE}.${body}`).digest('base64url');

/**
 * A short-lived token for an external Pi bridge, signed with the secret the deployment and the bridge share, so a
 * browser holds only a token that expires and names one session instead of the secret. `session` binds a socket
 * token to the session it was issued for.
 */
export function signBridgeToken(secret: string, scope: BridgeTokenScope, expiresAt: Date, session?: string): string {
  const body = Buffer.from(JSON.stringify({ scope, exp: Math.floor(expiresAt.getTime() / 1000), ...session ? { sid: session } : {} })).toString('base64url');
  return `${PREFIX}.${body}.${mac(secret, body)}`;
}

/** Whether `token` was signed with `secret` for `scope`, has not expired and, when `session` is given, names that session. */
export function verifyBridgeToken(secret: string, token: string | undefined, scope: BridgeTokenScope, now: Date, session?: string): boolean {
  const [prefix, body, signature, ...rest] = (token ?? '').split('.');
  if (prefix !== PREFIX || !body || !signature || rest.length) return false;
  const expected = Buffer.from(mac(secret, body)), given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { scope?: unknown; exp?: unknown; sid?: unknown; };
    if (claims.scope !== scope || typeof claims.exp !== 'number' || claims.exp * 1000 <= now.getTime()) return false;
    return session === undefined || claims.sid === session;
  } catch {
    return false;
  }
}
