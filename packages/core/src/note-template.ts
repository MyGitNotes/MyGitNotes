import type { NotebookConfig, NoteMetadata } from './types.js';

/**
 * Note templates without any file access, so the web app renders them too. A notebook's templates are the Markdown files
 * directly in `<root>/.templates/` and the ones its manifest registers; a template's frontmatter may carry a `template:`
 * block (name, description, path pattern, placeholder descriptions and defaults) that never reaches a created note.
 */

/** The folder at a notebook's root whose `*.md` files are its templates. */
export const TEMPLATES_FOLDER = '.templates';
// A backslash or a control character is no part of a template's name: a backslash would reach a subfolder on a path the file system resolves.
// eslint-disable-next-line no-control-regex -- Control characters are refused, not matched.
const TEMPLATE_FILE = /^\.templates\/([^/\\\x00-\x1f\x7f]+)\.md$/;
const PLACEHOLDER_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const placeholders = () => /\{\{\s*([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}/g;
const NOTE_FILE = /\.(md|markdown|mdx|txt)$/i;
/** Frontmatter keys that describe the template file itself (the editor stamps them on every save), so a created note starts without them. */
const FILE_KEYS = ['id', 'created', 'updated'];

/** The placeholders every template has, filled without being declared. */
export const BUILTIN_PLACEHOLDERS: Readonly<Record<'title' | 'date' | 'time', string>> = { title: "The new note's title.", date: 'The date the note is created, as YYYY-MM-DD.', time: 'The time the note is created, as HH:mm.' };
const isBuiltin = (name: string) => Object.hasOwn(BUILTIN_PLACEHOLDERS, name);

/** A request that names a template, a value or a path the template cannot serve; its message is for the caller. */
export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

/** Formats a date as `YYYY-MM-DD` for the `{{date}}` placeholder, from the server's clock in UTC. */
export function formatTemplateDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Formats a time as `HH:mm` for the `{{time}}` placeholder, in UTC as `formatTemplateDate` does. */
export function formatTemplateTime(now: Date = new Date()): string {
  return now.toISOString().slice(11, 16);
}

/** The reader's own date and time, which the web app fills `{{date}}` and `{{time}}` with. */
export function localTemplateClock(now: Date = new Date()): { date: string; time: string; } {
  const two = (value: number) => String(value).padStart(2, '0');
  return { date: `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`, time: `${two(now.getHours())}:${two(now.getMinutes())}` };
}

/**
 * The id of the template a notebook-relative path names when it lies directly in `.templates/`: the file name without
 * `.md`. A subfolder, another extension or a dot file names none.
 */
export function templateFileId(relative: string): string | undefined {
  const id = TEMPLATE_FILE.exec(relative)?.[1];
  return id && !id.startsWith('.') && id.trim() === id ? id : undefined;
}

/** The notebook a repository-relative path is a `.templates/` template file of. */
export function templateFileNotebook<N extends Pick<NotebookConfig, 'root'>>(file: string, notebooks: readonly N[]): N | undefined {
  return notebooks.find(notebook => file.startsWith(`${notebook.root}/`) && templateFileId(file.slice(notebook.root.length + 1)) !== undefined);
}

/** A text made safe as one file name: `/`, `\` and the characters a file system refuses become `-`, and it starts with no dot. */
export function safeFileName(value: string): string {
  // eslint-disable-next-line no-control-regex -- Control characters cannot be part of a file name.
  return value.replace(/[/\\:*?"<>|\x00-\x1f\x7f]/g, '-').replace(/\s+/g, ' ').trim().replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
}

/** The repository-relative path of the `.templates/` file a template named `name` is kept in. */
export function templateFilePath(notebook: Pick<NotebookConfig, 'root'>, name: string): string {
  const stem = safeFileName(name);
  if (!stem) throw new TemplateError('A template needs a name.');
  return `${notebook.root}/${TEMPLATES_FOLDER}/${stem}.md`;
}

export interface TemplatePlaceholderSetting {
  description?: string;
  default?: string;
}

/** A template's `template:` frontmatter block, read leniently: a key of the wrong shape is left out. */
export interface TemplateSettings {
  name?: string;
  description?: string;
  /** The created note's path pattern, relative to the notebook root. */
  path?: string;
  placeholders: Record<string, TemplatePlaceholderSetting>;
}

const scalar = (value: unknown): string | undefined => typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined;

export function templateSettings(metadata: NoteMetadata | undefined): TemplateSettings {
  const settings: TemplateSettings = { placeholders: {} };
  const block = metadata?.template;
  if (!block || typeof block !== 'object' || Array.isArray(block)) return settings;
  const { name, description, path, placeholders: declared } = block as Record<string, unknown>;
  if (typeof name === 'string' && name.trim()) settings.name = name.trim();
  if (typeof description === 'string' && description.trim()) settings.description = description.trim();
  if (typeof path === 'string' && path.trim()) settings.path = path.trim();
  if (declared && typeof declared === 'object' && !Array.isArray(declared)) {
    for (const [key, value] of Object.entries(declared)) {
      if (!PLACEHOLDER_NAME.test(key)) continue;
      const fields: Record<string, unknown> = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : { description: value };
      const placeholder: TemplatePlaceholderSetting = {};
      const text = scalar(fields.description), fallback = scalar(fields.default);
      if (text !== undefined && text.trim()) placeholder.description = text.trim();
      if (fallback !== undefined) placeholder.default = fallback;
      settings.placeholders[key] = placeholder;
    }
  }
  return settings;
}

/** A template's frontmatter without its `template:` block: the keys a created note receives. */
function noteFrontmatter(metadata: NoteMetadata): NoteMetadata {
  const { template: _template, ...rest } = metadata;
  return rest;
}

function eachString(value: unknown, visit: (text: string) => void): void {
  if (typeof value === 'string') visit(value);
  else if (Array.isArray(value)) { for (const item of value) eachString(item, visit); }
  else if (value && typeof value === 'object') { for (const item of Object.values(value)) eachString(item, visit); }
}

export interface TemplatePlaceholder {
  name: string;
  description?: string;
  default?: string;
  /** Whether the template's `template.placeholders` names it. */
  declared: boolean;
  /** Present on `title`, `date` and `time`, which are filled without a value. */
  builtin?: true;
}

/** A template's placeholders: the built-in ones, the declared ones in their order, then every other `{{name}}` of its path pattern, frontmatter and body. */
export function templatePlaceholders(template: { metadata: NoteMetadata; content: string; }): TemplatePlaceholder[] {
  const settings = templateSettings(template.metadata);
  const found = new Map<string, TemplatePlaceholder>();
  for (const [name, description] of Object.entries(BUILTIN_PLACEHOLDERS)) found.set(name, { name, description, declared: Object.hasOwn(settings.placeholders, name), builtin: true });
  for (const [name, setting] of Object.entries(settings.placeholders)) if (!isBuiltin(name)) found.set(name, { name, ...setting, declared: true });
  const scan = (text: string) => {
    for (const match of text.matchAll(placeholders())) if (!found.has(match[1])) found.set(match[1], { name: match[1], declared: false });
  };
  if (settings.path) scan(settings.path);
  eachString(noteFrontmatter(template.metadata), scan);
  scan(template.content);
  return [...found.values()];
}

export interface TemplateVariables {
  title: string;
  date: string;
  time?: string;
  /** Placeholder values by name; one wins over the built-in and the declared default of its name. */
  values?: Record<string, string>;
  /**
   * Whether a placeholder without a value takes its declared default; true unless said otherwise. The app's New note menu
   * passes false: it fills the title, date and time only, and leaves every other placeholder as written for the writer.
   */
  defaults?: boolean;
}

/** What fills a placeholder: a given value, then the built-in one, then the declared default; undefined leaves the placeholder as it is written. */
function resolver(template: { metadata: NoteMetadata; }, vars: Omit<TemplateVariables, 'title'> & { title?: string; }): (name: string) => string | undefined {
  const settings = templateSettings(template.metadata);
  const builtins: Record<string, string | undefined> = { title: vars.title, date: vars.date, time: vars.time };
  return name => vars.values && Object.hasOwn(vars.values, name) ? vars.values[name] : isBuiltin(name) && builtins[name] !== undefined ? builtins[name] : vars.defaults === false ? undefined : settings.placeholders[name]?.default;
}

function substitute(value: unknown, resolve: (name: string) => string | undefined, unfilled: Set<string>): unknown {
  if (typeof value === 'string') {
    // A replacer function keeps `$` in a value literal.
    return value.replace(placeholders(), (written, name: string) => {
      const filled = resolve(name);
      if (filled === undefined) unfilled.add(name);
      return filled ?? written;
    });
  }
  if (Array.isArray(value)) return value.map(item => substitute(item, resolve, unfilled));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, resolve, unfilled)]));
  return value;
}

export interface RenderedNoteTemplate {
  metadata: NoteMetadata;
  content: string;
  /** The placeholders left in the note as their literal `{{name}}` text, for the writer to replace. */
  unfilled: string[];
}

/**
 * Fills a template's frontmatter and body for a new note. The `template:` block and the template file's own `id`,
 * `created` and `updated` stay behind; the metadata always carries the given title, matching normal note creation.
 */
export function renderNoteTemplate(template: { metadata: NoteMetadata; content: string; }, vars: TemplateVariables): RenderedNoteTemplate {
  const resolve = resolver(template, vars);
  const unfilled = new Set<string>();
  const frontmatter = noteFrontmatter(template.metadata);
  for (const key of FILE_KEYS) {
    const value = frontmatter[key];
    if (!(typeof value === 'string' && placeholders().test(value))) delete frontmatter[key];
  }
  const metadata = substitute(frontmatter, resolve, unfilled) as NoteMetadata;
  const content = substitute(template.content, resolve, unfilled) as string;
  return { metadata: { ...metadata, title: vars.title }, content, unfilled: [...unfilled] };
}

/**
 * The values a caller gave for a template, as text by placeholder name. A value that names no placeholder of the template
 * is refused with the names it has, so a misspelled name never passes silently.
 */
export function templateValues(template: { metadata: NoteMetadata; content: string; }, values: unknown): Record<string, string> {
  if (values === undefined || values === null) return {};
  if (typeof values !== 'object' || Array.isArray(values)) throw new TemplateError('values must be an object of placeholder values.');
  const known = templatePlaceholders(template).map(placeholder => placeholder.name);
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    if (!known.includes(name)) throw new TemplateError(`The template has no placeholder '${name}'. Its placeholders: ${known.join(', ')}.`);
    const text = scalar(value);
    if (text === undefined) throw new TemplateError(`The value of '${name}' must be text.`);
    result[name] = text;
  }
  return result;
}

