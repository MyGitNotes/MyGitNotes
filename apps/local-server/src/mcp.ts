import { buildInfo } from './build-info.js';
import express, { Router } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { checkedOutFields, type LiveNotes, type RemoteCache, type RemoteChange, type RemoteCommitHeard, type RemoteSource, siteIdentity, SourceError, type WorkspaceConfigSource, type WorkspaceRequest, type WorkspaceSettings, WorkspaceSetupError } from '@mygitnotes/core';
import { callWorkspaceRemoteTool, isMutationTool, liveDiscardRemoteTools, liveRemoteTools, remoteTools, TEMPLATE_GUIDANCE, type ToolAssets } from '@mygitnotes/mcp-server';
import { type AssetStorage, resolveAssetScope } from './asset-storage.js';
import { CredentialRejected, grantPerson } from './auth.js';
import { type BearerGrant, bearerGrantRecord, type IdentityService } from './identity.js';
import type { RecordStore, StoredRecord } from './record-store/index.js';
import type { EditionSources } from './edition-sources.js';
import { gistAccess } from './gists.js';
import { type CommitPublisher, publishChanges } from './publishing.js';
import { dropHeaders } from './request-headers.js';
import { hasLiveView, openWorkspace, type RemoteHandle, type RequestWorkspace } from './request-workspace.js';

/** The JSON-RPC body of an ordinary call; a hosted asset upload carries its file inside the body and may be larger. */
const CALL_BODY_BYTES = 8 * 1024 * 1024;
const UPLOAD_BODY_BYTES = 64 * 1024 * 1024;

/**
 * Reads the request body once the caller is known. A body that declares it fits an ordinary call needs no
 * further decision; a larger one (or one of unknown size) gets the upload ceiling only when the asset storage
 * has a bucket for one of the workspace's repositories, so a deployment without one keeps the ordinary limit.
 */
async function readBody(req: express.Request, res: express.Response, workspace: RequestWorkspace, assets: ToolAssetsFor) {
  const declared = Number(req.headers['content-length']);
  let limit = CALL_BODY_BYTES;
  if (!(declared <= CALL_BODY_BYTES)) {
    const repositories = (await workspace.all()).filter(entry => 'handle' in entry);
    const scopes = await Promise.all(repositories.map(entry => assets((entry as { handle: RemoteHandle; }).handle).scope()));
    if (scopes.some(Boolean)) limit = UPLOAD_BODY_BYTES;
  }
  await new Promise<void>((resolve, reject) => express.json({ limit })(req, res, error => error ? reject(error) : resolve()));
}

/** The shape of a grant this server made and stored; a bearer of any other shape is not looked up in the store. */
const STORED_GRANT = /^[A-Za-z0-9_-]{43}$/;

type ToolAssetsFor = (handle: { reader: RemoteSource; }) => ToolAssets;

/** The asset tools of one request: the storage's scope, resolved for the repository a call reaches, and its quota hooks. */
function toolAssets(storage: AssetStorage, req: express.Request, res: express.Response): ToolAssetsFor {
  // SAFETY: the workspace of a remote MCP call is built by openWorkspace, so its handles are this server's RemoteHandles.
  return (handle): ToolAssets => ({ scope: () => resolveAssetScope(storage, req, res, handle as RemoteHandle), reserve: storage.reserve && ((scope, key, bytes) => storage.reserve!(scope, key, bytes)), record: storage.record && ((scope, key, delta) => storage.record!(scope, key, delta)) });
}

/** The request as the configuration source sees it for a grant: the grant's person and no browser cookie, so a cookie never chooses the person. */
function grantRequest(req: express.Request, person: WorkspaceRequest['person']): WorkspaceRequest {
  const { cookie: _cookie, ...headers } = req.headers;
  return { headers, ...(person ? { person } : {}) };
}

/**
 * The members a grant reaches. A grant bound to a person and site reaches every visible member on that site. A grant
 * made before grants bound to a person reaches only the repository it was made for, while that repository is a
 * visible member, and nothing otherwise; it stays accepted until its owner revokes it.
 */
