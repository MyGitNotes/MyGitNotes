import type { CommitAuthor, LiveIdentity, WorkspacePerson, WorkspaceSite } from '@mygitnotes/core';
import type { Request, Response, Router } from 'express';
import { type AuthServices, authToken, credentialId, credentialToken, getSession, ownerOf, providerFor, providerRouter, saveCredential, type SessionServices } from './auth.js';
import type { StoredRecord } from './record-store/index.js';

/** Who a request acts for, as grants and configuration sources see them. */
export interface SignedIn {
  person: WorkspacePerson;
  /** Shown in the account menu. */
  login: string;
  /** The grant index owner of this person. */
  owner: string | number;
  /**
   * The person as the author of the commits their requests make, for an identity whose `token` is a credential the
   * deployment shares: the provider would otherwise record that credential's account. Left out, as the default
   * identity leaves it, a commit is authored by the token's account. A name or email with a line break, `<`, `>` or a
   * control character refuses the person's writes (400), and an empty one counts as none.
   */
  author?: CommitAuthor;
  /**
   * How live editing shows and credits the person: the name other editors see, and the email a check-in commit names
   * them by, which must be one the identity verified as theirs (or be left out: such a person is shown, may author a
   * check-in through their own credential, and is nobody's co-author). Left out, `author` does. It names nobody on the
   * person's ordinary commits, which follow `author` alone.
   */
  live?: LiveIdentity;
}
/**
 * What an identity resolves an outside bearer to: who an `/mcp` call acts for and how far it reaches. It is a grant
 * for that one call, kept nowhere.
 */
export interface BearerGrant {
  person: WorkspacePerson;
  /** The grant index owner of this person, as `SignedIn.owner`. */
  owner: string | number;
  /** The person as the author of the commits the call makes, as `SignedIn.author`; carried on the grant to the sources the call opens. */
  author?: CommitAuthor;
  /** How live editing shows and credits the person, as `SignedIn.live`; carried on the grant to the live editor. */
  live?: LiveIdentity;
  /** Whether the call may write. Only `true` writes; a call without it gets no write tool, as a read-only grant does. */
  write: boolean;
  /** The site the grant reaches, as `siteIdentity` writes it. A deployment on another site refuses the call. */
  site: string;
}
/** One way to sign in, as the web app lists it. */
export interface SignInOption {
  id: string;
  label: string;
  url: string;
  /** Marks the option the probe's `provider` and `loginUrl` name for a web bundle cached across a deploy (the first option when none is marked). */
  legacy?: boolean;
}
/**
 * Who is signed in, and the credentials they hold. The server asks this service wherever it used to read a provider
 * session, so an edition can sign people in without a provider token (see docs/specs/2026-10-19-identity-service).
 */
export interface IdentityService {
  /** Sign-in, callbacks and any edition auth routes; mounted at /api/auth ahead of /session, /logout and the grant routes. */
  readonly router: Router;
  /** Who the request is signed in as. A read only: it must not refresh or write the session, so it can be asked of any request. */
  signedIn(req: Request, res: Response): Promise<SignedIn | null>;
  /**
   * The person's provider token on `site`, refreshed when near expiry; undefined when they have none usable there.
   * Throws `CredentialRejected` only where the identity treats a rejected credential as signed out (the default does).
   */
  token(req: Request, res: Response, site: WorkspaceSite, refreshWithinMs?: number): Promise<string | undefined>;
  /** What a new agent grant records beside its person and owner. */
  grantCredential(req: Request, res: Response, signedIn: SignedIn, site: WorkspaceSite): Promise<string | undefined>;
  /** A grant's provider token on `site` at call time; undefined when its person has none. */
  grantToken(grant: StoredRecord, person: WorkspacePerson | undefined, site: WorkspaceSite): Promise<string | undefined>;
  /**
   * The person's own provider token on `site` with no request at hand, refreshed when near expiry: what a check-in of a
   * live note commits with as that person (`LiveServiceCalls.open`'s `as`). Undefined when the identity keeps none for
   * them; throws `CredentialRejected` for one that is refused, revoked or expired. Left out, the identity keeps no
   * credential that outlives a request, and a composition cannot commit check-ins with the editors' own.
   */
  personToken?(person: WorkspacePerson, site: WorkspaceSite): Promise<string | undefined>;
  /**
   * Resolves a bearer `/mcp` was sent that is not shaped like one of this server's stored grants (an OIDC access token,
   * say) to the person it acts for, or to null to refuse it. The identity verifies the bearer itself: its signature,
   * issuer, audience, expiry and whatever else makes it trustworthy. `/mcp` never keeps or logs the bearer, answers 401
   * without detail on null or a throw, and still asks `grantToken` for the credential the call uses, so the bearer is
   * never sent to a provider. Left out, such a bearer is refused as before. Any caller can send any bearer, unverified
   * and unthrottled, so the identity bounds its own cost (key caching, length and shape checks before any lookup).
   */
  bearerGrant?(req: Request, bearer: string): Promise<BearerGrant | null>;
  /** Why a provider repository cannot open for a signed-in person without a credential on `site`. */
  noCredentialMessage(site: WorkspaceSite): string;
  signInOptions(req: Request): Promise<SignInOption[]>;
  /** Whether sign-in is configured (`/api/auth/session`'s `configured`). */
  configured(req: Request): Promise<boolean>;
  signOut(req: Request, res: Response): Promise<void>;
}

