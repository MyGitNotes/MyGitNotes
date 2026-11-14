import fs from 'node:fs';
import path from 'node:path';
import { classifyResource, downloadNoteR2Objects, loadEnvDefaults, loadWorkspaceConfig, localR2Source, r2Cache, r2CacheRoot, type R2DownloadReport, resolveSafePath, scanNotebookMarkdownNotes, type WorkspaceConfig } from '../packages/core/src/index.js';
import { memberWorktrees, resolveWorkspaceRoot } from './lib/workspace-root.js';

const log = (line: string) => console.log(`[r2-download] ${line}`);
const USAGE = 'Usage: pnpm r2-download [--note <path>]... [--notebook <id>]... [--out <dir>] [--refresh] [--workspace <path>]';

/** Every value given for a repeatable option. */
function values(name: string): string[] {
  return process.argv.flatMap((arg, index) => {
    if (arg !== name) return [];
    const value = process.argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.\n${USAGE}`);
    return [value];
  });
}

interface Worktree {
  root: string;
  config: WorkspaceConfig;
}

/** The note at `file` in the worktree that holds it, as the local app reads a note for `/r2-assets`. */
function namedNote(worktrees: Worktree[], file: string) {
  for (const { root, config } of worktrees) {
    if (!['note', 'outline', 'template'].includes(classifyResource(file, config).type)) continue;
    let absolute: string;
    try {
      absolute = resolveSafePath(root, file);
    } catch {
      continue;
    }
    if (fs.statSync(absolute, { throwIfNoEntry: false })?.isFile()) return { path: file, content: fs.readFileSync(absolute, 'utf8') };
  }
  throw new Error(`${file} is not a note of this workspace.`);
}

/**
 * Downloads the private `r2:` objects the workspace's notes reference into the checkout's cache (and into `--out`),
 * so the local app shows them offline. Objects are read with the bucket keys of the environment (`MYGITNOTES_R2_*`),
 * or without them through a hosted deployment and an agent token (`MYGITNOTES_R2_REMOTE_URL`, `MYGITNOTES_R2_REMOTE_TOKEN`).
 */
async function r2Download() {
  if (process.argv.includes('--help')) return console.log(USAGE);
  const checkout = process.cwd();
  loadEnvDefaults(path.join(checkout, '.env'));
  const root = resolveWorkspaceRoot(checkout);
  const worktrees = memberWorktrees(root, checkout, { visibleOnly: true }).flatMap((worktree): Worktree[] => {
    const config = loadWorkspaceConfig(worktree);
    return config ? [{ root: worktree, config }] : [];
  });
  if (!worktrees.length) throw new Error(`No workspace configuration found at ${root}.`);

  const named = values('--note'), notebooks = values('--notebook');
  const [outDir] = values('--out');
  const unknown = notebooks.filter(id => !worktrees.some(({ config }) => config.notebooks.some(nb => nb.id === id)));
  if (unknown.length) throw new Error(`Notebook ${unknown.join(', ')} is not configured in this workspace.`);
  // Named notes are read as the local app reads them; otherwise every note of the chosen notebooks, or of all of them.
  const notes = named.length ? named.map(file => namedNote(worktrees, file)) : worktrees.flatMap(({ root: worktree, config }) => config.notebooks.filter(nb => !notebooks.length || notebooks.includes(nb.id)).flatMap(nb => scanNotebookMarkdownNotes(worktree, nb).map(note => ({ path: note.path, content: fs.readFileSync(resolveSafePath(worktree, note.path), 'utf8') }))));

  const source = localR2Source();
  const cache = r2Cache(r2CacheRoot(checkout));
  const reports: { note: string; report: R2DownloadReport; }[] = [];
  for (const note of notes) {
    const report = await downloadNoteR2Objects({ note, source, cache, refresh: process.argv.includes('--refresh'), ...(outDir ? { outDir: path.resolve(checkout, outDir) } : {}) });
    if (report.keys.length) reports.push({ note: note.path, report });
    for (const key of report.downloaded) log(`downloaded r2:${key}`);
  }

  // An object counts once, however many notes reference it; one note's refusal does not make it missing when another note got it.
  const downloaded = new Set(reports.flatMap(({ report }) => report.downloaded));
  const referenced = new Set(reports.flatMap(({ report }) => report.keys));
  const copyFailed = new Set(reports.flatMap(({ report }) => report.missing.filter(({ key }) => cache.find(key)).map(({ key }) => key)));
  const missing = [...referenced].filter(key => !cache.find(key) || copyFailed.has(key));
  for (const { note, report } of reports) {
    for (const { key, reason } of report.missing) if (missing.includes(key)) log(`missing ${note}: r2:${key} (${reason})`);
  }
  log(`Done. ${downloaded.size} downloaded, ${[...referenced].filter(key => !downloaded.has(key) && cache.find(key)).length} already cached, ${missing.length} missing, from ${reports.length} note(s) with r2: references.`);
  log(`Cache: ${cache.root}`);
  if (outDir) log(`${new Set(reports.flatMap(({ report }) => report.written)).size} file(s) copied to ${path.resolve(checkout, outDir)}`);
  if (missing.length && !source) log('No source is configured. Set the bucket keys (MYGITNOTES_R2_ACCOUNT_ID, MYGITNOTES_R2_ACCESS_KEY_ID, MYGITNOTES_R2_SECRET_ACCESS_KEY, MYGITNOTES_R2_BUCKET), or MYGITNOTES_R2_REMOTE_URL and MYGITNOTES_R2_REMOTE_TOKEN (an agent token of a hosted deployment) in .env.');
  if (missing.length) process.exitCode = 1;
}

r2Download().catch((error) => {
  console.error(`[r2-download] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
