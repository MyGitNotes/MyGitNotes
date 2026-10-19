/** What a pairing code carries: where the deployment reaches the owner's Pi bridge and the secret they share. */
export interface PiPairing {
  /** The bridge's public HTTPS address, without a trailing slash. */
  url: string;
  secret: string;
}

const PREFIX = 'mgnpi1.';
const VERSION = 1;
export const MIN_PAIRING_SECRET_LENGTH = 32;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** The reason `url` cannot be the address in a pairing code, or undefined when it can. */
export function pairingAddressProblem(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url) return 'The pairing code names no address.';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'The pairing code names an address that is not a URL.';
  }
  if (parsed.protocol !== 'https:') return 'The pairing code must name an https address.';
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return 'The pairing code names an address with credentials, a query or a fragment.';
  return undefined;
}

/** The reason a pairing's parts are not acceptable, or undefined when they are. */
function problem(url: unknown, secret: unknown): string | undefined {
  const bad = pairingAddressProblem(url);
  if (bad) return bad;
  if (typeof secret !== 'string' || secret.length < MIN_PAIRING_SECRET_LENGTH) return `The pairing code carries a secret shorter than ${MIN_PAIRING_SECRET_LENGTH} characters.`;
  return undefined;
}

const withoutTrailingSlash = (url: string) => url.replace(/\/+$/, '');

/** `mgnpi1.<base64url JSON>`: the one string a person pastes into an edition or a deployment to reach their bridge. */
export function encodePairingCode(pairing: PiPairing): string {
  const bad = problem(pairing.url, pairing.secret);
  if (bad) throw new Error(bad);
  return `${PREFIX}${Buffer.from(JSON.stringify({ v: VERSION, url: withoutTrailingSlash(pairing.url), secret: pairing.secret })).toString('base64url')}`;
}

/** Reads a pairing code; anything that is not exactly a version 1 code with an https address and a strong secret throws. */
export function decodePairingCode(code: string): PiPairing {
  const text = code.trim();
  if (!text.startsWith(PREFIX)) throw new Error(`A pairing code starts with ${PREFIX}.`);
  const body = text.slice(PREFIX.length);
  if (!body || !BASE64URL.test(body)) throw new Error('The pairing code is not valid base64url; copy it again in full.');
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new Error('The pairing code does not hold readable data; copy it again in full.');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('The pairing code does not hold a pairing.');
  const { v, url, secret, ...rest } = value as Record<string, unknown>;
  if (v !== VERSION) throw new Error(`This pairing code has version ${String(v)}; only version ${VERSION} is understood. Update MyGitNotes or the bridge.`);
  if (Object.keys(rest).length) throw new Error('The pairing code holds fields this version does not know.');
  const bad = problem(url, secret);
  if (bad) throw new Error(bad);
  return { url: withoutTrailingSlash(url as string), secret: secret as string };
}
