# Deploy MyGitNotes

[English](deploy.md) · [繁體中文](deploy.zh-TW.md)

Run MyGitNotes locally first with the [quick start](../README.md#quick-start), then choose the deployment path that matches your hosting setup.

## Vercel through GitHub Actions sparse checkout (default)

### Vercel preparation

**Accounts and services**

- A Vercel project, GitHub repository containing the core and main branches, and an Upstash Redis database.
- For GitHub sign-in, prepare a GitHub OAuth App and set the OAuth callback to `https://<your-project>.vercel.app/api/auth/github/callback`.
- For GitLab sign-in, prepare the GitLab OAuth App described in [GitLab source overlay](#gitlab-source-overlay). For GitHub Enterprise, register the app on that site as described in [GitHub Enterprise source overlay](#github-enterprise-source-overlay).

**Values to generate**

- Generate `SESSION_SECRET` before the first phase with `openssl rand -hex 32`.
- Create `VERCEL_TOKEN` in Vercel Account Settings → Tokens before the first phase, scoped to the team that owns this project; save its value.

**Tools to install**

- Install the Vercel and GitHub CLIs.

### Set runtime values

1. Authenticate the Vercel CLI: `vercel login`
2. Authenticate the GitHub CLI: `gh auth login`
3. Link the Vercel project from the Core checkout: `vercel link`. Read orgId and projectId from the resulting .vercel/project.json for the [GitHub Actions configuration phase](#connect-github-actions).
4. Copy the environment template: `cp .env.example .env`
5. Fill .env with the runtime fields below. Use the workspace repository and main branch, the callback URL and `SESSION_SECRET` from [Vercel preparation](#vercel-preparation), and the Redis REST URL and token from Upstash.
6. Import those values into Vercel production: `pnpm env:vercel production`

~~~bash
MYGITNOTES_SOURCE=github
MYGITNOTES_REPOSITORY=owner/workspace-repo
MYGITNOTES_BRANCH=main
APP_URL=https://<your-project>.vercel.app
GITHUB_CLIENT_ID=your_oauth_client_id
GITHUB_CLIENT_SECRET=your_oauth_client_secret
GITHUB_APP_TYPE=oauth-app
SESSION_SECRET=<output of openssl rand -hex 32>
UPSTASH_REDIS_REST_URL=https://...upstash.io
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_token
~~~

### Connect GitHub Actions

1. In Vercel, open **Settings → Git** and disconnect the Git integration so it does not start a second, full-repository deployment.
2. Set the default GitHub repository for gh to the repository that contains this workflow; replace OWNER/WORKSPACE_REPO with its owner and name: `gh repo set-default OWNER/WORKSPACE_REPO`
3. Store the token prepared above as a GitHub Actions secret: `gh secret set VERCEL_TOKEN` (paste it when prompted)
4. Replace ORG_ID with orgId from the [linking step](#set-runtime-values) and add it as a GitHub Actions variable: `gh variable set VERCEL_ORG_ID --body ORG_ID`
5. Replace PROJECT_ID with projectId from the [linking step](#set-runtime-values) and add it as a GitHub Actions variable: `gh variable set VERCEL_PROJECT_ID --body PROJECT_ID`

### Deploy and verify

1. Run the production workflow from core: `gh workflow run deploy-vercel-sparse.yml --ref core`
2. Wait with `gh run watch`; then confirm the deployment is Ready in `vercel ls --prod` and the domain serves the Notes view.

The workflow deploys product paths from core; note-only changes on main do not trigger a build. The app reads workspace content from main at runtime. The workflow deploys from core by default; set the `MYGITNOTES_DEPLOY_BRANCH` repository variable only for another deploy branch. Set `MYGITNOTES_SESSION_NAMESPACE` only when deployments share one Redis database; use a unique value per deployment.

### Alternative: Vercel through Git integration (opt out of Actions deployment)

**Accounts and services**

- Complete the [runtime values phase](#set-runtime-values), including CLI authentication, Vercel project linking, GitHub OAuth App, Upstash Redis, and runtime fields.
- Keep the Vercel Git integration connected and set the Vercel production branch to core.

**Values to generate**

- Skip the `VERCEL_TOKEN` preparation described in [Vercel preparation](#vercel-preparation).

**Tools to install**

- Use the Vercel and GitHub CLIs from the default Vercel path.

1. In GitHub, set the workflow opt-out variable: `gh variable set MYGITNOTES_VERCEL_DEPLOY --body git-integration`
2. Let Vercel build with the pnpm that package.json names (12) through corepack; from the lockfile alone it picks pnpm 9 or 10: `vercel env add ENABLE_EXPERIMENTAL_COREPACK production --value 1`
3. In Vercel **Settings → Git**, confirm the production branch is core; vercel.json enables deployments from core.
4. In Vercel **Deployments**, confirm the latest core deployment is Ready and the domain serves the Notes view.

This path clones the full repository on Vercel. It does not need `VERCEL_TOKEN`, `VERCEL_ORG_ID`, or `VERCEL_PROJECT_ID`.

## Lightweight Vercel deployment (no Redis, visitors choose their repository)

This path needs no Redis and no fixed note repository.
Each visitor signs in with GitHub, picks one of their own repositories, and works in it.
The sign-in, including the GitHub token, and the chosen repository are sealed with `SESSION_SECRET` in HttpOnly cookies, so the server stores nothing.
A repository without a MyGitNotes manifest opens with its top-level folders as notebooks, and a notice offers to commit the manifest.

The trade-offs follow from keeping nothing on the server: there are no MCP connector grants, no GitLab sign-in, and no Core update panel, and signing in again is needed after the GitHub App's refresh token expires (six months) or after a failed refresh.

### Lightweight preparation

**Accounts and services**

- A Vercel project, as in [Vercel preparation](#vercel-preparation); no Upstash Redis.
- A GitHub App (**Settings → Developer settings → GitHub Apps → New GitHub App**):
  - Homepage URL: `APP_URL`; Callback URL: `APP_URL`/api/auth/github/callback.
  - Keep **Expire user authorization tokens** on, and turn on **Request user authorization (OAuth) during installation**.
  - Turn off **Webhook**.
  - Repository permissions: **Contents** read and write, **Metadata** read-only.
  - Choose **Any account** so visitors can install it on their own repositories.
  - Generate a client secret, and note the client ID and the app's URL name (the slug in `https://github.com/apps/<slug>`).

**Values to generate**

- Generate `SESSION_SECRET` with `openssl rand -hex 32`.
  Rotating it signs every visitor out and forgets their repository choice.

### Lightweight runtime values

Fill .env with these fields and import them with `pnpm env:vercel production`; leave `MYGITNOTES_REPOSITORY`, `MYGITNOTES_BRANCH` and every Redis variable unset.

```dotenv
APP_URL=https://<your-project>.vercel.app
MYGITNOTES_SOURCE=github
GITHUB_APP_TYPE=github-app
GITHUB_APP_SLUG=<the GitHub App's URL name>
GITHUB_CLIENT_ID=<the GitHub App's client ID>
GITHUB_CLIENT_SECRET=<the GitHub App's client secret>
SESSION_SECRET=<output of openssl rand -hex 32>
```

Deploy as in [Connect GitHub Actions](#connect-github-actions) and [Deploy and verify](#deploy-and-verify), then open the domain: it shows the sign-in screen, and after sign-in the repository picker.

A visitor without a notes repository chooses **Create a new notes repository** in the picker: GitHub's new-repository page opens prefilled with the starter template, and once they create it and grant it to the app, the picker selects it.
The template defaults to the public [`MyGitNotes/mygitnotes-starter`](https://github.com/MyGitNotes/mygitnotes-starter); set `MYGITNOTES_STARTER_TEMPLATE=<owner>/<name>` to offer your own template repository instead.

Any deployment can use these cookie sessions with `MYGITNOTES_STORAGE=cookie`; Vercel uses them automatically when no Redis is configured.
A deployment that sets `MYGITNOTES_REPOSITORY` keeps serving that one repository, with or without Redis.

## Docker Compose with a remote repository

### Docker Compose preparation

**Accounts and services**

- Docker with Compose, a public URL or http://localhost:4321, and Compose's private Redis network. No Redis account is needed.
- For GitHub sign-in, prepare a GitHub OAuth App: set its Homepage URL to `APP_URL` and callback to `APP_URL`/api/auth/github/callback.
- For GitLab sign-in, use the [GitLab source overlay](#gitlab-source-overlay).

**Values to generate**

- Generate `SESSION_SECRET` before the [Docker Compose deployment](#docker-compose-with-a-remote-repository) with `openssl rand -hex 32`.

**Tools to install**

- Install Docker with Compose.

1. Copy the environment template: `cp docker.env.example .env.docker`
2. In .env.docker, set `MYGITNOTES_SOURCE=github`, `MYGITNOTES_REPOSITORY=owner/repo`, `MYGITNOTES_BRANCH=main`, `APP_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `GITHUB_APP_TYPE=oauth-app`.
3. Fill `SESSION_SECRET` with the value generated in [Docker Compose preparation](#docker-compose-preparation).
4. Check the resolved Compose configuration: `docker compose -f compose.yaml config --quiet`
5. Build and start MyGitNotes and Redis: `docker compose -f compose.yaml up -d --build`
6. Open `APP_URL`; the Notes view loads and GitHub sign-in opens the OAuth App configured in the environment configuration step.

Compose publishes the app on 127.0.0.1:4321 by default and stores Redis data in the redis-data volume. Set `MYGITNOTES_PORT` to change the browser-facing port; use the same URL in `APP_URL`.

After updating the product checkout, rebuild with `docker compose up -d --build`. `docker compose down` preserves the Redis volume; `docker compose down -v` deletes it and invalidates stored sessions and MCP grants.

## Plain Docker with a remote repository

### Plain Docker preparation

**Accounts and services**

- Docker, `APP_URL` as http://localhost:4321 or a public HTTPS origin, and a persistent Docker volume for encrypted sessions and MCP grants.
- For GitHub sign-in, set the OAuth App Homepage URL to `APP_URL` and callback to `APP_URL`/api/auth/github/callback.
- For GitLab sign-in, use the [GitLab source overlay](#gitlab-source-overlay).

**Values to generate**

- Generate `SESSION_SECRET` before the [plain Docker deployment](#plain-docker-with-a-remote-repository) with `openssl rand -hex 32`.

**Tools to install**

- Install Docker.

1. Copy the environment template: `cp docker.env.example .env.docker`
2. In .env.docker, set `MYGITNOTES_SOURCE=github`, `MYGITNOTES_REPOSITORY=owner/repo`, `MYGITNOTES_BRANCH=main`, `APP_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `GITHUB_APP_TYPE=oauth-app`; set `REDIS_URL` here only when using your own Redis.
3. Fill `SESSION_SECRET` with the value generated in [Plain Docker preparation](#plain-docker-preparation).
4. Build the image: `docker build -t mygitnotes:local .`
5. Create persistent session storage: `docker volume create mygitnotes-sessions`
6. Start the container:
   `docker run -d --name mygitnotes --init --restart unless-stopped -p 127.0.0.1:4321:4321 --env-file .env.docker --mount type=volume,source=mygitnotes-sessions,target=/app/.github-notes-sessions mygitnotes:local`
7. Open `APP_URL`; the Notes view loads and GitHub sign-in opens the OAuth App configured in the environment configuration step.

The volume created by the [persistent session storage step](#plain-docker-with-a-remote-repository) preserves sessions, provider credentials, and MCP grants across container replacements. When `REDIS_URL` is set in the environment configuration, native Redis takes precedence over Redis REST.

## Public access behind a reverse proxy

This subsection applies to [Docker Compose](#docker-compose-with-a-remote-repository) and [plain Docker](#plain-docker-with-a-remote-repository). Set `APP_URL` to the HTTPS origin and route the reverse proxy to 127.0.0.1:4321. Preserve the public Host header, forward /api/*, /mcp/*, /raw-assets/*, and /r2-assets/*, and allow streamed MCP responses. A proxy in another container must share the app network and forward to mygitnotes:4321. With the built-in live editor on, the proxy also passes WebSocket upgrades on /live/socket ([WebSockets through the reverse proxy](#websockets-through-the-reverse-proxy)), and behind Cloudflare it passes on the client address ([Caddy behind Cloudflare](#caddy-behind-cloudflare)).

## Local checkout inside a container

### Local checkout preparation

**Accounts and services**

- An existing workspace checkout on main with .mygitnotes.yaml and your notes. On Linux, give UID/GID 1000:1000 read/write access to the checkout.

**Values to generate**

- None.

**Tools to install**

- Docker and Git.

1. Set `WORKSPACE_PATH` to the absolute workspace path: `export WORKSPACE_PATH=/absolute/path/to/workspace`
2. Set the workspace commit author: `git -C "$WORKSPACE_PATH" config user.name "Your Name"`
3. Set the workspace commit email: `git -C "$WORKSPACE_PATH" config user.email you@example.com`
4. Check the bind mount and Compose settings: `docker compose -f compose.local.yaml config --quiet`
5. Build and start the container: `docker compose -f compose.local.yaml up -d --build`
6. Open http://localhost:4321; the mounted workspace appears in the Notes view.

This mode is an anonymous desktop workflow restricted to loopback hosts. Local edits and Screen / Study YAML files persist in the mounted checkout. Configure remote Git credentials there to commit and sync.

## GitLab source overlay

This subsection applies on top of [Vercel through GitHub Actions sparse checkout](#vercel-through-github-actions-sparse-checkout-default), [Docker Compose](#docker-compose-with-a-remote-repository), or [plain Docker](#plain-docker-with-a-remote-repository).

### GitLab preparation

**Accounts and services**

- Create a GitLab OAuth application on the selected GitLab site with the api scope and callback `APP_URL`/api/auth/gitlab/callback.
- For self-managed GitLab, use its HTTPS base URL, including an installation subpath, and ensure the deployment can reach and trust it.
- Keep `APP_URL`, `SESSION_SECRET`, and session storage from the selected base path.

**Values to generate**

- None beyond the selected base path.

**Tools to install**

- Use the tools from the selected base path.

1. In .env.docker for Docker, or .env for Vercel, set `MYGITNOTES_SOURCE=gitlab`, `MYGITNOTES_REPOSITORY=group/subgroup/project`, `MYGITNOTES_BRANCH=main`, `MYGITNOTES_GITLAB_URL=https://gitlab.com`, `GITLAB_CLIENT_ID`, and `GITLAB_CLIENT_SECRET`.
2. For Vercel, import the updated .env fields with `pnpm env:vercel production`; Docker uses the .env.docker from the source configuration step.
3. For Compose, continue at the build and start step; for plain Docker, continue at the image build and container start steps; for Vercel, run `gh workflow run deploy-vercel-sparse.yml --ref core`.
4. Open `APP_URL`; GitLab sign-in opens the OAuth application from the preparation phase and the Notes view loads.

Keep the GitHub deployment settings from [Vercel through GitHub Actions sparse checkout](#vercel-through-github-actions-sparse-checkout-default) when using Actions; replace only the note-source and OAuth provider fields. GitLab writes require push access to main; public repositories support anonymous reads.

## GitHub Enterprise source overlay

This subsection applies on top of [Vercel through GitHub Actions sparse checkout](#vercel-through-github-actions-sparse-checkout-default), [Docker Compose](#docker-compose-with-a-remote-repository), or [plain Docker](#plain-docker-with-a-remote-repository). It keeps the notes in a repository on GitHub Enterprise Server (GHES) or GitHub Enterprise Cloud with data residency (GHE.com) instead of github.com.

### GitHub Enterprise preparation

**Accounts and services**

- Register a GitHub OAuth App or GitHub App on the same Enterprise site, with callback `APP_URL`/api/auth/github/callback. Personal access token sign-in is not supported.
- Ensure the deployment can reach and trust the site over HTTPS. The site's API must be reachable too: `https://<site>/api/v3` on GHES, `https://api.<host>` on GHE.com.
- Keep `APP_URL`, `SESSION_SECRET`, and session storage from the selected base path.

**Values to generate**

- None beyond the selected base path.

**Tools to install**

- Use the tools from the selected base path.

1. In .env.docker for Docker, or .env for Vercel, set `MYGITNOTES_SOURCE=github`, `MYGITNOTES_REPOSITORY=team/notes`, `MYGITNOTES_BRANCH=main`, `MYGITNOTES_GITHUB_URL=https://ghe.example.com` (`https://octocorp.ghe.com` on GHE.com; an installation subpath is accepted), and the `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` of the app registered on that site. `GITHUB_NOTES_GITHUB_URL` is read too. The setting is ignored unless `MYGITNOTES_SOURCE=github`; with it empty or `https://github.com`, nothing changes from a github.com deployment.
2. For Vercel, import the updated .env fields with `pnpm env:vercel production`; Docker uses the .env.docker from the source configuration step.
3. For Compose, continue at the build and start step; for plain Docker, continue at the image build and container start steps; for Vercel, run `gh workflow run deploy-vercel-sparse.yml --ref core`.
4. Open `APP_URL`; sign-in opens the Enterprise site and the Notes view loads.

What follows the site: repository reads and writes, sign-in, the repository picker when `MYGITNOTES_REPOSITORY` is empty, the GitHub App installation link (`<site>/github-apps/<slug>/installations/new`), and Gist publishing (a note's **Open the Gist** link asks the site's Gist API for the Gist's address and opens it there). Every repository of a workspace is on the deployment's site; one on another site is unavailable, since that site's sign-in does not reach it.

Earlier versions ignored `url` on a `github` source. A manifest or server YAML that carries one now names that site, so remove a leftover `url` (for example a repository's web address) from a github.com source, and do not leave it empty.

Differences from github.com:

- **Create from template**: github.com offers the starter template. An Enterprise site offers the create link only when `MYGITNOTES_STARTER_TEMPLATE` names a template on that site; otherwise people pick an existing repository.
- **Core updates** keep following github.com and are not offered for a product repository on an Enterprise site, so the site's token is never sent to github.com.
- **Archive downloads** accept a redirect only to the site's own codeload (`https://codeload.<host>/…`, or `https://<host>/codeload/…` without subdomain isolation), over HTTPS on the port the site's URL names (none for the default).
- The Pro service stays github.com only.

## Core updates

Settings checks the repository's Core revision and the running build separately. Local updates require a clean product checkout on `core`; the workspace branch does not control this operation. After updating, run `pnpm migrate-workspace` with the updated Core and restart the server.

A hosted deployment offers Core updates only for its product repository, the repository whose `core` branch it deploys. Name it with `MYGITNOTES_PRODUCT_REPOSITORY` (`owner/name`) or `product_repository: owner/name` in `mygitnotes.server.yaml`; it is on the deployment's GitHub site (`MYGITNOTES_GITHUB_URL`, github.com when unset). A fork-model deployment, whose notes repository also carries `core`, names that same repository; `pnpm bootstrap-workspace` writes it to the Core checkout's .env from a GitHub `origin`, keeping a value already there, and `pnpm env:vercel` imports it. Without one, Settings shows no Core update and the update routes answer 404 without asking the provider.

For GitHub workspaces, use **Install Core sync** when Settings reports a missing workflow, then **Update Core**. Bootstrap also installs the [canonical workflow](../packages/core/assets/mygitnotes-core-sync.yml) as `.github/workflows/mygitnotes-core-sync.yml` on `main`; repositories with another default branch install it there through Settings. The workflow fetches MyGitNotes upstream and pushes a fast-forward of `core`. Settings follows the correlated run and verifies the resulting revision before reporting success. Existing workflow files are preserved.

GitHub OAuth requests `repo workflow gist`; `gist` lets a note's Info tab publish its body as a secret Gist. Older grants show **Re-authorize GitHub**, and publishing from them asks the user to sign in again. The app encrypts the user's grant and stores it as the repository Actions secret `MYGITNOTES_CORE_SYNC_TOKEN`, which the runner uses for its push. People who can modify that repository's workflows can use this stored credential through a workflow. The user-token push raises configured deployment events; deployment completion is separate from Core sync completion.

GitHub App installations configure **Contents**, **Workflows**, **Actions**, and **Secrets** write permissions in the App settings; App sign-in does not request OAuth scopes. GitLab Core updates are not supported yet, and GitLab sign-in retains its existing `api` scope.

## Update and migrate

Run `pnpm update-core` from a clean `core` checkout to fast-forward the product branch from `upstream/core` (or `origin/core` when no `upstream` remote exists) and migrate its configured workspace; then run `pnpm install && pnpm dev` to restart with the updated Core. Run `pnpm migrate-workspace` from that checkout to migrate the workspace on its own. If `schema_version` is incompatible, the local server stops and its error names `pnpm migrate-workspace` or, when the workspace requires a newer Core, `pnpm update-core`.

To convert an older workspace whose `main` still contains product files, clean the checkout and run `pnpm convert-workspace` on `main` once. Then create a separate Core worktree with `git worktree add --track -b core ../mygitnotes-core origin/core`, set `MYGITNOTES_LOCAL_PATH` in that worktree's .env to the converted checkout, and start from the Core worktree. `pnpm update-core` runs only on `core`.

### Upgrading a hosted deployment to schema 4

A hosted deployment of this Core keeps reading a schema 3 manifest that declares no notebook with `source`, while an older Core refuses schema 4. Deploy the code first and move the manifest afterwards, in this order:

1. Name the product repository in the deployment's environment before deploying: `MYGITNOTES_PRODUCT_REPOSITORY=owner/name`, or `product_repository` in `mygitnotes.server.yaml` (see [Core updates](#core-updates)). A self-hosted remote deployment must set it to keep Core updates: without it, Settings no longer shows Core updates and the update routes answer 404. On Vercel, set it before the deployment starts, so the deployment carries it.
2. Deploy the new Core and wait until the deployment is live.
3. Check that browsing and committing notes work, that an existing MCP connection still lists its notebooks, and that Settings offers Core updates.
4. Later, in a clean checkout of the notes repository's branch, migrate its manifest from the new Core checkout with `pnpm migrate-workspace --workspace <checkout>`. It commits `chore: migrate the workspace manifest to schema 4`, which only changes `schema_version`; check it with `git -C <checkout> show --stat HEAD`, then push it.

Until that commit is pushed, rolling back needs only the previous code. Once it is pushed, revert it together with the code, because the previous Core refuses schema 4. A manifest that still declares notebooks with `source` makes its repository unavailable on this Core: convert it first, as [Converting `source` notebooks](#converting-source-notebooks) describes.

## Notebooks in other repositories

A workspace can serve notebooks from several repositories. Each repository's own `.mygitnotes.yaml` (`schema_version: 4`) declares the notebooks it holds, with `root` and `assets` relative to that repository, and sets the repository's title, the notebook it opens at and its preferences. The repository the deployment names (`MYGITNOTES_REPOSITORY`, `MYGITNOTES_LOCAL_PATH` or the top-level `source:`) is the default repository, where the workspace opens. A local deployment adds further repositories by mapping them to worktrees in `mygitnotes.server.yaml`, with `path` relative to that file; each is on the branch its worktree has checked out:

```yaml
repositories:
  - type: github
    repository: owner/trpg-notes
    path: ../trpg-notes
```

A hosted deployment lists further repositories the same way, without `path` and with each repository's `branch`. They must be on the deployment's own platform and site; an entry on another one is a configuration error that names the entry. On a hosted deployment any GitHub account can sign in, so the name of every visible member, private ones included, is shown to anyone signed in; a visitor who is not signed in sees only repositories the provider lets them read. Add `hidden: true` to an entry to keep that repository's name from visitors:

```yaml
repositories:
  - type: github
    repository: owner/private-journal
    branch: main
    hidden: true
```

A repository that cannot be reached, or whose manifest does not load, shows as unavailable with the reason; the other repositories work normally, and Settings opens the broken manifest so it can be fixed. Each repository keeps its own Screen, Focus and Study files and Agent files, and a commit that spans repositories creates one commit in each.

### Converting `source` notebooks

Schema 3 let the home manifest declare a notebook of another repository with `source`. Schema 4 removed `source`, and a manifest that still uses it makes its repository unavailable with `Notebook <id> uses source, which schema 4 removed. Run pnpm convert-sources in <repository>.` Convert it once, from the Core checkout whose `mygitnotes.server.yaml` maps each named repository to its worktree:

```sh
pnpm convert-sources            # shows the plan; asks before writing in a terminal
pnpm convert-sources --yes      # applies it without asking
pnpm convert-sources --workspace ../hub --yes   # converts another mapped worktree's manifest
```

For each notebook with `source`, the command adds the notebook, unchanged but for `source`, to the manifest of the repository it names, creating that manifest when the repository has none (titled by the repository's name, opening at the first notebook moved to it, with a copy of the converting manifest's preferences, shown in full before writing); an existing manifest keeps its title, default notebook and preferences. It then removes the notebook from the converting manifest and moves both to `schema_version: 4`. It refuses before writing anything when a named repository has no mapped worktree, when the target already has a different notebook with the same id or an overlapping root, or when a manifest it touches has uncommitted changes. When the notebook the converting manifest opens at moves away, the plan names the old and the new `default_notebook` (its first remaining notebook). Focus and Study entries of a moved notebook found in the converting repository's files are listed and left in place.

Converting the deployment's own source also keeps every repository's alias, the first part of its notebooks' keys in URLs and Focus layouts. Schema 3 derived aliases in the order the manifest's notebooks named repositories with `source`, and this Core derives them in the order of `repositories`, so the command lists the repositories notebooks move to first under `repositories`, in that order, keeping the others after; the plan shows the new order and the resulting aliases.

Each repository's change is one commit. When a commit fails, the command stops and prints the command that commits what it wrote; run `pnpm convert-sources` again afterwards, and notebooks already present, identically, in their repository are skipped. A run that finds such a manifest still uncommitted stops before committing anything else and prints that command again. When every notebook would leave the converting manifest, the command stops unless `--remove-emptied` is given, which deletes that manifest in its commit and removes the repository from `repositories` in `mygitnotes.server.yaml`; it refuses this for the deployment's own source, which another repository must replace first. A manifest without `source` moves to schema 4 with `pnpm migrate-workspace`. A manifest below schema 3 may still hold a Screen file that only a schema 3 Core converts: `convert-sources` refuses it and asks to run `pnpm migrate-workspace` from a Core checkout at `fd0fd42` first.

## Optional: an agent panel through your own Pi bridge

A remote deployment has no agent panel by default. You can run the Pi bridge on a machine you control (your own server or computer, reachable over HTTPS, for example through a tunnel) and let the people you list use it from the deployment's panel. The bridge runs Pi with your provider keys; the deployment only forwards session calls and points the browser at the bridge.

The step-by-step guide for a non-developer is [Use the agent panel with Pi on your own computer](pi-bridge.md). In short, on the machine that runs Pi, install Pi and run `npx mygitnotes-pi-bridge --tunnel`; it prints a pairing code to set on the deployment as `MYGITNOTES_EXTERNAL_PI_PAIRING` (below). A deployment's page must be allowed by the bridge, so add `--origin <your deployment's origin>` to the command.

The bridge is the npm package `mygitnotes-pi-bridge`, built from `apps/pi-bridge` in this repository. To run it from a checkout instead, start `apps/local-server/src/pi-bridge-main.ts` (the entry editions bundle) with these variables; the command above reads the same variables and lets them override its options:

| Variable | Meaning |
| --- | --- |
| `MYGITNOTES_BRIDGE_SECRET` | A long random secret (at least 32 characters) shared with the deployment. The bridge accepts only short-lived tokens signed with it. |
| `MYGITNOTES_BRIDGE_PUBLIC_URL` | The HTTPS address browsers reach the bridge at, for example `https://pi.example.com`. |
| `MYGITNOTES_BRIDGE_CWD` | An empty directory Pi starts in; it holds no notes, which Pi edits through the page. |
| `MYGITNOTES_BRIDGE_ORIGINS` | A JSON array of page origins allowed to open the socket, for example `["https://notes.example.com"]`. |
| `MYGITNOTES_BRIDGE_PORT` | The listening port (default 8080 for `pi-bridge-main`, 8787 for the command). |
| `MYGITNOTES_BRIDGE_PI_ARGS` | Optional JSON array of extra Pi arguments (model, tools). |

Keep `pi-trust-extension.mjs` and `pi-web-tools-extension.mjs` beside the bridge file when you run it from a checkout; the npm package ships them in its bundle. The bridge runs one session, so list one person (or people who share it).

On the deployment, set the pairing code the command printed, or its two parts, with the owners:

| Variable | Meaning |
| --- | --- |
| `MYGITNOTES_EXTERNAL_PI_PAIRING` | The pairing code (`mgnpi1.…`), which carries the bridge's address and the secret. Use it instead of the next two variables; giving it together with either of them is an error. |
| `MYGITNOTES_EXTERNAL_PI_URL` | Where the deployment reaches the bridge, usually the same address as `MYGITNOTES_BRIDGE_PUBLIC_URL`. |
| `MYGITNOTES_EXTERNAL_PI_SECRET` | The same value as `MYGITNOTES_BRIDGE_SECRET`. |
| `MYGITNOTES_EXTERNAL_PI_OWNERS` | Comma-separated sign-in logins allowed to use the agent, or `id:<provider user id>` to survive a rename, for example `octocat,id:12345`. They name people at the deployment's current sign-in provider (the GitHub or GitLab site it signs in with); a session of another provider, or one the main site treats as signed out, never passes. |

Without `MYGITNOTES_EXTERNAL_PI_PAIRING` or `MYGITNOTES_EXTERNAL_PI_URL` nothing changes. Signed-in people who are not listed see no agent. The browser never receives the secret, only a socket token that expires after ten minutes and belongs to one session; rotate the secret on both sides together. The socket token travels in the `Sec-WebSocket-Protocol` header, so proxies in front of the bridge should not log that header.

## Optional: an external live editor

An edition may attach an external live (co-)editor to remote repositories; the community edition ships none. With one, pressing Edit on a Markdown note checks it out to the editor (so does opening the note's address with `?edit` added, such as `<note address>?edit`, for someone who may write it), and the note is checked back into Git every night and whenever someone presses 「立即簽回」. Check-in commits the live text with every editor named (the earliest as author, the others as `Co-authored-by`), merges Git changes made meanwhile, and on a conflict lets the live text win and says so in the commit. A note with CRLF line ends becomes LF at its first check-in, in one commit that rewrites every line end.

| Variable | Meaning |
| --- | --- |
| `MYGITNOTES_LIVE_CHECKIN_AT` | When the nightly check-in runs, `HH:mm` in `MYGITNOTES_TIMEZONE` (default `03:00`; UTC without a time zone). `off` turns the in-process schedule off. A value that is no time stops the server at start. |
| `MYGITNOTES_LIVE_IDLE_CHECKIN` | How long after its last edit a note nobody has open is checked in, `1m` to `60m` (default `5m`), or `off`. Any other value stops the server at start. |
| `MYGITNOTES_LIVE_SWEEP_SECRET` | A random secret of at least 32 characters that enables `POST /api/live/sweep` for an external trigger. Without it the route answers 404. |

**Upgrading an edition with an external editor:** a long-running server now also checks a note in once nobody has had it open for `MYGITNOTES_LIVE_IDLE_CHECKIN` (5 minutes by default), beside the nightly check-in. Set `MYGITNOTES_LIVE_IDLE_CHECKIN=off` to keep only the nightly one. A note it cannot check in (no editor's credential may write, or a pending note its path rule cannot file) is tried again after 1 minute, then 2, 4 and so on up to 30, and its notice is sent once until the note changes.

A long-running server (Docker, Node) sweeps by itself at that time and 10, 20 and 30 minutes later, for notes someone was still editing, and once a minute or two after it starts, which catches up after downtime. Vercel functions do not stay up, so there the schedule does not run: call the sweep route from Vercel Cron, a Nomad periodic job or cron. The route answers 202 and works on after answering; `?wait=1` waits and answers the report.

```sh
curl -fsS -X POST -H "Authorization: Bearer $MYGITNOTES_LIVE_SWEEP_SECRET" https://notes.example.com/api/live/sweep
```

Every process of a multi-process deployment may run the schedule and the route: the editor's lease lets one check-in run per note at a time, and a repeat finds the text already in Git and makes no second commit.

## Optional: the built-in live editor

The community edition ships its own live editor. People co-edit a note in MyGitNotes' own editor and see each other's text and named cursors. Typing travels over a WebSocket on the app's own server, `/live/socket`, and is kept in Redis until the note is checked into Git.

Set `MYGITNOTES_LIVE_EDITOR=builtin` to turn it on. It is off by default, and with the variable unset or `off` the server runs exactly as before. Once it is on, every repository the deployment serves from its GitHub, GitHub Enterprise or GitLab site opens collab-first:

- **Opening a note.** A person who may write opens a Markdown note straight into the collab editor, in zoom, in a Focus pane and on the phone, with no Edit click. A person who may only read sees the live text read-only, and a signed-out visitor sees the text in Git. Outlines, templates, compilations and other files open as before.
- **Offline.** While the server cannot be reached, the note opens in the direct editor on a draft kept in the browser, under 「離線：修改先存在這台裝置，連線後會自動併入」. Typing in the collab editor that the server has not stored yet is kept in the browser too, and survives a reload. Once the browser is back online, both are merged into the live note. A merge that conflicts keeps the draft and offers to compare, copy or discard it; nothing is dropped without the person choosing to.
- **Check-in.** A note is checked into Git by itself about `MYGITNOTES_LIVE_IDLE_CHECKIN` (5 minutes by default) after its last edit, once everyone has left it. Closing the tab counts as leaving at once, and an open tab nobody touches stops counting 10 minutes after its last activity. Every live note is also checked in nightly at `MYGITNOTES_LIVE_CHECKIN_AT`, and whenever someone presses 「立即簽回」. A note that was only viewed makes no commit.
- **Who commits.** Each check-in commits with the provider token the first editor's own sign-in stored, so the provider decides at that moment whether they may still write; the deployment holds no write credential of its own. The first editor is the author and the others are `Co-authored-by`. When the first editor's token is refused, the next editor's is tried, and everyone keeps their credit. When nobody's works, the text stays live, the server logs an `uncommittable` notice and tries again later, and someone with access can press 「立即簽回」 to commit with their own token. On github.com editors are credited by their GitHub noreply address, `<user id>+<login>@users.noreply.github.com`. GitHub Enterprise and GitLab editors author a check-in through their own token but are not listed as co-authors, since no verified address exists for them.
- **Moving, renaming or deleting.** From the note's own editor, these first check the note in and then act, when nobody else is editing it; with others in it they are refused with 「N 人編輯中」. List and bulk actions on a note someone is editing are still refused with 「編輯中，請先簽回」.

### Variables of the built-in editor

| Variable | Meaning |
| --- | --- |
| `MYGITNOTES_LIVE_EDITOR` | `builtin` turns the editor on; unset or `off` leaves it off. Any other value stops the server at start. |
| `MYGITNOTES_LIVE_REDIS_URL` | The Redis that keeps live notes: a native `redis://` or `rediss://` URL. `REDIS_URL` when unset. Redis REST is not supported. |
| `MYGITNOTES_CACHE_REDIS_URL` | A Redis of its own for the read cache, which may evict (see [Two Redis instances](#two-redis-instances)). `REDIS_URL` when unset, as before. It works with or without the live editor. |
| `MYGITNOTES_LIVE_IDLE_CHECKIN` | How long after the last edit a note everyone has left is checked in, `1m` to `60m` (default `5m`), or `off`. Any other value stops the server at start. |
| `MYGITNOTES_LIVE_CHECKIN_AT` | The nightly check-in, `HH:mm` in `MYGITNOTES_TIMEZONE` (default `03:00`; UTC without a time zone), or `off`. |
| `MYGITNOTES_LIVE_SWEEP_SECRET` | Enables `POST /api/live/sweep`, as for [an external live editor](#optional-an-external-live-editor). Set it: it is how you check every note in before maintenance or before turning the editor off. |

With `builtin`, the server refuses to start, naming the fix, when:

- the source is a local checkout (`--local`, or `MYGITNOTES_SOURCE=local`): a local workspace has no live editor;
- sign-ins are kept in cookies (`MYGITNOTES_STORAGE=cookie`), which store no token a check-in could commit with;
- sign-ins would be kept in the container's directory (no `REDIS_URL` and no Redis REST store is set), where recreating the container loses them;
- no native Redis is named for live notes;
- `VERCEL` is set: Vercel functions do not stay up to hold a WebSocket;
- `APP_URL` is not the browser-facing bare origin, such as `https://notes.example.com` (`http` only on a loopback host). The socket accepts only that `Origin`.

The server also needs:

- **One app process.** Two during a deploy overlap stay correct and lose nothing, but people on different processes see each other's typing only every few seconds.
- **Memory** for a few times the text of each open note: 50 open notes of 50 KiB stay within tens of MiB. Live text is limited to 5 MiB per note.
- **A stop that waits.** On `SIGTERM` the editor stores what was typed and closes its sockets with 1012, within 15 s, before the server exits; tabs then reconnect to whichever process serves next. Give the container a stop grace period of at least 20 s (Compose `stop_grace_period: 30s`).

### Two Redis instances

Run two Redis servers, each a single server, not a cluster:

- **The live Redis** keeps sign-ins, agent grants, the stored provider tokens and live text. It must never evict and should persist: `appendonly yes` with `appendfsync everysec`, and `maxmemory-policy noeviction` (the default when no `maxmemory` is set). Live text carries no expiry, so a `volatile-*` policy also never takes it; under an `allkeys-*` policy the server refuses to start, because Redis could drop typing. When the policy cannot be read (some managed services hide it), the server warns and starts. Without an append-only file it warns that a Redis restart loses typing since the last check-in. If you cap it with `maxmemory`, a full Redis refuses new typing: tabs show 未儲存 instead of losing text, and sign-ins fail until you raise the cap.
- **The cache Redis** holds the read cache only: copies of notes and indexes under Git object ids and content hashes, safe to lose. Give it a `maxmemory` with `allkeys-lru` and no persistence, and point `MYGITNOTES_CACHE_REDIS_URL` at it. A cache write that fails ends its request with 503, so a cache sharing a full `noeviction` Redis would make reads fail; apart, the cache evicts and the live Redis keeps only what must stay.

Keys of both are namespaced by `MYGITNOTES_SESSION_NAMESPACE`. With [Docker Compose](#docker-compose-with-a-remote-repository), the `redis` service already runs with an append-only file and no `maxmemory`, and `compose.yaml` holds a commented `cache` service:

1. In `compose.yaml`, uncomment the `cache` service, and add `MYGITNOTES_CACHE_REDIS_URL: redis://cache:6379`, a `depends_on` entry for `cache` and `stop_grace_period: 30s` to the `mygitnotes` service, as its comment shows.
2. In `.env.docker`, set `MYGITNOTES_LIVE_EDITOR=builtin`, `APP_URL` to the public `https` origin, and `MYGITNOTES_LIVE_SWEEP_SECRET` to the output of `openssl rand -hex 32`.
3. Start it again: `docker compose up -d --build`. The log shows no refusal, and opening a note as a writer shows the collab editor's bar with 已儲存.

### WebSockets through the reverse proxy

The reverse proxy must pass WebSocket upgrades on `/live/socket`, with no idle timeout under 60 s; the server pings every socket every 15 s. Caddy's `reverse_proxy` passes them by default. nginx needs:

```nginx
location /live/ {
  proxy_pass http://127.0.0.1:4321;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_read_timeout 120s;
}
```

Browsers open the socket over HTTP/1.1, so no ALPN change is needed.

The server keeps at most 100 sockets open that have no note on them yet, 10 of them from one address, and answers 503 past that. A proxy on the host or the private network (loopback, 10/8, 172.16/12, 192.168/16, fc00::/7) names the client in the last `X-Forwarded-For` entry; Caddy sets it by default. Without it, every client behind the proxy counts as one address. Only the proxy directly in front of the app is trusted, and only its last entry is read; an entry that is not an IP address (after dropping a `:port` or `[...]`) counts as none, and the peer is used. Do not let other containers or LAN clients reach the app directly: from a private address the header is believed.

### Caddy behind Cloudflare

With Cloudflare in front of the proxy (the DNS record proxied), the last `X-Forwarded-For` entry Caddy writes would be Cloudflare's edge, so every visitor would count as a few addresses. Have Caddy pass on the client address Cloudflare reports in `CF-Connecting-IP`:

```caddy
notes.example.com {
	tls /etc/caddy/certs/origin.pem /etc/caddy/certs/origin.key
	reverse_proxy 127.0.0.1:4321 {
		header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}
		header_up X-Real-IP {http.request.header.CF-Connecting-IP}
		lb_try_duration 15s
		stream_close_delay 5m
	}
}
```

- **Only Cloudflare may reach the origin.** Allow ports 80 and 443 only from [Cloudflare's IP ranges](https://www.cloudflare.com/ips/) in the host's firewall. Anyone else who reaches Caddy could write `CF-Connecting-IP` themselves.
- **TLS.** Set the zone's SSL mode to Full (strict) and give Caddy a Cloudflare Origin CA certificate, as above, or use Full with Caddy's `tls internal`. An explicit `tls` keeps Caddy from requesting a public certificate it cannot get behind the proxy.
- **WebSockets** must be on in the zone's Network settings. Cloudflare closes a WebSocket after about 100 s without traffic, and the 15 s pings keep it open. A request that takes longer than about 100 s answers 524 while the server works on.
- `lb_try_duration` holds requests while the container restarts instead of answering 502, and `stream_close_delay` keeps live sockets open across a Caddy reload instead of cutting them all at once. Tabs reconnect without losing typing either way.

### Turning it on, and off

Switching a repository from an external editor to the built-in one, or turning the built-in one off, first checks in every live note:

```sh
curl -fsS -X POST -H "Authorization: Bearer $MYGITNOTES_LIVE_SWEEP_SECRET" "https://notes.example.com/api/live/sweep?mode=all&wait=1"
```

Then set `MYGITNOTES_LIVE_EDITOR` and restart. Text left in the live Redis when the editor is off is not lost, but nobody sees it until the editor is on again.

With the built-in editor, a new note left empty is discarded instead of being filed into Git: when someone presses 「立即簽回」 on it, at the idle and nightly check-ins, or with 「捨棄草稿」. A note counts as empty when nothing beyond the text it was created with, or the default title and placeholder line, holds a letter, digit, image or embed. A note not yet filed can also be moved or renamed before its first check-in; that changes where it will be filed and commits nothing.

### Composing it in an edition

An edition composes the editor in its own server entry with `builtinLiveNotes` from `@mygitnotes/local-server`. `open(repository, author, as)` returns the repository a check-in commits through, its commits authored by `author`: with the deployment's own write credential, or with the credential of the editor `as.person` names, throwing `LiveCredentialError` when that person cannot commit there.

```ts
import { builtinLiveNotes, createApp, redisLiveStore } from '@mygitnotes/local-server';

const live = builtinLiveNotes({ covers, open, store: redisLiveStore({ url: process.env.MYGITNOTES_LIVE_REDIS_URL! }) });
await live.started; // refuses a Redis that may evict live text
const app = createApp(base, { liveNotes: live /* and the deployment's other services */ });
const server = app.listen(port, host);
server.on('upgrade', (req, socket, head) => { if (!live.upgrade(req, socket, head)) socket.destroy(); });
process.once('SIGTERM', async () => { await live.shutdown(); server.close(); });
```

`memoryLiveStore()` in place of `redisLiveStore` keeps live text in the process: it is lost on every restart, so use it only for a single-user trial.

## Optional: the time zone of template dates

A note an agent creates from a template through MCP fills `{{date}}` and `{{time}}` from the server's clock, in UTC unless `MYGITNOTES_TIMEZONE` names an IANA time zone, for example `MYGITNOTES_TIMEZONE=Asia/Taipei`. The server refuses to fill a template while the name is not one the runtime knows. The web app fills them from the reader's own clock.

## Optional: private R2 assets

Store large files in a private Cloudflare R2 bucket and reference them in notes as `r2:<object-key>`. Set `MYGITNOTES_R2_ACCOUNT_ID`, `MYGITNOTES_R2_ACCESS_KEY_ID`, `MYGITNOTES_R2_SECRET_ACCESS_KEY`, and `MYGITNOTES_R2_BUCKET` in the deployment environment. Another S3-compatible service (SeaweedFS, MinIO and the like) works through `MYGITNOTES_R2_ENDPOINT`, its base URL, addressed path-style as `<endpoint>/<bucket>/<key>`; the account id is then not needed. `MYGITNOTES_R2_REGION` sets the region requests are signed for, `auto` when unset as R2 expects; many S3-compatible services expect `us-east-1`. Browser uploads also require a bucket CORS rule allowing PUT, GET, and HEAD from `APP_URL`. A read-only R2 token supports previews; Files-page management needs Object Read & Write. The MCP asset tools follow the same setting: with R2 configured `add_asset` uploads to the bucket and answers with the `r2:<object-key>` reference instead of committing the binary, `list_assets` reports bucket objects beside repository files, and `delete_asset` accepts that reference. A bucket-bound upload is not held to the 3 MiB repository limit; over hosted `/mcp` its ceiling is the 64 MiB request body, and the Files page uploads straight to the bucket with no ceiling. See [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/) and [R2 object access](https://developers.cloudflare.com/r2/api/s3/api/).

### Private R2 assets in a local checkout

A local workspace (`pnpm dev`, or a local Docker setup) keeps the private objects its notes reference in a cache folder and shows them from there, so a note's images also show offline. The store may be Cloudflare R2 or any S3-compatible bucket named by `MYGITNOTES_R2_ENDPOINT`.

The first time a note shows an `r2:` object, the local server reads it once and stores it; later views are answered from disk without a request to the bucket. A first view caches an object of up to 64 MiB; a larger one is redirected to the bucket as before. To fetch everything ahead of time, any size included, run the download command:

```bash
pnpm r2-download                                  # every note of every notebook
pnpm r2-download --notebook research              # one notebook (repeatable)
pnpm r2-download --note notes/research/paper.md   # one note (repeatable)
pnpm r2-download --note notes/research/paper.md --out ~/Desktop/paper-files   # also copy the objects to a folder, by key
pnpm r2-download --refresh                        # read every referenced object again
```

Only the keys a note's own text references are downloaded, an object already in the cache is not read again, and the command exits 1 and names each object it could not get. `--out` writes `<folder>/<object-key>` and nothing outside that folder.

The command and the local server read objects from one of two places, set in the checkout's `.env`:

- **Bucket keys.** The same `MYGITNOTES_R2_*` variables as a deployment. Read-only keys are enough.
- **A hosted deployment, without bucket keys.** Set `MYGITNOTES_R2_REMOTE_URL` to the deployment's address (`https://notes.example.com`) and `MYGITNOTES_R2_REMOTE_TOKEN` to an agent token: in the hosted app open Settings → MCP Access Control, create a read-only grant, and copy the part after `/mcp/` of the connector URL it shows. The deployment answers short-lived download URLs only for the keys its own copy of the note references, so push a note before downloading the objects it newly references. The token is sent only to that deployment (which must be `https`), never to the bucket, and is not written to the cache or to any log. The deployment must run a version that has the `download_assets` MCP tool.

Bucket keys win when both are set.

The cache is `.cache/r2-assets` in the checkout, which Git, `.vercelignore` and `.dockerignore` leave out; `MYGITNOTES_R2_CACHE_DIR` names another folder (in a container, a mounted volume, so the cache outlives the container). Each object is a file named by the SHA-256 of its key, with its key, size and entity tag in a `.json` file beside it. The cache has no size limit and holds the objects of one bucket: delete the folder to free the space, or when the checkout is pointed at another bucket. A cached object is not checked against the bucket again, which suits objects that are uploaded once and never replaced, as the app's own uploads are; after replacing an object under the same key, run `pnpm r2-download --refresh`. When the folder cannot be written, the local server logs the reason once and redirects to the bucket as it did before the cache.

A cached object is served under the same rule as a bucket one: only to a request for a note that references its key. The cache is trusted local state, not checked against the bucket: a file placed in `.cache/r2-assets` (for example one force-added to a cloned repository despite `.gitignore`) is served as that object, so treat a cloned repository's `.cache/` as you would its code. It is keyed by object key alone, so it assumes one bucket per checkout. Deleting or moving an object in the app's R2 manager, or deleting it through the MCP `delete_asset`, also removes its cached copy.

`MYGITNOTES_R2_REMOTE_URL` is the deployment's address; if the connector URL (`…/mcp/<token>`) is pasted into it, the `/mcp/<token>` part is dropped, and the token still comes only from `MYGITNOTES_R2_REMOTE_TOKEN`. The download URLs a deployment answers are read only when they are `https` (or `http` to this machine), and a redirect from one is refused.

### Downloading a note with its images

- **Web.** A note that references `r2:` objects has **Download with images (.zip)** in its Export menu. The archive holds the note, with those references pointing at `assets/<object-key>` beside it, and the objects. An object that could not be fetched keeps its `r2:` reference and is listed in `missing-assets.txt`. The archive is built in the browser and holds at most 512 MiB; on a hosted deployment the browser reads each object from the bucket, which needs the bucket CORS rule above to allow GET from `APP_URL`.
- **MCP.** `download_assets` with a note `path`. Over hosted `/mcp` it answers a 5-minute URL for each object the note references, at most 50 per call, also to a read-only grant. Through the local stdio server it stores the objects in the cache above, each up to 64 MiB (a larger one is named in `missing`; `pnpm r2-download` caches any size), and answers each file's path.
