import YAML from 'yaml';
import { z } from 'zod';
import { NOTEBOOK_KEY_MAX_LENGTH, parseNotebookKey } from './notebook-key.js';
import { type StudyProgression, StudyProgressionSchema } from './study-stages.js';
import { isNoteHidden } from './note-status.js';

/** The workspace `schema_version` that replaced the Screen file with compilation files. */
export const COMPILATION_SCHEMA_VERSION = 3;

/** A compilation is a note-shaped file inside a notebook: `<name>.compilation.yml`. */
export const COMPILATION_SUFFIX = '.compilation.yml';
export const COMPILATION_MAX_BYTES = 512 * 1024;
/** The cap on content items: notes, folders, assets and videos. Chapter headings have their own cap. */
export const COMPILATION_MAX_ITEMS = 100;
export const COMPILATION_MAX_HEADINGS = 100;
/** A manual order names every member of a dynamic compilation, which can outgrow the pinned-item limit. */
export const COMPILATION_MAX_ORDER = 2000;
export const isCompilationPath = (file: string) => file.endsWith(COMPILATION_SUFFIX);

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
/* eslint-disable no-control-regex -- Reject control characters in persisted paths, identifiers or filenames. */
const repoPath = z.string().min(1).max(2048).refine(value => !/[\\\x00-\x1f\x7f]/.test(value) && value.split('/').every(part => part !== '' && part !== '.' && part !== '..'), 'Invalid workspace path');
/* eslint-enable no-control-regex */
const notebookId = z.string().min(1).max(NOTEBOOK_KEY_MAX_LENGTH);
const videoId = z.string().regex(/^[\w-]{11}$/);
const start = z.number().int().min(0).max(86400).default(0);
const videoTitle = z.string().max(160).optional();
const headingTitle = z.string().trim().min(1).max(100);
/** A chapter heading: it starts a chapter of the items after it, up to the next heading. It names no file, so it has no path or notebook. */
const HeadingItemSchema = z.object({ id, kind: z.literal('heading'), title: headingTitle }).strict();
export type CompilationHeadingItem = z.infer<typeof HeadingItemSchema>;

export const GraphLayoutSchema = z.object({ nodes: z.array(z.object({ path: repoPath, x: z.number().finite().min(-1e7).max(1e7), y: z.number().finite().min(-1e7).max(1e7), width: z.number().min(240).max(1600).optional(), height: z.number().min(180).max(1400).optional(), expanded: z.boolean().optional(), pinned: z.boolean().optional() }).strict()).max(5000) }).strict();
export type GraphLayout = z.infer<typeof GraphLayoutSchema>;

const reference = { id, notebookId, path: repoPath };
/** An item as the browser holds it: file references plus the owning notebook. */
export const CompilationItemSchema = z.discriminatedUnion('kind', [z.object({ ...reference, kind: z.literal('note') }).strict(), z.object({ ...reference, kind: z.literal('folder') }).strict(), z.object({ ...reference, kind: z.literal('asset') }).strict(), z.object({ id, kind: z.literal('youtube'), videoId, start, title: videoTitle }).strict(), HeadingItemSchema]);
export type CompilationItem = z.infer<typeof CompilationItemSchema>;
/** An item that names a file or folder of the repository: a note, folder or asset. */
export type CompilationFileRef = Extract<CompilationItem, { path: string; }>;
export const isFileItem = (item: CompilationItem): item is CompilationFileRef => item.kind !== 'youtube' && item.kind !== 'heading';

const fileReference = { id, path: repoPath };
const FileItemSchema = z.discriminatedUnion('kind', [z.object({ ...fileReference, kind: z.literal('note') }).strict(), z.object({ ...fileReference, kind: z.literal('folder') }).strict(), z.object({ ...fileReference, kind: z.literal('asset') }).strict(), z.object({ id, kind: z.literal('youtube'), videoId, start, title: videoTitle }).strict(), HeadingItemSchema]);
const FileSourceSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('tag'), tag: z.string().min(1).max(200) }).strict(), z.object({ kind: z.literal('folder'), path: repoPath, recursive: z.boolean().default(true) }).strict()]);
const SortSchema = z.object({ field: z.enum(['updated', 'created', 'title', 'status', 'manual']), order: z.enum(['asc', 'desc']) }).strict();
const StudySchema = z.object({ filter: z.enum(['all', 'due', 'future', 'paused']), dueFirst: z.boolean(), status: z.string().max(200).optional() }).strict();
const tag = z.string().trim().min(1).max(200);

