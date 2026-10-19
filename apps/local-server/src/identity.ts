import type { WorkspacePerson, WorkspaceSite } from '@mygitnotes/core';
import type { Request, Response, Router } from 'express';
import { type AuthServices, authToken, credentialToken, getSession, ownerOf, providerFor, providerRouter, saveCredential, type SessionServices } from './auth.js';
import type { StoredRecord } from './record-store/index.js';

/** Who a request acts for, as grants and configuration sources see them. */
export interface SignedIn {
  person: WorkspacePerson;
  /** Shown in the account menu. */
  login: string;
  /** The grant index owner of this person. */
  owner: string | number;
}
/** One way to sign in, as the web app lists it. */
export interface SignInOption {
  id: string;
  label: string;
  url: string;
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
  /** Why a provider repository cannot open for a signed-in person without a credential on `site`. */
  noCredentialMessage(site: WorkspaceSite): string;
  signInOptions(req: Request): Promise<SignInOption[]>;
  /** Whether sign-in is configured (`/api/auth/session`'s `configured`). */
  configured(req: Request): Promise<boolean>;
  signOut(req: Request, res: Response): Promise<void>;
}

/** Today's behavior: sign in with the workspace site's GitHub or GitLab, and hold that provider's token. */
export function providerIdentity(services: AuthServices): IdentityService {
  const { store, sessions, configSource } = services;
  const siteOf = async (req: Request) => (await configSource.settings(req)).site;
  return {
    router: providerRouter(services),
    async signedIn(req) {
      const provider = providerFor(await siteOf(req)), session = await getSession(req, sessions, provider);
      return session ? { person: { realm: provider.realm, userId: session.userId }, login: session.login, owner: ownerOf(session, provider) } : null;
    },
    token: (req, res, site, refreshWithinMs) => authToken(req, res, services, site, refreshWithinMs),
    async grantCredential(req, _res, _signedIn, site) {
      const provider = providerFor(site), session = await getSession(req, sessions, provider);
      return session ? saveCredential(store, session, provider) : undefined;
    },
    grantToken: (grant, _person, site) => credentialToken(store, grant.credential || grant.session, site),
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
