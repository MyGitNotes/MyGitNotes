/*
 * A dev composition of live notes (docs/specs/2026-11-15-live-notes/spec.md §14 L4), started by scripts/dev-live-memory.ts;
 * it sits beside the local server so its packages resolve, outside `src`, so it is never built or shipped: the app over an
 * in-memory edition source with the memory live adapter, and a stub live editor on a second loopback port that frames
 * like the real one and posts status messages. Every request is signed in; nothing reaches the network.
 *
 *   pnpm --filter "./packages/*" run build && pnpm --filter @mygitnotes/web run build
 *   pnpm exec tsx scripts/dev-live-memory.ts
 *
 * App: http://127.0.0.1:4390 (MYGITNOTES_LIVE_DEV_PORT); editor: http://127.0.0.1:4391 (MYGITNOTES_LIVE_DEV_EDITOR_PORT).
 * Signed in as `dev` (writes); http://127.0.0.1:4390/dev/as/reader switches to a read-only person, /dev/as/dev back.
 * Repository `p1/notes` has the live editor; `p1/plain` has none. Notes over 64 KiB are too large for the stub editor.
 * The build's type check stops at `src`; `pnpm --filter @mygitnotes/local-server typecheck:dev` checks this file
 * (tsconfig.dev.json) against the internal APIs it composes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express, { Router } from 'express';
import { type EditionSourceConfig, type LiveContext, sourceIdentity, type WorkspaceConfigSource } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
import type { IdentityService } from '../src/identity.js';
import { memoryEditionSources, type MemoryFiles } from '../src/memory-edition-source.js';
import { memoryLiveNotes } from '../src/memory-live-notes.js';
import { createRecordStore } from '../src/record-store/index.js';
import { workspaceSettings } from '../tests/workspace-settings.js';

const host = '127.0.0.1';
const appPort = Number(process.env.MYGITNOTES_LIVE_DEV_PORT || 4390);
const editorPort = Number(process.env.MYGITNOTES_LIVE_DEV_EDITOR_PORT || 4391);
const appOrigin = `http://${host}:${appPort}`;
const editorOrigin = `http://${host}:${editorPort}`;
const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const webDist = path.join(repoRoot, 'apps/web/dist');
if (!fs.existsSync(path.join(webDist, 'index.html'))) throw new Error('Build the web app first: pnpm --filter @mygitnotes/web run build');

const manifest = `schema_version: 4
workspace:
  title: Live notes (memory)
  default_notebook: life
notebooks:
  - id: life
    title: Life
    root: notes/life
    statuses: [inbox, doing, done]
`;
const meeting = `---
template:
  name: Meeting
  path: '會議/{{kind}}/{{date}} {{title}}.md'
  placeholders:
    kind:
      default: 其他
      description: 會議類型
date: '{{date}}'
status: inbox
---
# {{title}}

Kind: {{kind}}
`;
const note = (title: string, status: string, body: string, tags: string[] = []) => `---\ntitle: ${title}\nstatus: ${status}\ntags: [${tags.join(', ')}]\n---\n# ${title}\n\n${body}\n`;
const notesFiles: MemoryFiles = new Map([['.mygitnotes.yaml', manifest], ['notes/life/plan.md', note('Plan', 'doing', 'The plan, edited live.', ['work'])], ['notes/life/ideas.md', note('Ideas', 'inbox', 'Some ideas.')], ['notes/life/done.md', note('Done', 'done', 'Finished.')], ['notes/life/roadmap.outline.md', '- [Plan](plan.md)\n'], ['notes/life/big.md', note('Big', 'inbox', 'x'.repeat(80 * 1024))], ['notes/life/.templates/meeting.md', meeting]]);
const plainFiles: MemoryFiles = new Map([['.mygitnotes.yaml', manifest.replace('Live notes (memory)', 'Plain')], ['notes/life/plain.md', note('Plain', 'inbox', 'No live editor here.')]]);

const notes: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main', label: 'Notes (live)' };
const plain: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/plain', branch: 'main', label: 'Plain' };
const repository = sourceIdentity(notes);
const editor = { origin: editorOrigin, messageType: 'dev-live', themeParam: 'theme' };
const liveNotes = memoryLiveNotes({ editor, repositories: [{ source: notes, files: notesFiles }], maxBytes: 64 * 1024, discard: true, retarget: true });

const people: Record<string, { name: string; email: string; }> = { dev: { name: 'Dev', email: 'dev@example.test' }, reader: { name: 'Reader', email: 'reader@example.test' } };
const personOf = (req: express.Request) => {
  const match = /(?:^|;\s*)dev-person=(dev|reader)/.exec(req.headers.cookie ?? '');
  return match?.[1] ?? 'dev';
};
const identity: IdentityService = {
  router: Router(),
  signedIn: async req => {
    const who = personOf(req as express.Request);
    return { person: { realm: 'edition', userId: who }, login: who, owner: `edition:${who}`, author: people[who] };
  },
  token: async () => undefined,
  grantCredential: async () => undefined,
  grantToken: async () => undefined,
  noCredentialMessage: () => 'No credential.',
  signInOptions: async () => [],
  configured: async () => true,
  signOut: async () => {},
};
// The site is a provider's (an edition source has none); the workspace's members are the two edition repositories.
const configSource: WorkspaceConfigSource = {
  mode: 'remote',
  settings: async () => {
    const settings = workspaceSettings([{ type: 'github', repository: 'owner/site', branch: 'main' }, notes, plain]);
    return { ...settings, members: [{ ...settings.members[1], default: true }, settings.members[2]] };
  },
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-live-dev-'));
Object.assign(process.env, { SESSION_SECRET: process.env.SESSION_SECRET || 's'.repeat(64), APP_URL: appOrigin, MYGITNOTES_SOURCE: 'github', MYGITNOTES_LIVE_CHECKIN_AT: 'off', UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', KV_REST_API_URL: '' });
const app = createApp(root, { configSource, recordStore: createRecordStore(root), remoteCache: undefined, workspaceChoices: null, identity, editionSources: memoryEditionSources({ repositories: new Map([['p1/notes', notesFiles], ['p1/plain', plainFiles]]), mayWrite: person => person.userId === 'dev' }), liveNotes, webDist });
const outer = express();
outer.get('/dev/as/:who', (req, res) => {
  const who = req.params.who === 'reader' ? 'reader' : 'dev';
  res.setHeader('Set-Cookie', `dev-person=${who}; Path=/; SameSite=Lax`);
  res.redirect(302, '/');
});
outer.use(app);

/*
 * The stub editor: `/n/<id>` shows the live text in a textarea. Typing writes it as the signed-in dev person; the page
 * counts as an active editor while it is open, and posts `{ type, users, saved, connected, released }` to the app.
 */