export const COMPILATION_ARRANGEMENTS = ['lane', 'book', 'graph'] as const;
export const COMPILATION_SIZES = ['thumbnail', 'small', 'medium'] as const;

/** The stored file; it never repeats the notebook, which the path decides. */
export const CompilationFileSchema = z.object({ version: z.literal(1), id, title: z.string().trim().min(1).max(100), arrangement: z.enum([...COMPILATION_ARRANGEMENTS, 'stack']).transform(value => value === 'stack' ? 'book' as const : value), size: z.enum(COMPILATION_SIZES).optional(), tags: z.array(tag).max(100).optional(), status: z.string().trim().min(1).max(200).optional(), items: z.array(FileItemSchema).max(COMPILATION_MAX_ITEMS + COMPILATION_MAX_HEADINGS).optional(), source: FileSourceSchema.optional(), sort: SortSchema.optional(), manualOrder: z.array(repoPath).max(COMPILATION_MAX_ORDER).optional(), study: StudySchema.optional(), progression: StudyProgressionSchema.optional(), graph: GraphLayoutSchema.optional() }).strict().superRefine((file, context) => {
  if ((file.items === undefined) === (file.source === undefined)) context.addIssue({ code: 'custom', message: 'Give exactly one of items or source', path: ['items'] });
  if (file.sort && !file.source) context.addIssue({ code: 'custom', message: 'sort applies to a source', path: ['sort'] });
  if (file.manualOrder && !file.source) context.addIssue({ code: 'custom', message: 'manualOrder applies to a source', path: ['manualOrder'] });
  if (file.manualOrder && new Set(file.manualOrder).size !== file.manualOrder.length) context.addIssue({ code: 'custom', message: 'manualOrder repeats a path', path: ['manualOrder'] });
  const headings = (file.items ?? []).filter(item => item.kind === 'heading').length;
  if ((file.items?.length ?? 0) - headings > COMPILATION_MAX_ITEMS) context.addIssue({ code: 'custom', message: `Too many items: at most ${COMPILATION_MAX_ITEMS}, chapter headings aside`, path: ['items'] });
  if (headings > COMPILATION_MAX_HEADINGS) context.addIssue({ code: 'custom', message: `Too many chapter headings: ${headings}, at most ${COMPILATION_MAX_HEADINGS}`, path: ['items'] });
  const ids = new Set<string>();
  for (const item of file.items ?? []) {
    if (ids.has(item.id)) context.addIssue({ code: 'custom', message: `Duplicate item id ${item.id}`, path: ['items'] });
    ids.add(item.id);
  }
});
export type CompilationFile = z.infer<typeof CompilationFileSchema>;
export type CompilationFileItem = z.infer<typeof FileItemSchema>;

/** Whether an item is a chapter heading. */
export const isHeadingItem = <T extends { kind: string; }>(item: T): item is Extract<T, { kind: 'heading'; }> => item.kind === 'heading';
/** The items that name content: every item but the chapter headings. */
export function contentItems<T extends { kind: string; }>(items: readonly T[]): Exclude<T, { kind: 'heading'; }>[] {
  return items.filter((item): item is Exclude<T, { kind: 'heading'; }> => item.kind !== 'heading');
}
/** One chapter of a compilation: a heading and the items up to the next one, or a single item before the first heading. */
export interface CompilationChapter<T extends { kind: string; }> {
  heading?: Extract<T, { kind: 'heading'; }>;
  items: Exclude<T, { kind: 'heading'; }>[];
}
/**
 * The chapter structure of a flat item list: each heading collects the items after it up to the next heading,
 * and an item before the first heading is a chapter of its own. A list without headings gives one chapter per item.
 */
export function compilationChapters<T extends { kind: string; }>(items: readonly T[]): CompilationChapter<T>[] {
  const chapters: CompilationChapter<T>[] = [];
  let current: CompilationChapter<T> | undefined;
  for (const item of items) {
    if (isHeadingItem(item)) chapters.push(current = { heading: item, items: [] });
    else if (current) current.items.push(item as Exclude<T, { kind: 'heading'; }>);
    else chapters.push({ items: [item as Exclude<T, { kind: 'heading'; }>] });
  }
  return chapters;
}

