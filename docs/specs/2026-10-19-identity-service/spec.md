# Identity service

An edition can sign people in without a provider token. The server asks one seam, `AppServices.identity`, wherever it used to read a GitHub or GitLab session. The default, `providerIdentity`, is today's sign-in and answers every route as before.

## Decisions

- **C1. A replaceable identity service.** `AppServices.identity` owns sign-in, who is signed in, the provider token for a site, a grant's token and sign-out. Left out, it is `providerIdentity`. Reason: an edition cannot add another sign-in while the provider's routes are mounted with no seam.
- **C2. Signed in means a person, not a token.** Writes, the members list and grants follow `identity.signedIn`; each repository still checks its own access (`canWrite`). The request is also signed in when it holds a token (a request a test or an edition authenticates by token alone). Reason: an account with only hosted repositories is signed in without any provider token.
- **C3. The session probe** (`/api/auth/session`) adds `signInOptions` (every way to sign in) and `platformAccess` (whether the person has a credential on the workspace's site), and keeps `provider` and `loginUrl` for a web bundle cached across a deploy: the option marked `legacy`, else the first.
- **C6. Token-free grants.** `/mcp` asks the identity service for the grant's token at each call and accepts none stored on the request. A new grant records what the identity says: its person, its owner, and a credential only when the identity gives one.
- **C7. Sign-in state carries extra data.** `PendingSignIn.data` passes through the OAuth round trip (`BrowserSessions.beginSignIn` to `finishSignIn`, stored and cookie modes), so a link flow returns knowing its intent and account.
- **C8. Outside bearers.** An identity may accept a bearer on `/mcp` that this server did not issue, such as an OIDC access token another service obtained on a person's behalf, and say who it acts for (`bearerGrant`). The identity does all the verification; the server only decides which bearers it is asked about and what the answer may reach. The call uses the credential `grantToken` gives, never the bearer. Reason: a service that already holds a person's verified identity can call `/mcp` as that person without a stored grant per person. The default identity has no `bearerGrant`, so it answers such a bearer 401 as before.
- **C9. Commit author.** An identity may say whom a person's commits are authored by (`SignedIn.author`, `BearerGrant.author`). Reason: where `token` and `grantToken` give every person one credential the deployment shares, the provider would record that credential's account as the author of every commit. The default identity names no author, so its requests to a provider are what they were. See [Commit author](#commit-author).

## Contract

`IdentityService` (`apps/local-server/src/identity.ts`):

| Member | Meaning |
| --- | --- |
| `router` | Sign-in, callbacks and any edition auth routes, mounted at `/api/auth` ahead of `/session`, `/logout` and the grant routes. |
| `signedIn(req, res)` | `{ person, login, owner, author? }` of the request, or `null`. `owner` keys the person's grant index. `author` (`{ name, email }`) is whom the person's commits are authored by; see [Commit author](#commit-author). |
| `token(req, res, site, refreshWithinMs?)` | The person's provider token on `site`, refreshed when near expiry; `undefined` when they have none. Throws `CredentialRejected` only where the identity treats a rejected credential as signed out. |
| `grantCredential(req, res, signedIn, site)` | What a new grant records beside its person and owner. |
| `grantToken(grant, person, site)` | A grant's provider token at call time; `undefined` is not an error. |
| `bearerGrant?(req, bearer)` | Optional. `{ person, owner, author?, write, site }` for an outside bearer the identity verified, or `null` to refuse it. See [Outside bearers](#outside-bearers). |
| `noCredentialMessage(site)` | Why a provider repository cannot open for a person with no credential on `site`. |
| `signInOptions(req)` | Every way to sign in: `{ id, label, url, legacy? }`; `legacy` marks the option the probe's `provider` and `loginUrl` name. |
| `configured(req)` | Whether sign-in is configured (`configured` in the probe). |
| `signOut(req, res)` | Ends the request's sign-in. |

`@mygitnotes/local-server` also exports `providerIdentity`, `SignedIn`, `SignInOption`, `BearerGrant`, `bearerGrantRecord`, `credentialToken`, `CredentialRejected`, `credentialIdFor(site, userId)` (the id of the credential record a GitHub grant points at) and `githubOAuth(site)` (`authorizeUrl`, `exchange`, `user`) for an edition that reuses GitHub's OAuth.

`@mygitnotes/local-server/testing/identity-contract` is what every identity keeps: signed out has no person; signed in has a person, login and owner, and two people differ; `token` per site; `grantToken` for a grant it made; sign-out clears. `providerIdentity` runs it in `tests/identity.test.ts`. An identity with `bearerGrant` adds `bearerOf(n)` to its fixture (an outside bearer for the n-th person, made the way the identity expects, such as a token signed by a test key), and the kit then also checks that the bearer resolves to the same person and owner as that person's sign-in on the fixture's site, that two people differ, that a bearer it did not expect resolves to nothing, with or without a sign-in beside it, and that `grantToken` gives the bearer's grant the person's token. A fixture with `bearerOf` and an identity without `bearerGrant`, or the reverse, fails.

## Outside bearers

`/mcp` reads its bearer from the `/mcp/<token>` URL or the `Authorization: Bearer` header.

- A bearer shaped like a stored grant (43 characters of `A-Z a-z 0-9 _ -`) is looked up in the record store and is never shown to `bearerGrant`, found or not. A deployment's stored grants keep working beside outside bearers.
- Any other bearer in the `Authorization` header goes to `identity.bearerGrant(req, bearer)` when the identity has one. An outside bearer in the URL is not read, since URLs reach access logs.
- `null` or a throw answers the same 401 as a missing grant, with no detail. The log line is `[mcp] unauthorized: bearer-refused`, or `bearer-error (<error class name>)` for a throw. The error's message is not logged, because it may quote the bearer; an identity that wants a reason in the logs writes it itself, without the token.
- The answer is checked (`bearerGrantRecord`): a `person` with a `realm` and `userId`, an `owner`, a `site` string, a boolean `write`, and, when given, an `author` with a `name` and `email`. Anything else is refused (`bearer-invalid`), so a loosely typed identity cannot widen a grant.
- `site` is compared with the deployment's `siteIdentity`, as a stored grant's is (`grant-site`).
- `write: false` lists no write tool and refuses every write call, as a read-only grant does.
- The call then runs as a stored grant's does. `grantToken(record, person, site)` supplies the credential, where `record` is `{ kind: 'agent', ownerId, person, site, write, author? }` with no `credential`. The configuration source gets `WorkspaceRequest.person`. The `Authorization` header and the cookie are removed from the request's headers before the configuration source, the edition's sources and the asset storage see it.
- The bearer is never stored, never used as a record id (no rejection is remembered for it), never sent to a provider and never logged.
- `author` is carried on the record, and the commits the call makes are authored by it. See [Commit author](#commit-author).

What makes a bearer trustworthy is the identity's to check: signature, issuer, audience, expiry, the calling client, and whether a person was present. The server checks none of it.

## Commit author

A commit made through a provider is authored by the account of the token that made it. An identity that gives every person the same token names the author itself:

- **Web requests.** `signedIn` answers `author: { name, email }`, and every commit the request makes on the site's provider carries it: saves, batch commits, file and folder moves, agent documents, Study, the workspace manifest.
- **`/mcp` calls.** The author is the grant's: the `author` of an outside bearer's `BearerGrant`, or the `author` a stored grant record holds. `POST /api/auth/agent-token` records none, so a stored grant has one only when an edition wrote it there.
- **Reaching the provider.** `openWorkspace(settings, token, cache, { author })` hands it to `createRemoteSource(source, token, request, cache, scope, author)`, and `RemoteSource` passes it to `publishChanges`. GitLab gets `author_name` and `author_email` on `POST /repository/commits` and keeps the token's account as the committer. GitHub gets `author: { name, email }` on `POST /git/commits`; it dates the author now, and with no `committer` in the request it records the author as the committer too, so on GitHub only the push names the token's account.
- **No author.** Without one, or with an empty name or email, the request to the provider has no author field and is byte for byte what it was. `providerIdentity` names none.
- **Unusable text.** A name or email with a line break, `<`, `>` or a control character is refused when a commit is made (`400`, "The commit author's name or email cannot be written into a commit."), before any provider request. Nothing is cleaned up, so a commit never names someone other than whom the identity wrote. Reads are not refused. The identity is the one to give a usable name.
- **Edition repositories.** `EditionSources.open` is not given the author; an edition's own source decides what its commits record.
- **Co-authors.** `RemoteSource.commitChanges(changes, expected, operation, scope, requestedMessage, knownSnapshot, coAuthors)` names `coAuthors` (`{ name, email }[]`) in `Co-authored-by: Name <email>` trailers at the end of the message, after the trailers it already ends with (`Agent-Edit`, `Note-Modified`) and in the same block. A person is named once, by email whatever its case; the commit's author and anyone the message already names are left out; an entry with unusable text refuses the commit. No route passes co-authors yet.

## Default equivalence

A person is present exactly when the provider session is (the session reader already treats an expired token that cannot refresh as none), so writes, the members list, grants, `/mcp` and the session probe answer as before. The probe only gains `signInOptions` and `platformAccess`.

## Web

`AuthControls` and the sign-in screen render one button per `signInOptions` entry (GitHub and GitLab icons and wording kept, a generic icon and `Sign in with {provider}` otherwise); a server without `signInOptions` is read from `provider`. `WebFeature.signInNotice` is shown below the buttons of the sign-in and connection screens. `WebFeature.signInIntro` (a function called while the screen renders, so it may use hooks; the last feature that sets it wins) words the setup screens in place of the community's: the left panel's `tagline`, `description` and `points` (an icon and a text each), and, optionally, the sign-in card's `signInDescription` and the note under its buttons, `privacy`. Any part left out keeps the community's own words, and the same left panel shows on the repository-choice, first-repository and demo notice screens.

## Verification

Outside bearers: `tests/mcp-bearer-grant.test.ts` covers each rule above against an identity with `bearerGrant`, and `tests/identity.test.ts` runs the contract against one.

Commit author: `packages/core/tests/commit-author.test.ts` covers the provider requests with and without an author, the refused text and the co-author trailers; `tests/commit-author-http.test.ts` covers a web save, a batch commit and `/mcp` writes by an outside bearer and by a stored grant, all pushed with one credential.

Every existing local-server and web suite passes unchanged. New: the identity contract against `providerIdentity`; an identity with a person and no token gets 200 on the members list, answers `platformAccess: false`, and keeps a grant without a credential; the sign-in options and notice in `lib/web-features.test.tsx`.
