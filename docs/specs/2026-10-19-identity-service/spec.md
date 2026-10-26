# Identity service

An edition can sign people in without a provider token. The server asks one seam, `AppServices.identity`, wherever it used to read a GitHub or GitLab session. The default, `providerIdentity`, is today's sign-in and answers every route as before.

## Decisions

- **C1. A replaceable identity service.** `AppServices.identity` owns sign-in, who is signed in, the provider token for a site, a grant's token and sign-out. Left out, it is `providerIdentity`. Reason: an edition cannot add another sign-in while the provider's routes are mounted with no seam.
- **C2. Signed in means a person, not a token.** Writes, the members list and grants follow `identity.signedIn`; each repository still checks its own access (`canWrite`). The request is also signed in when it holds a token (a request a test or an edition authenticates by token alone). Reason: an account with only hosted repositories is signed in without any provider token.
- **C3. The session probe** (`/api/auth/session`) adds `signInOptions` (every way to sign in) and `platformAccess` (whether the person has a credential on the workspace's site), and keeps `provider` and `loginUrl` for a web bundle cached across a deploy: the option marked `legacy`, else the first.
- **C6. Token-free grants.** `/mcp` asks the identity service for the grant's token at each call and accepts none stored on the request. A new grant records what the identity says: its person, its owner, and a credential only when the identity gives one.
- **C7. Sign-in state carries extra data.** `PendingSignIn.data` passes through the OAuth round trip (`BrowserSessions.beginSignIn` to `finishSignIn`, stored and cookie modes), so a link flow returns knowing its intent and account.

## Contract

`IdentityService` (`apps/local-server/src/identity.ts`):

| Member | Meaning |
| --- | --- |
| `router` | Sign-in, callbacks and any edition auth routes, mounted at `/api/auth` ahead of `/session`, `/logout` and the grant routes. |
| `signedIn(req, res)` | `{ person, login, owner }` of the request, or `null`. `owner` keys the person's grant index. |
| `token(req, res, site, refreshWithinMs?)` | The person's provider token on `site`, refreshed when near expiry; `undefined` when they have none. Throws `CredentialRejected` only where the identity treats a rejected credential as signed out. |
| `grantCredential(req, res, signedIn, site)` | What a new grant records beside its person and owner. |
| `grantToken(grant, person, site)` | A grant's provider token at call time; `undefined` is not an error. |
| `noCredentialMessage(site)` | Why a provider repository cannot open for a person with no credential on `site`. |
| `signInOptions(req)` | Every way to sign in: `{ id, label, url, legacy? }`; `legacy` marks the option the probe's `provider` and `loginUrl` name. |
| `configured(req)` | Whether sign-in is configured (`configured` in the probe). |
| `signOut(req, res)` | Ends the request's sign-in. |

`@mygitnotes/local-server` also exports `providerIdentity`, `SignedIn`, `SignInOption`, `credentialToken`, `CredentialRejected`, `credentialIdFor(site, userId)` (the id of the credential record a GitHub grant points at) and `githubOAuth(site)` (`authorizeUrl`, `exchange`, `user`) for an edition that reuses GitHub's OAuth.

`@mygitnotes/local-server/testing/identity-contract` is what every identity keeps: signed out has no person; signed in has a person, login and owner, and two people differ; `token` per site; `grantToken` for a grant it made; sign-out clears. `providerIdentity` runs it in `tests/identity.test.ts`.

## Default equivalence

A person is present exactly when the provider session is (the session reader already treats an expired token that cannot refresh as none), so writes, the members list, grants, `/mcp` and the session probe answer as before. The probe only gains `signInOptions` and `platformAccess`.

## Web

`AuthControls` and the sign-in screen render one button per `signInOptions` entry (GitHub and GitLab icons and wording kept, a generic icon and `Sign in with {provider}` otherwise); a server without `signInOptions` is read from `provider`. `WebFeature.signInNotice` is shown below the buttons of the sign-in and connection screens.

## Verification

Every existing local-server and web suite passes unchanged. New: the identity contract against `providerIdentity`; an identity with a person and no token gets 200 on the members list, answers `platformAccess: false`, and keeps a grant without a credential; the sign-in options and notice in `lib/web-features.test.tsx`.