/**
 * The created note's path from the template's `path` pattern, relative to the notebook root, or undefined when the
 * template declares none. Each value is made safe as a file name; a placeholder without a value refuses the path.
 */
export function renderTemplatePath(template: { metadata: NoteMetadata; }, vars: Omit<TemplateVariables, 'title'> & { title?: string; }): string | undefined {
  const pattern = templateSettings(template.metadata).path;
  if (!pattern) return undefined;
  const resolve = resolver(template, vars);
  const missing = new Set<string>();
  const filled = pattern.replace(placeholders(), (written, name: string) => {
    const value = safeFileName(resolve(name) ?? '');
    if (!value) missing.add(name);
    return value || written;
  });
  if (missing.size) throw new TemplateError(`The template's path '${pattern}' needs a value for ${[...missing].join(', ')}.`);
  const path = NOTE_FILE.test(filled) ? filled : `${filled}.md`;
  if (path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new TemplateError(`The template's path '${pattern}' does not name a file inside the notebook.`);
  return path;
}

/** One template of a notebook as the manifest or the `.templates/` folder names it; `file` is relative to the notebook root. */
export interface NoteTemplateEntry {
  id: string;
  source: 'file' | 'manifest';
  file: string;
  /** The manifest's title of a registered template. */
  title?: string;
}

/**
 * A notebook's templates: the manifest's first, then the `.templates/` files (given relative to the notebook root) that
 * no manifest entry names, by id. On an id clash the manifest entry wins.
 */
export function notebookTemplateEntries(notebook: Pick<NotebookConfig, 'templates'>, files: readonly string[]): NoteTemplateEntry[] {
  const registered: NoteTemplateEntry[] = (notebook.templates ?? []).map(template => ({ id: template.id, source: 'manifest', file: template.file, title: template.title }));
  const taken = new Set(registered.map(entry => entry.id)), named = new Set(registered.map(entry => entry.file));
  const discovered: NoteTemplateEntry[] = [];
  for (const file of files) {
    const id = templateFileId(file);
    if (id === undefined || named.has(file) || taken.has(id)) continue;
    taken.add(id);
    discovered.push({ id, source: 'file', file });
  }
  return [...registered, ...discovered.sort((a, b) => a.id.localeCompare(b.id))];
}

/** A template as `list_templates` and the app's template list describe it. */
export interface NoteTemplateInfo {
  notebookId: string;
  id: string;
  /** Shown in menus: the manifest's title, else the `template.name`, else the id. */
  name: string;
  description?: string;
  source: 'file' | 'manifest';
  /** The template file's repository-relative path. */
  file: string;
  /** The created note's path pattern, relative to the notebook root, when the template declares one. */
  path?: string;
  placeholders: TemplatePlaceholder[];
}

/** `parsed` is the template file's frontmatter and body; a registered template whose file cannot be read is described without them. */
export function describeNoteTemplate(notebook: Pick<NotebookConfig, 'id' | 'root'>, entry: NoteTemplateEntry, parsed: { metadata: NoteMetadata; content: string; } = { metadata: {}, content: '' }): NoteTemplateInfo {
  const settings = templateSettings(parsed.metadata);
  return { notebookId: notebook.id, id: entry.id, name: entry.title ?? settings.name ?? entry.id, ...(settings.description ? { description: settings.description } : {}), source: entry.source, file: `${notebook.root}/${entry.file}`, ...(settings.path ? { path: settings.path } : {}), placeholders: templatePlaceholders(parsed) };
}

/** A template as `list_templates` answers it. */
export interface ListedNoteTemplate extends NoteTemplateInfo {
  /** When a note was last created from the template, as an ISO date; null while no note of its notebook is stamped with its id. */
  lastUsed: string | null;
  /** The template file's text, frontmatter included, when the one template was asked for by id. */
  content?: string;
}

/** How many templates `list_templates` returns unless asked, and the most it returns. */
export const TEMPLATE_LIST_LIMIT = 20;
export const TEMPLATE_LIST_MAX = 100;

export interface TemplateList<T extends ListedNoteTemplate = ListedNoteTemplate> {
  templates: T[];
  /** The templates that matched, before the limit. */
  total: number;
  truncated: boolean;
}

/** A frontmatter date as milliseconds; YAML reads an unquoted one as a date and a quoted one as text. */
function dateOf(value: unknown): number | undefined {
  const time = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? undefined : time;
}

/**
 * When each template of a notebook was last used, by template id: the newest `created` (else `updated`) date among the
 * notes whose frontmatter says `template: <id>`. It reads frontmatter only, so a notes index answers it without a body.
 */
/** A template's last use from {@link templateLastUse}'s answer, which may come back from a cache as a plain object, so an id such as `constructor` reads no inherited property. */
export function lastUseOf(used: Record<string, string>, id: string): string | null {
  return Object.hasOwn(used, id) ? used[id]! : null;
}

export function templateLastUse(notes: Iterable<{ metadata: NoteMetadata; }>): Record<string, string> {
  const newest = new Map<string, number>();
  for (const { metadata } of notes) {
    // In a note `template` is the id it was created from; the block of that name belongs to a template file.
    const id = scalar(metadata.template);
    const used = dateOf(metadata.created) ?? dateOf(metadata.updated);
    if (id === undefined || used === undefined) continue;
    if (used > (newest.get(id) ?? -Infinity)) newest.set(id, used);
  }
  return Object.fromEntries([...newest].map(([id, used]) => [id, new Date(used).toISOString()]));
}

/** The most recently used first, then the never-used by name. */
function byLastUse(a: ListedNoteTemplate, b: ListedNoteTemplate): number {
  if (a.lastUsed !== b.lastUsed) return a.lastUsed === null ? 1 : b.lastUsed === null ? -1 : b.lastUsed.localeCompare(a.lastUsed);
  return a.name.localeCompare(b.name) || a.notebookId.localeCompare(b.notebookId) || a.id.localeCompare(b.id);
}

function listLimit(limit: unknown): number {
  if (limit === undefined || limit === null) return TEMPLATE_LIST_LIMIT;
  if (typeof limit !== 'number' || !Number.isFinite(limit)) throw new TemplateError(`limit must be a number from 1 to ${TEMPLATE_LIST_MAX}.`);
  return Math.min(TEMPLATE_LIST_MAX, Math.max(1, Math.floor(limit)));
}

/**
 * The templates a caller asked for: the ones whose id, name or description holds every word of `query` (whatever the
 * case), the most recently used first, cut at `limit`.
 */
export function listTemplates<T extends ListedNoteTemplate>(templates: readonly T[], request: { query?: unknown; limit?: unknown; } = {}): TemplateList<T> {
  if (request.query !== undefined && request.query !== null && typeof request.query !== 'string') throw new TemplateError('query must be text.');
  const words = (request.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const matched = templates.filter(template => {
    const text = `${template.id}\n${template.name}\n${template.description ?? ''}`.toLowerCase();
    return words.every(word => text.includes(word));
  }).sort(byLastUse);
  const listed = matched.slice(0, listLimit(request.limit));
  return { templates: listed, total: matched.length, truncated: listed.length < matched.length };
}

/** The lists of several repositories, each already filtered and cut at `limit`, as one list in the same order. */
export function mergeTemplateLists<T extends ListedNoteTemplate>(lists: readonly TemplateList<T>[], limit?: unknown): TemplateList<T> {
  const templates = lists.flatMap(list => list.templates).sort(byLastUse).slice(0, listLimit(limit));
  const total = lists.reduce((sum, list) => sum + list.total, 0);
  return { templates, total, truncated: templates.length < total };
}

/** The frontmatter and body a new template named `name` starts with. */
export function starterTemplate(name: string): { metadata: NoteMetadata; content: string; } {
  return { metadata: { template: { name, description: '' } }, content: '# {{title}}\n' };
}

/** A note as a template named after it: its frontmatter and body under a `template:` block, without the keys that are the note file's own. */
export function templateFromNote(note: { title: string; metadata: NoteMetadata; content: string; }): { metadata: NoteMetadata; content: string; } {
  const frontmatter = noteFrontmatter(note.metadata);
  for (const key of FILE_KEYS) delete frontmatter[key];
  return { metadata: { template: { name: note.title }, ...frontmatter }, content: note.content };
}

/** What a caller asks when it creates a note from a template: the caller's `content` and `metadata` win over the template's. */
export interface TemplateNoteRequest {
  /** The template's id, which the note records as `template`. */
  templateId: string;
  /** The note's repository-relative path; left out, the template's `path` pattern names it. */
  path?: string;
  title?: string;
  values?: unknown;
  content?: string;
  metadata?: NoteMetadata;
  /** The clock `{{date}}` and `{{time}}` read when no value names them. */
  now?: Date;
  /** The date and time to fill in place of that clock's UTC reading, as a page gives its reader's own. */
  clock?: { date: string; time: string; };
}

export interface TemplateNote {
  /** Repository-relative. */
  path: string;
  title: string;
  metadata: NoteMetadata;
  content: string;
  /** The placeholders the note still holds as literal `{{name}}` text. */
  unfilled: string[];
}

/**
 * The note a template makes for a caller that fills it by name, as `save_note` with `template` does. The title is the
 * given one (`title`, else the `title` value), else the file name of the path; a path the pattern cannot fill is refused.
 * Its frontmatter carries `template: <id>`, which dates the template's last use.
 */
export function noteFromTemplate(notebook: Pick<NotebookConfig, 'root'>, template: { metadata: NoteMetadata; content: string; }, request: TemplateNoteRequest): TemplateNote {
  const values = templateValues(template, request.values);
  const now = request.now ?? new Date();
  const clock = request.clock ?? { date: formatTemplateDate(now), time: formatTemplateTime(now) };
  const given = request.title ?? (Object.hasOwn(values, 'title') ? values.title : undefined);
  const patterned = request.path === undefined ? renderTemplatePath(template, { ...clock, title: given, values }) : undefined;
  if (request.path === undefined && patterned === undefined) throw new TemplateError('path is required: the template declares no path pattern.');
  const path = request.path ?? `${notebook.root}/${patterned}`;
  const title = given ?? path.slice(path.lastIndexOf('/') + 1).replace(NOTE_FILE, '');
  const rendered = renderNoteTemplate(template, { ...clock, title, values });
  // The note records the template it came from; in a note `template` is this id, never the block of a template file.
  const note = { metadata: { ...rendered.metadata, ...request.metadata, template: request.templateId }, content: request.content ?? rendered.content };
  // The caller's own body or frontmatter may have replaced the text a placeholder stood in.
  const left = new Set<string>();
  const scan = (text: string) => {
    for (const match of text.matchAll(placeholders())) left.add(match[1]);
  };
  eachString(note.metadata, scan);
  scan(note.content);
  return { path, title, ...note, unfilled: rendered.unfilled.filter(name => left.has(name)) };
}