/** Inserts an item as the last item of the chapter a heading starts (before the next heading), or at the end when no heading is named or found. */
export function addToChapter<T extends { id: string; kind: string; }>(items: readonly T[], item: T, headingId?: string): T[] {
  const start = headingId === undefined ? -1 : items.findIndex(candidate => candidate.id === headingId && candidate.kind === 'heading');
  if (start < 0) return [...items, item];
  const next = items.findIndex((candidate, index) => index > start && candidate.kind === 'heading');
  const at = next < 0 ? items.length : next;
  return [...items.slice(0, at), item, ...items.slice(at)];
}

export type CompilationView = 'thumbnail' | 'small' | 'medium' | 'graph' | 'book';
export const COMPILATION_VIEWS: readonly CompilationView[] = ['thumbnail', 'small', 'medium', 'graph', 'book'];
export interface CompilationStudy {
  filter: 'all' | 'due' | 'future' | 'paused';
  dueFirst: boolean;
  status?: string;
}
export interface CompilationSort {
  /** `manual` follows the row's `manualOrder`, then the members it does not name, oldest update first. */
  field: 'updated' | 'created' | 'title' | 'status' | 'manual';
  order: 'asc' | 'desc';
}
interface CompilationRowBase {
  id: string;
  name: string;
  notebookId: string;
  /** The file's repository-relative path. */
  path: string;
  view: CompilationView;
  /** The stored lane card size, kept while `view` is book or graph so switching back restores it. */
  size?: CompilationFile['size'];
  tags?: string[];
  status?: string;
  graph?: GraphLayout;
  progression?: StudyProgression;
  study?: CompilationStudy;
}
export type CompilationTagSource = { kind: 'tag'; tag: string; notebookId: string; };
export type CompilationFolderSource = { kind: 'folder'; path: string; recursive: boolean; notebookId: string; };
export type CompilationSource = CompilationTagSource | CompilationFolderSource;
export type CompilationRow = (CompilationRowBase & { kind: 'custom'; items: CompilationItem[]; }) | (CompilationRowBase & { kind: 'dynamic'; source: CompilationSource; sort?: CompilationSort; /** Member paths in the order the user set; kept while another sort is chosen. */ manualOrder?: string[]; });
/** What the browser holds of a notebook's compilations. */
export interface CompilationPage {
  rows: CompilationRow[];
}