function grantSettings(settings: WorkspaceSettings, grant: StoredRecord): WorkspaceSettings {
  if (typeof grant.source !== 'string') return settings;
  return { ...settings, members: settings.members.filter(member => member.ref.id === grant.source && !member.hidden).map(member => ({ ...member, default: true })) };
}

/** `publish` hears the notes a call's writes commit, with the grant's person and Gist access; the call's answer is the same with or without it. */
export function createRemoteMCP(store: RecordStore, identity: IdentityService, configSource: WorkspaceConfigSource, assetStorage: AssetStorage, cache?: RemoteCache, editionSources?: EditionSources, liveNotes?: LiveNotes, publish?: CommitPublisher): Router {
  const router = Router();
  router.post(['/', '/:token'], async (req, res) => {
    try {
      if (configSource.mode === 'local') return res.status(503).json({ error: 'Configure a GitHub or GitLab source for remote MCP.' });
      const urlToken = typeof req.params.token === 'string' && STORED_GRANT.test(req.params.token) ? req.params.token : undefined;
      const presented = urlToken || req.headers.authorization?.match(/^Bearer ([A-Za-z0-9._~+/-]+=*)$/)?.[1];
      const bearer = presented && STORED_GRANT.test(presented) ? presented : undefined;
      // Any other bearer is an outside one: only an identity that resolves them is asked, and only from the header.
      const outside = presented && !bearer && identity.bearerGrant ? presented : undefined;
      const stored = bearer ? await store.get(bearer) : null;
      // Rejections of an existing grant outlive the runtime logs so its owner can read the reason on the grant list. An outside bearer is no record's id.
      const remember = async (reason: string) => {
        if (bearer) await store.recordRejection(bearer, reason).catch(error => console.warn(`[mcp] rejection record failed: ${(error as Error).message}`));
      };
      const unauthorized = async (reason: string) => {
        console.warn(`[mcp] unauthorized: ${reason}`);
        if (stored?.kind === 'agent') await remember(reason);
        res.setHeader('WWW-Authenticate', 'Bearer realm="MyGitNotes MCP"');
        return res.status(401).json({ error: 'Create a MyGitNotes agent token after signing in.' });
      };
      let resolved: StoredRecord | null = null;
      if (outside) {
        let answer: BearerGrant | null;
        try {
          answer = await identity.bearerGrant!(req, outside);
          // Reading the answer runs the identity's code too, so it fails the same way.
          resolved = answer ? bearerGrantRecord(answer) : null;
        } catch (error) {
          // The message of a failed verification may quote the bearer, so only the error's class is logged.
          const name = error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name) ? ` (${error.name})` : '';
          return unauthorized(`bearer-error${name}`);
        }
        if (!answer) return unauthorized('bearer-refused');
        if (!resolved) return unauthorized('bearer-invalid');
      }
      const grant = resolved ?? stored;
      // The grant is verified before the workspace is resolved, and the workspace is the person's the grant names.
      if (grant?.kind !== 'agent' || (bearer && grant.audience !== `${process.env.APP_URL}/mcp`)) return unauthorized(!bearer ? 'no-token' : !grant ? 'grant-missing' : grant.kind !== 'agent' ? 'grant-kind' : 'grant-audience');
      // From here the call is the grant's person's: the configuration source, the edition's sources and the asset storage
      // get the request without any bearer, the one used or another sent beside a URL grant.
      dropHeaders(req, ['authorization']);
      const person = await grantPerson(store, grant);
      // A deployment without a usable source answers like one configured for local files.
      const settings = await configSource.settings(grantRequest(req, person)).catch((error: unknown) => {
        if (error instanceof WorkspaceSetupError) return undefined;
        throw error;
      });
      if (!settings || settings.site.type === 'local') return res.status(503).json({ error: 'Configure a GitHub or GitLab source for remote MCP.' });
      if (typeof grant.source !== 'string' && grant.site !== siteIdentity(settings.site)) return unauthorized('grant-site');
      let token: string | undefined;
      try {
        token = await identity.grantToken(grant, person, settings.site);
      } catch (error) {
        if (!(error instanceof SourceError)) console.warn(`[mcp] credential lookup failed: ${(error as Error).message}`);
        await remember(error instanceof CredentialRejected ? error.reason : 'credential-unavailable');
        return res.status(error instanceof SourceError ? error.status : 503).json({ error: error instanceof SourceError ? error.message : 'Agent authorization service unavailable. Retry later.' });
      }
      // A person without a credential on the site opens nothing there; the identity says why.
      if (token === undefined && !(editionSources && person)) {
        await remember('credential-unavailable');
        res.setHeader('WWW-Authenticate', 'Bearer realm="MyGitNotes MCP"');
        return res.status(401).json({ error: identity.noCredentialMessage(settings.site) });
      }
      // Asset storage finds the caller on the request too: it is the grant's person, never a browser session sent beside the grant.
      dropHeaders(req, ['cookie']);
      if (person) (req as express.Request & WorkspaceRequest).person = person;
      // The commits the call makes are authored by whom the grant names, where it names anyone: an outside bearer's grant
      // as the identity answered, a stored one as it was recorded.
      const granted = grantSettings(settings, grant);
      // A note a write commits is published as after a commit in the app: a Gist it names is updated with the grant's own
      // GitHub token, but only one the note already named before the commit. The id is note text the agent writes, so a
      // new or changed one would aim the person's token at any Gist they hold.
      const gists = gistAccess(settings.site, token);
      /** The publication of the commits this call made, which its answer waits for where the deployment has no `defer`. */
      const publishing: Promise<unknown>[] = [];
      const committed = (repository: RemoteHandle, changes: readonly RemoteChange[], { revision, previous }: RemoteCommitHeard) => void publishing.push(publishChanges(publish!, { repository, changes, revision, previous, ...(person ? { person } : {}), ...(gists ? { gists } : {}) }));
      const tools = hasLiveView(granted, person, liveNotes) ? typeof liveNotes!.service.discard === 'function' ? liveDiscardRemoteTools : liveRemoteTools : remoteTools;
      const workspace = openWorkspace(granted, token, cache, { ...(person ? { person } : {}), ...(grant.author ? { author: grant.author } : {}), ...(editionSources ? { editionSources } : {}), ...(liveNotes ? { liveNotes } : {}), ...(publish ? { committed } : {}), request: req, noCredentialMessage: site => identity.noCredentialMessage(site) });
      const assets = toolAssets(assetStorage, req, res);
      try {
        await readBody(req, res, workspace, assets);
      } catch (error) {
        const status = (error as { status?: number; }).status;
        if (!status || status < 400 || status >= 500) throw error;
        return res.status(status).json({ error: status === 413 ? 'The request body is too large.' : 'The request body is not valid JSON.' });
      }
      const server = new Server({ name: 'mygitnotes', version: buildInfo.version }, { capabilities: { tools: {} }, instructions: `Operate on the configured note repository. Use ls or glob to locate paths, read or find to inspect complete files, then pass the returned revision to a write operation. Before creating or editing notes, read the agent system of the notebook or note with get_system_prompt and list_skills; invoke_skill loads a skill, and read, write, append, edit and rm also work on skill files. ${TEMPLATE_GUIDANCE} Each successful mutation creates one atomic remote commit with a program-generated message. Respect read-only grants. Use Settings to revoke persistent connector URLs.` });
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.filter(t => grant.write || !isMutationTool(t.name)) }));
      server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
        try {
          const result = await callWorkspaceRemoteTool(workspace as import('@mygitnotes/core').WorkspaceRepositories<RemoteHandle>, params.name, params.arguments || {}, grant.write, process.env.APP_URL, assets);
          return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: (error as Error).message, ...checkedOutFields(error) }) }] };
        } finally {
          await Promise.all(publishing.splice(0));
        }
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.warn(`[mcp] session service unavailable: ${(error as Error).message}`);
      if (!res.headersSent) res.status(503).json({ error: 'MCP session service unavailable.' });
    }
  });
  router.all(['/', '/:token'], (_req, res) => res.status(405).set('Allow', 'POST').end());
  return router;
}
