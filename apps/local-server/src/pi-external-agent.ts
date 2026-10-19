import express from 'express';
import type { IdentityService } from './identity.js';
import type { PiAgent } from './pi-agent.js';
import { signBridgeToken } from './pi-bridge-token.js';
import { decodePairingCode } from './pi-pairing.js';
import type { PiSessionInfo } from './pi-session.js';

export interface ExternalPiAgentOptions {
  /** Where this server reaches the owner's bridge, e.g. `https://pi.example.com`. */
  bridgeUrl: string;
  /** The secret the bridge was started with (`MYGITNOTES_BRIDGE_SECRET`). */
  secret: string;
  /** The signed-in people who may use the agent: a login or `id:<user id>` at the deployment's sign-in provider, whose realm their session must match. */
  owners: string[];
  /** Who is signed in; the allow-list is checked against its `login` and person id, so a session of another realm or past its expiry is no owner. */
  identity: Pick<IdentityService, 'signedIn'>;
  fetch?: typeof fetch;
  now?: () => Date;
  /** How long the token for one call to the bridge stays valid, in milliseconds. */
  callTokenMs?: number;
}

interface ExternalPiEnvironment {
  bridgeUrl: string;
  secret: string;
  owners: string[];
}

/** The deployment's settings for an external bridge, or undefined when neither `MYGITNOTES_EXTERNAL_PI_PAIRING` nor `MYGITNOTES_EXTERNAL_PI_URL` is set; a partial setting throws. */
export function externalPiEnvironment(env: NodeJS.ProcessEnv = process.env): ExternalPiEnvironment | undefined {
  const pairing = env.MYGITNOTES_EXTERNAL_PI_PAIRING?.trim();
  const bridgeUrl = env.MYGITNOTES_EXTERNAL_PI_URL?.trim();
  if (!pairing && !bridgeUrl) return undefined;
  const secret = env.MYGITNOTES_EXTERNAL_PI_SECRET?.trim();
  const owners = (env.MYGITNOTES_EXTERNAL_PI_OWNERS ?? '').split(',').map(entry => entry.trim()).filter(Boolean);
  if (pairing && (bridgeUrl || secret)) throw new Error('Set MYGITNOTES_EXTERNAL_PI_PAIRING or MYGITNOTES_EXTERNAL_PI_URL with MYGITNOTES_EXTERNAL_PI_SECRET, not both.');
  if (!pairing && !secret) throw new Error('Set MYGITNOTES_EXTERNAL_PI_SECRET beside MYGITNOTES_EXTERNAL_PI_URL.');
  if (!owners.length) throw new Error('Set MYGITNOTES_EXTERNAL_PI_OWNERS to the logins (or id:<user id>) allowed to use the agent.');
  const paired = pairing ? decodePairingCode(pairing) : undefined;
  return { bridgeUrl: paired?.url ?? bridgeUrl ?? '', secret: paired?.secret ?? secret ?? '', owners };
}

const DEFAULT_CALL_TOKEN_MS = 60_000;

/**
 * A remote deployment's agent panel for a Pi bridge its owner runs elsewhere (see pi-bridge-main). Only the listed
 * signed-in people see it; `/api/pi/session` is forwarded to the bridge with a short-lived signed token, and the
 * session answer's `socket` points the browser at the bridge with a token that expires and names that session.
 */
export function externalPiAgent(options: ExternalPiAgentOptions): PiAgent {
  const { secret, identity } = options;
  const fetchImpl = options.fetch ?? fetch, now = options.now ?? (() => new Date());
  const bridgeUrl = options.bridgeUrl.replace(/\/$/, '');
  const owners = new Set(options.owners.map(entry => entry.toLowerCase()));
  const router = express.Router();

  const isOwner = async (req: express.Request, res: express.Response) => {
    try {
      const signedIn = await identity.signedIn(req, res);
      const login = signedIn?.login.toLowerCase();
      const id = signedIn ? `id:${signedIn.person.userId}` : undefined;
      return Boolean((login && owners.has(login)) || (id && owners.has(id)));
    } catch {
      // An unreadable session is no sign-in.
      return false;
    }
  };

  // Everyone else gets what a deployment without an agent answers, so the panel stays hidden.
  router.use(async (req, res, next) => {
    if (await isOwner(req, res)) return next();
    res.status(404).json({ error: 'This deployment offers no agent to you.' });
  });

  const forward = async (req: express.Request, res: express.Response) => {
    const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : JSON.stringify({ location: req.body?.location ?? { repository: req.body?.repository, folder: req.body?.folder }, ...req.body?.sessionFile === undefined ? {} : { sessionFile: req.body.sessionFile } });
    try {
      const token = signBridgeToken(secret, 'http', new Date(now().getTime() + (options.callTokenMs ?? DEFAULT_CALL_TOKEN_MS)));
      const response = await fetchImpl(`${bridgeUrl}/session`, { method: req.method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(15_000) });
      const reply = await response.json().catch(() => ({})) as { session?: PiSessionInfo | null; error?: string; };
      if (!response.ok) return res.status(response.status === 400 ? 400 : 502).json({ error: reply.error ?? `The agent's bridge answered ${response.status}.` });
      res.json({ session: reply.session ?? null, piAvailable: true });
    } catch {
      res.status(502).json({ error: "The agent's bridge is unreachable. Check that it is running." });
    }
  };
  for (const method of ['get', 'post', 'put', 'delete'] as const) router[method]('/session', forward);

  return { router, availableTo: isOwner };
}
