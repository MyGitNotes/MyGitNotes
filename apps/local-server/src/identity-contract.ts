import { siteIdentity, type WorkspaceSite } from '@mygitnotes/core';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import { bearerGrantRecord, type IdentityService } from './identity.js';

/** What an {@link IdentityService} needs to be exercised: two people it can sign in and the token each holds. */
export interface IdentityFixture {
  identity: IdentityService;
  /** The site the identity's tokens are asked for. */
  site: WorkspaceSite;
  /** Request cookies that make the n-th person (1 or 2) signed in. */
  visitor(n: number): Promise<Record<string, string>>;
  /** The provider token the n-th person holds on `site`; undefined when the identity gives them none. */
  tokenOf(n: number): string | undefined;
  /**
   * An outside bearer the identity's `bearerGrant` accepts for the n-th person on `site`, made the way the identity
   * expects one (a token signed by a test key, say). An identity without `bearerGrant` leaves it out, and one with
   * `bearerGrant` must give it.
   */
  bearerOf?(n: number): string | Promise<string>;
}

/** A browser for one visitor: it sends its cookies and keeps those a response sets or clears. */
function browser(initial: Record<string, string>) {
  const jar = { ...initial };
  const exchange = () => {
    const res = {
      cookie: (name: string, value: string) => {
        jar[name] = value;
        return res;
      },
      clearCookie: (name: string) => {
        delete jar[name];
        return res;
      },
    };
    const headers = { cookie: Object.entries(jar).map(([name, value]) => `${name}=${value}`).join('; ') };
    return { req: { headers } as unknown as Request, res: res as unknown as Response };
  };
  return { exchange };
}

/**
 * The behavior every {@link IdentityService} must keep. An edition runs it against its own implementation:
 * `identityContract('pro', async () => ({ identity, site, visitor: signIn, tokenOf }))`.
 * `makeFixture` is called once per test and should start with nobody signed in.
 */