const editorApp = express();
editorApp.use(express.json({ limit: '1mb' }));
const devPerson: LiveContext = { person: { realm: 'edition', userId: 'dev' }, author: people.dev, request: { headers: {} } };
const linkOf = async (id: string) => (await liveNotes.service.checkouts(repository)).find(row => row.id === id);
editorApp.get('/n/:id/state', async (req, res) => {
  const row = await linkOf(req.params.id);
  if (!row) return res.json({ released: true, users: 0 });
  res.json({ released: false, users: row.activeEditors, content: (await liveNotes.person(devPerson).read(repository, row.id)).content });
});
editorApp.post('/n/:id/text', async (req, res) => {
  if (!await linkOf(req.params.id) || typeof req.body?.content !== 'string') return res.status(409).json({ error: 'released' });
  liveNotes.type(repository, req.params.id, req.body.content, devPerson);
  res.json({ ok: true });
});
const active = new Map<string, number>();
editorApp.post('/n/:id/active', async (req, res) => {
  const row = await linkOf(req.params.id);
  if (!row) return res.json({ ok: false });
  const next = Math.max(0, (active.get(row.id) ?? 0) + (req.body?.delta === -1 ? -1 : 1));
  active.set(row.id, next);
  liveNotes.setActive(repository, row.id, next);
  res.json({ ok: true });
});
editorApp.get('/n/:id', (req, res) => {
  const id = /^[A-Za-z0-9_-]{1,64}$/.test(req.params.id) ? req.params.id : '';
  const theme = req.query.theme === 'dark' ? 'dark' : 'light';
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Stub live editor</title><style>
body{margin:0;font:14px system-ui;display:flex;flex-direction:column;height:100vh}body.light{background:#fff;color:#111}body.dark{background:#1b1b1f;color:#eee}
header{padding:6px 10px;font-size:12px;opacity:.7}textarea{flex:1;margin:0 10px 10px;padding:8px;font:13px ui-monospace,monospace;background:inherit;color:inherit;border:1px solid #888;border-radius:6px}
</style></head><body class="${theme}"><header>Stub live editor · note ${id} · <span id="s">connecting</span></header><textarea id="t" spellcheck="false"></textarea><script>
const id=${JSON.stringify(id)},app=${JSON.stringify(appOrigin)},type=${JSON.stringify(editor.messageType)};
const t=document.getElementById('t'),s=document.getElementById('s');let saved=true,users=1,released=false,timer;
const post=()=>{if(window.parent!==window)window.parent.postMessage({type,users,saved,connected:true,released},app);s.textContent=released?'released':saved?'saved':'saving';};
const poll=async()=>{const r=await (await fetch('/n/'+id+'/state')).json();users=r.users;if(r.released){released=true;t.disabled=true;}else if(saved&&document.activeElement!==t)t.value=r.content;post();};
t.addEventListener('input',()=>{saved=false;post();clearTimeout(timer);timer=setTimeout(async()=>{await fetch('/n/'+id+'/text',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:t.value})});saved=true;post();},400);});
window.addEventListener('message',e=>{if(e.origin===app&&e.data&&e.data.type===type+':theme')document.body.className=e.data.theme==='dark'?'dark':'light';});
window.addEventListener('pagehide',()=>navigator.sendBeacon('/n/'+id+'/active',new Blob([JSON.stringify({delta:-1})],{type:'application/json'})));
fetch('/n/'+id+'/active',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({delta:1})}).then(poll);setInterval(poll,2000);
</script></body></html>`);
});

const appServer = createServer(outer).listen(appPort, host, () => console.log(`App: ${appOrigin} (signed in as dev; ${appOrigin}/dev/as/reader for a reader)`));
const editorServer = createServer(editorApp).listen(editorPort, host, () => console.log(`Stub live editor: ${editorOrigin}`));
const stop = () => {
  appServer.close();
  editorServer.close();
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