/** One-line reason for the first few issues, naming the offending field. */
function describeIssues(error: z.ZodError): string {
  return error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || 'file'}: ${issue.message}`).join('; ');
}

export class CompilationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompilationError';
  }
}

const within = (file: string, root: string) => file === root || file.startsWith(root + '/');
const stripSlash = (value: string) => value.replace(/\/+$/, '');

/**
 * Parses a compilation file. `scope` holds the roots of every notebook in the compilation's repository: items may
 * name a path in any of them (a path in none renders missing), while a dynamic folder source must lie in one.
 * Throws `CompilationError` naming the problem.
 */
export function parseCompilation(raw: string, scope?: readonly string[]): CompilationFile {
  if (new TextEncoder().encode(raw).length > COMPILATION_MAX_BYTES) throw new CompilationError('Compilation file exceeds 512 KiB');
  let value: unknown;
  try {
    value = YAML.parse(raw, { maxAliasCount: 20 });
  } catch (error) {
    throw new CompilationError(`Invalid YAML: ${(error as Error).message.split('\n')[0]}`);
  }
  const parsed = CompilationFileSchema.safeParse(value);
  if (!parsed.success) throw new CompilationError(describeIssues(parsed.error));
  const file = parsed.data;
  if (scope !== undefined && file.source?.kind === 'folder') {
    const roots = scope.map(stripSlash);
    const folder = file.source.path;
    if (!roots.some(root => within(folder, root))) throw new CompilationError(`${folder} is outside every notebook of the repository`);
  }
  return file;
}

export function serializeCompilation(file: CompilationFile): string {
  const { version, id, title, arrangement, size, tags, status, items, source, sort, manualOrder, study, progression, graph } = file;
  const ordered = { version, id, title, arrangement, ...(size ? { size } : {}), ...(tags?.length ? { tags } : {}), ...(status ? { status } : {}), ...(items ? { items } : {}), ...(source ? { source } : {}), ...(sort ? { sort } : {}), ...(manualOrder?.length ? { manualOrder } : {}), ...(study ? { study } : {}), ...(progression ? { progression } : {}), ...(graph ? { graph } : {}) };
  return YAML.stringify(ordered, { lineWidth: 0 });
}

/**
 * The lane model of a stored compilation: arrangement and size fold into `view`, and items carry their notebook.
 * `notebookOf` names the notebook of the compilation's repository that holds a path; a path in none falls back to
 * the owner's notebook, where its lookup misses and the item renders missing.
 */
export function compilationRow(file: CompilationFile, owner: { notebookId: string; path: string; }, notebookOf: (path: string) => string | undefined = () => undefined): CompilationRow {
  const notebookAt = (path: string) => notebookOf(path) ?? owner.notebookId;
  const view: CompilationView = file.arrangement === 'lane' ? file.size ?? 'small' : file.arrangement;
  const base = { id: file.id, name: file.title, notebookId: owner.notebookId, path: owner.path, view, ...(file.size ? { size: file.size } : {}), ...(file.tags?.length ? { tags: file.tags } : {}), ...(file.status ? { status: file.status } : {}), ...(file.graph ? { graph: file.graph } : {}), ...(file.progression ? { progression: file.progression } : {}), ...(file.study ? { study: file.study } : {}) };
  if (file.items) {
    return { ...base, kind: 'custom', items: file.items.map(item => item.kind === 'youtube' || item.kind === 'heading' ? item : { ...item, notebookId: notebookAt(item.path) }) };
  }
  const source = file.source!;
  return { ...base, kind: 'dynamic', source: source.kind === 'tag' ? { ...source, notebookId: owner.notebookId } : { ...source, notebookId: notebookAt(source.path) }, ...(file.sort ? { sort: file.sort } : {}), ...(file.manualOrder?.length ? { manualOrder: file.manualOrder } : {}) };
}

/** The stored form of a lane model; the inverse of `compilationRow`. */
export function compilationFile(row: CompilationRow): CompilationFile {
  const lane = row.view !== 'graph' && row.view !== 'book';
  const size = lane ? row.view as CompilationFile['size'] : row.size;
  const common = { version: 1 as const, id: row.id, title: row.name, arrangement: lane ? 'lane' as const : row.view as 'graph' | 'book', ...(size ? { size } : {}), ...(row.tags?.length ? { tags: row.tags } : {}), ...(row.status ? { status: row.status } : {}), ...(row.study ? { study: row.study } : {}), ...(row.progression ? { progression: row.progression } : {}), ...(row.graph ? { graph: row.graph } : {}) };
  if (row.kind === 'custom') return { ...common, items: row.items.map(item => item.kind === 'youtube' || item.kind === 'heading' ? item : { id: item.id, kind: item.kind, path: item.path }) };
  const source = row.source.kind === 'tag' ? { kind: 'tag' as const, tag: row.source.tag } : { kind: 'folder' as const, path: row.source.path, recursive: row.source.recursive };
  return { ...common, source, ...(row.sort ? { sort: row.sort } : {}), ...(row.manualOrder?.length ? { manualOrder: row.manualOrder } : {}) };
}

export interface CompilationFields {
  title: string;
  tags: string[];
  status?: string;
  /** A bounded summary kept in listings; the file itself is the note content. */
  metadata: Record<string, unknown>;
  /** Why the file cannot open: a syntax, schema or scope problem. */
  invalid?: string;
}

/** The listing counts of pinned items: content items, and chapters only when there are any. */
function listedItems(items: readonly CompilationFileItem[]) {
  const chapterCount = items.filter(isHeadingItem).length;
  return { itemCount: items.length - chapterCount, ...(chapterCount ? { chapterCount } : {}) };
}

const fileTitle = (path: string) => path.split('/').pop()!.slice(0, -COMPILATION_SUFFIX.length);

/** The listing fields of a compilation file, tolerating an invalid one: it still carries a title and what tags and status can be read. */
export function compilationFields(raw: string, path: string, scope?: readonly string[]): CompilationFields {
  try {
    const file = parseCompilation(raw, scope);
    return { title: file.title, tags: file.tags ?? [], status: file.status, metadata: { id: file.id, title: file.title, arrangement: file.arrangement, ...(file.size ? { size: file.size } : {}), ...(file.items ? listedItems(file.items) : { sourceKind: file.source!.kind }), ...(file.tags?.length ? { tags: file.tags } : {}), ...(file.status ? { status: file.status } : {}) } };
  } catch (error) {
    let value: unknown;
    try {
      value = YAML.parse(raw, { maxAliasCount: 20 });
    } catch { /* The file is not YAML at all. */ }
    const map = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const title = typeof map.title === 'string' && map.title.trim() ? map.title.trim().slice(0, 100) : fileTitle(path);
    const tags = Array.isArray(map.tags) ? map.tags.filter((item): item is string => typeof item === 'string') : [];
    const status = typeof map.status === 'string' ? map.status : undefined;
    return { title, tags, status, metadata: { ...(typeof map.id === 'string' ? { id: map.id } : {}), title, ...(tags.length ? { tags } : {}), ...(status ? { status } : {}) }, invalid: error instanceof Error ? error.message : String(error) };
  }
}

/** Carries the caller's `tags` and `status` into the stored file, keeping its comments and order; a file that is not a YAML mapping is returned as it is. */
export function applyCompilationMetadata(raw: string, metadata: { tags?: unknown; status?: unknown; }): string {
  const document = YAML.parseDocument(raw);
  if (document.errors.length || !YAML.isMap(document.contents)) return raw;
  const stored = document.toJS({ maxAliasCount: 20 }) as Record<string, unknown>;
  const tags = Array.isArray(metadata.tags) ? metadata.tags.map(String) : [];
  const status = typeof metadata.status === 'string' && metadata.status ? metadata.status : undefined;
  let changed = false;
  if (JSON.stringify(stored.tags ?? []) !== JSON.stringify(tags)) {
    if (tags.length) document.set('tags', tags);
    else document.delete('tags');
    changed = true;
  }
  if (stored.status !== status) {
    if (status) document.set('status', status);
    else document.delete('status');
    changed = true;
  }
  return changed ? document.toString({ lineWidth: 0 }) : raw;
}

/** Replaces only the `tags` key of a compilation file, keeping every other field, its comments and order; a file that is not a YAML mapping is returned as it is. */
export function replaceCompilationTags(raw: string, tags: readonly string[]): string {
  const document = YAML.parseDocument(raw);
  if (document.errors.length || !YAML.isMap(document.contents)) return raw;
  const stored = (document.toJS({ maxAliasCount: 20 }) as { tags?: unknown; }).tags ?? [];
  if (JSON.stringify(stored) === JSON.stringify(tags)) return raw;
  if (tags.length) document.set('tags', [...tags]);
  else document.delete('tags');
  return document.toString({ lineWidth: 0 });
}

/** Rewrites the paths a compilation pins when files or folders move; returns the new text, or null when nothing it names moved. */
export function relocateCompilation(raw: string, move: (path: string) => string): string | null {
  const document = YAML.parseDocument(raw);
  if (document.errors.length || !YAML.isMap(document.contents)) return null;
  const value = document.toJS({ maxAliasCount: 20 }) as { items?: { kind?: string; path?: unknown; }[]; source?: { kind?: string; path?: unknown; }; manualOrder?: unknown[]; graph?: { nodes?: { path?: unknown; }[]; }; };
  let changed = false;
  const update = (location: (string | number)[], current: unknown) => {
    if (typeof current !== 'string') return;
    const next = move(current);
    if (next === current) return;
    document.setIn(location, next);
    changed = true;
  };
  value.items?.forEach((item, index) => {
    if (item.kind !== 'youtube') update(['items', index, 'path'], item.path);
  });
  if (value.source?.kind === 'folder') update(['source', 'path'], value.source.path);
  if (Array.isArray(value.manualOrder)) value.manualOrder.forEach((path, index) => update(['manualOrder', index], path));
  value.graph?.nodes?.forEach((node, index) => update(['graph', 'nodes', index, 'path'], node.path));
  return changed ? document.toString({ lineWidth: 0 }) : null;
}

/** A file name stem from a title: letters and digits of any script, dashes between words. */
export function compilationSlug(name: string): string {
  const slug = name.normalize('NFKC').toLowerCase().replace(/[\s_]+/g, '-').replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '');
  return slug || 'compilation';
}

/** `<dir>/<stem>.compilation.yml`, suffixed `-2`, `-3` … until `taken` does not hold it. */
export function uniqueCompilationPath(directory: string, stem: string, taken: (path: string) => boolean): string {
  const base = directory ? directory.replace(/\/$/, '') + '/' : '';
  let path = `${base}${stem}${COMPILATION_SUFFIX}`;
  for (let n = 2; taken(path); n++) path = `${base}${stem}-${n}${COMPILATION_SUFFIX}`;
  return path;
}

const newItemId = () => globalThis.crypto.randomUUID();

/** The copy of a compilation: title `<title> copy`, a fresh identity and fresh item ids. `usedIds` are the ids already in the repository. */
export function copyCompilation(file: CompilationFile, usedIds: Iterable<string>, makeId: () => string = newItemId): CompilationFile {
  const used = new Set(usedIds);
  let next = `${file.id}-copy`.slice(0, 64);
  for (let n = 2; used.has(next); n++) next = `${file.id.slice(0, 64 - String(n).length - 6)}-copy-${n}`;
  const title = `${file.title} copy`.length <= 100 ? `${file.title} copy` : `${file.title.slice(0, 95).trimEnd()} copy`;
  return { ...file, id: next, title, ...(file.items ? { items: file.items.map(item => ({ ...item, id: makeId() })) } : {}) };
}

/** The file a copy of `path` is written to: `<name>-copy.compilation.yml` beside it. */
export function compilationCopyPath(path: string, taken: (path: string) => boolean): string {
  const slash = path.lastIndexOf('/');
  return uniqueCompilationPath(path.slice(0, Math.max(slash, 0)), `${fileTitle(path)}-copy`, taken);
}

interface MemberNote {
  notebookId: string;
  path: string;
  status?: string;
  tags: string[];
  metadata: Record<string, unknown>;
}
/** Membership is shared by lane cards and graph views; folder shortcuts stay shortcuts. A pinned note matches by its own notebook and path, a dynamic member by the source's notebook. */
export function compilationNotes<T extends MemberNote>(row: CompilationRow, notes: T[]): T[] {
  return notes.filter(note => {
    if (row.study?.status && note.status !== row.study.status) return false;
    if (row.kind === 'custom') return row.items.some(item => item.kind === 'note' && item.path === note.path && item.notebookId === note.notebookId);
    const source = row.source;
    if (note.notebookId !== source.notebookId) return false;
    if (isNoteHidden({ ...note.metadata, status: note.status })) return false;
    if (source.kind === 'tag') return note.tags.includes(source.tag);
    return note.path.startsWith(source.path + '/') && (source.recursive || !note.path.slice(source.path.length + 1).includes('/'));
  });
}
export function compilationNotePaths<T extends MemberNote>(row: CompilationRow, notes: T[]): string[] {
  return compilationNotes(row, notes).map(note => note.path);
}

/** The repository a notebook key names; a bare local id stands for itself. */
const repositoryOf = (notebookId: string) => parseNotebookKey(notebookId)?.alias ?? notebookId;

/** Moves a pinned item between custom compilations of one repository, whichever of its notebooks they live in. */
export function moveCompilationItem(page: CompilationPage, itemId: string, targetRowId: string, index: number, sameRepository: (a: string, b: string) => boolean = (a, b) => repositoryOf(a) === repositoryOf(b)): CompilationPage {
  const source = page.rows.find(row => row.kind === 'custom' && row.items.some(item => item.id === itemId));
  const target = page.rows.find(row => row.id === targetRowId);
  if (source?.kind !== 'custom' || target?.kind !== 'custom') throw new Error('Only custom compilations accept moved items');
  if (!sameRepository(source.notebookId, target.notebookId)) throw new Error('Items stay inside their repository');
  const item = source.items.find(item => item.id === itemId)!;
  // A heading's items would not travel with it, so it stays in its compilation; within it, it moves alone.
  if (source.id !== target.id && item.kind === 'heading') throw new Error('Chapter headings stay in their compilation');
  if (source.id !== target.id && contentItems(target.items).length >= COMPILATION_MAX_ITEMS) throw new Error('Compilation has too many pinned items');
  const rows = page.rows.map(row => {
    if (row.kind !== 'custom') return row;
    const items = row.items.filter(item => item.id !== itemId);
    if (row.id === targetRowId) items.splice(Math.max(0, Math.min(index, items.length)), 0, item);
    return { ...row, items };
  });
  return { ...page, rows };
}

export function parseYouTubeUrl(value: string): { videoId: string; start: number; } | null {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    let videoId = '';
    if (host === 'youtu.be') videoId = url.pathname.slice(1);
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(host)) {
      videoId = url.pathname === '/watch' ? url.searchParams.get('v') || '' : url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})\/?$/)?.[1] || '';
    }
    if (!/^[\w-]{11}$/.test(videoId)) return null;
    const time = url.searchParams.get('start') || url.searchParams.get('t') || '0';
    const match = time.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    const seconds = /^\d+$/.test(time) ? Number(time) : match ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) : 0;
    return { videoId, start: Math.min(seconds, 86400) };
  } catch {
    return null;
  }
}