export function identityContract(name: string, makeFixture: () => IdentityFixture | Promise<IdentityFixture>) {
  describe(`${name} identity contract`, () => {
    let fixture: IdentityFixture;
    beforeEach(async () => {
      fixture = await makeFixture();
    });
    const visit = async (n: number) => browser(await fixture.visitor(n));

    it('has no person for a request nobody signed in', async () => {
      const { req, res } = browser({}).exchange();
      expect(await fixture.identity.signedIn(req, res)).toBeNull();
    });

    it('names the person, their login and the owner of their grants, and tells two people apart', async () => {
      const first = await (async () => {
        const { req, res } = (await visit(1)).exchange();
        return fixture.identity.signedIn(req, res);
      })();
      const second = await (async () => {
        const { req, res } = (await visit(2)).exchange();
        return fixture.identity.signedIn(req, res);
      })();
      expect(first).toMatchObject({ login: expect.any(String), person: { realm: expect.any(String) } });
      expect(first!.owner).toBeTruthy();
      expect(second!.owner).not.toEqual(first!.owner);
      expect(second!.person).not.toEqual(first!.person);
    });

    it('gives each person their own token on the site, and none to a request nobody signed in', async () => {
      for (const n of [1, 2]) {
        const { req, res } = (await visit(n)).exchange();
        expect(await fixture.identity.token(req, res, fixture.site)).toBe(fixture.tokenOf(n));
      }
      const { req, res } = browser({}).exchange();
      expect(await fixture.identity.token(req, res, fixture.site)).toBeUndefined();
    });

    it('lists its sign-in options as links', async () => {
      const options = await fixture.identity.signInOptions(browser({}).exchange().req);
      expect(options.length).toBeGreaterThan(0);
      for (const { legacy, ...option } of options) {
        expect(option).toEqual({ id: expect.any(String), label: expect.any(String), url: expect.stringMatching(/^\/api\/auth\//) });
        expect(typeof legacy === 'boolean' || legacy === undefined).toBe(true);
      }
    });

    it('lets a grant it made reach the same token later, for its person', async () => {
      const { req, res } = (await visit(1)).exchange();
      const signedIn = (await fixture.identity.signedIn(req, res))!;
      const credential = await fixture.identity.grantCredential(req, res, signedIn, fixture.site);
      const grant = { kind: 'agent', ownerId: signedIn.owner, ...(credential ? { credential } : {}), person: signedIn.person };
      expect(await fixture.identity.grantToken(grant, signedIn.person, fixture.site)).toBe(fixture.tokenOf(1));
    });

    it('resolves outside bearers exactly when its fixture can make one', () => {
      expect(typeof fixture.identity.bearerGrant).toBe(fixture.bearerOf ? 'function' : 'undefined');
    });

    it("resolves a person's bearer to that person and their owner on the site, and tells two people apart", async ({ skip }) => {
      if (!fixture.bearerOf) return skip();
      const resolved = [];
      for (const n of [1, 2]) {
        const { req, res } = (await visit(n)).exchange();
        const signedIn = (await fixture.identity.signedIn(req, res))!;
        // The bearer alone names the person: the request that carries it has no sign-in.
        const grant = await fixture.identity.bearerGrant!(browser({}).exchange().req, await fixture.bearerOf(n));
        expect(grant).toMatchObject({ person: signedIn.person, owner: signedIn.owner, write: expect.any(Boolean), site: siteIdentity(fixture.site) });
        expect(bearerGrantRecord(grant!)).not.toBeNull();
        resolved.push(grant!);
      }
      expect(resolved[1].person).not.toEqual(resolved[0].person);
      expect(resolved[1].owner).not.toEqual(resolved[0].owner);
    });

    it('resolves no grant for a bearer it did not expect, and none from a sign-in beside it', async ({ skip }) => {
      if (!fixture.bearerOf) return skip();
      // A throw refuses like null does; `/mcp` answers 401 to both.
      const refused = (req: Request, bearer: string) => fixture.identity.bearerGrant!(req, bearer).catch(() => null);
      const bearer = await fixture.bearerOf(1);
      for (const unexpected of ['', 'not-a-bearer', bearer.slice(0, -1), `${bearer}x`]) {
        expect(await refused(browser({}).exchange().req, unexpected)).toBeNull();
        expect(await refused((await visit(1)).exchange().req, unexpected)).toBeNull();
      }
      // Another person's sign-in beside the bearer changes nothing: the bearer alone names who acts.
      const { req, res } = (await visit(1)).exchange();
      const first = (await fixture.identity.signedIn(req, res))!;
      const beside = await fixture.identity.bearerGrant!((await visit(2)).exchange().req, bearer);
      expect(beside).toMatchObject({ person: first.person, owner: first.owner });
    });

    it("gives a bearer's grant its person's token at call time", async ({ skip }) => {
      if (!fixture.bearerOf) return skip();
      for (const n of [1, 2]) {
        const grant = (await fixture.identity.bearerGrant!(browser({}).exchange().req, await fixture.bearerOf(n)))!;
        expect(await fixture.identity.grantToken(bearerGrantRecord(grant)!, grant.person, fixture.site)).toBe(fixture.tokenOf(n));
      }
    });

    it('explains, for a site, why a provider repository cannot open without a credential', () => {
      expect(fixture.identity.noCredentialMessage(fixture.site)).toEqual(expect.any(String));
    });

    it('signs the person out of the request that asked', async () => {
      const visitor = await visit(1);
      const { req, res } = visitor.exchange();
      await fixture.identity.signOut(req, res);
      const after = visitor.exchange();
      expect(await fixture.identity.signedIn(after.req, after.res)).toBeNull();
      const other = (await visit(2)).exchange();
      expect(await fixture.identity.signedIn(other.req, other.res)).not.toBeNull();
    });
  });
}