/**
 * The grant `/mcp` acts on for a resolved bearer, shaped like a stored agent grant without a credential; `grantToken`
 * is asked with it. Null for an answer that is not a {@link BearerGrant}, which `/mcp` refuses: an identity written
 * without types must not widen a grant by answering loosely.
 */
export function bearerGrantRecord(resolved: BearerGrant): StoredRecord | null {
  const text = (value: unknown): value is string => typeof value === 'string' && value !== '';
  const id = (value: unknown): value is string | number => text(value) || (typeof value === 'number' && Number.isFinite(value));
  if (typeof resolved !== 'object' || resolved === null) return null;
  const { person, owner, author, live, write, site } = resolved;
  if (typeof person !== 'object' || person === null || !text(person.realm) || !id(person.userId) || !id(owner) || typeof write !== 'boolean' || !text(site)) return null;
  if (author !== undefined && (typeof author !== 'object' || author === null || !text(author.name) || !text(author.email))) return null;
  if (live !== undefined && (typeof live !== 'object' || live === null || !text(live.name) || (live.email !== undefined && !text(live.email)))) return null;
  return { kind: 'agent', ownerId: owner, person: { realm: person.realm, userId: person.userId }, site, write, ...(author ? { author: { name: author.name, email: author.email } } : {}), ...(live ? { live: { name: live.name, ...(live.email !== undefined ? { email: live.email } : {}) } } : {}) };
}

/**
 * How the live editor shows and credits someone signed in with the site's provider. On github.com, their login and
 * the noreply address GitHub documents for an account (`<id>+<login>@users.noreply.github.com`), which GitHub credits
 * to that account in a commit; no personal email is read. On GitHub Enterprise and GitLab, their login alone: no
 * address there is known to be theirs, so they are shown, author a check-in through their own token, and are nobody's
 * co-author.
 */
export function providerLiveIdentity(site: WorkspaceSite, session: { userId: number | string; login: string; }): LiveIdentity {
  return providerFor(site).unscoped ? { name: session.login, email: `${session.userId}+${session.login}@users.noreply.github.com` } : { name: session.login };
}

/** What the default identity adds where the deployment runs the built-in live editor. */
export interface ProviderIdentityOptions {
  /** Names each signed-in person for the live editor (`SignedIn.live`, {@link providerLiveIdentity}); left out, nobody is, and every answer is as before. */
  live?: boolean;
}

/** Today's behavior: sign in with the workspace site's GitHub or GitLab, and hold that provider's token. */
export function providerIdentity(services: AuthServices, options: ProviderIdentityOptions = {}): IdentityService {
  const { store, sessions, configSource } = services;
  const siteOf = async (req: Request) => (await configSource.settings(req)).site;
  return {
    router: providerRouter(services),
    async signedIn(req) {
      const site = await siteOf(req), provider = providerFor(site), session = await getSession(req, sessions, provider);
      return session ? { person: { realm: provider.realm, userId: session.userId }, login: session.login, owner: ownerOf(session, provider), ...(options.live ? { live: providerLiveIdentity(site, session) } : {}) } : null;
    },
    token: (req, res, site, refreshWithinMs) => authToken(req, res, services, site, refreshWithinMs),
    async grantCredential(req, _res, _signedIn, site) {
      const provider = providerFor(site), session = await getSession(req, sessions, provider);
      return session ? saveCredential(store, session, provider) : undefined;
    },
    grantToken: (grant, _person, site) => credentialToken(store, grant.credential || grant.session, site),
    // The credential a stored sign-in left, the one the person's agent grants use; a cookie session leaves none.
    async personToken(person, site) {
      const provider = providerFor(site);
      if (sessions.kind === 'cookie' || person.realm !== provider.realm || typeof person.userId !== 'number') return undefined;
      return credentialToken(store, credentialId(person.userId, provider), site);
    },
    noCredentialMessage: site => `Sign in with ${site.type === 'gitlab' ? 'GitLab' : 'GitHub'} to open this repository.`,
    async signInOptions(req) {
      const { type } = providerFor(await siteOf(req));
      return [{ id: type, label: type === 'gitlab' ? 'GitLab' : 'GitHub', url: `/api/auth/${type}` }];
    },
    async configured(req) {
      const provider = providerFor(await siteOf(req));
      const serverStoreReady = sessions.kind === 'cookie' || store.ready !== false;
      return Boolean(provider.clientId && provider.clientSecret && process.env.SESSION_SECRET && serverStoreReady);
    },
    signOut: (req, res) => sessions.clear(req, res),
  };
}

/** Anything that can stand for the sign-in of a request: an identity, or the stores the default identity is built on. */
export type IdentityOrSessions = IdentityService | SessionServices;
/** The identity of `auth`: itself when it is one, else the default identity over its stores. */
export function identityOf(auth: IdentityOrSessions, configSource: AuthServices['configSource']): IdentityService {
  return 'signedIn' in auth ? auth : providerIdentity({ ...auth, configSource });
}
