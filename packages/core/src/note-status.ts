import type { NotebookConfig, NotebookStatus, NoteMetadata, StatusColorName, StatusLabel } from './types.js';

export const DEFAULT_NOTE_STATUSES: readonly string[] = ['inbox', 'working', 'done', 'archived'];

/** The persisted hiden boolean wins; legacy archived notes default to hidden. */
export function isNoteHidden(metadata: NoteMetadata): boolean {
  return typeof metadata.hiden === 'boolean' ? metadata.hiden : metadata.status === 'archived';
}

/** Explicit status actions archive/unarchive while preserving other metadata. */
export function withNoteStatus(metadata: NoteMetadata, status: string): NoteMetadata {
  return { ...metadata, status: status || undefined, ...(status === 'archived' ? { hiden: true } : metadata.status === 'archived' ? { hiden: false } : {}) };
}

export interface NoteMetadataEdits {
  status?: string;
  tags?: string[];
  title?: string;
}

/** Applies the status, tags and title edits a caller supplied; omitted fields keep their current values. */
export function withNoteEdits(metadata: NoteMetadata, edits: NoteMetadataEdits): NoteMetadata {
  const next = edits.status === undefined ? { ...metadata } : withNoteStatus(metadata, edits.status);
  if (edits.tags !== undefined) next.tags = edits.tags;
  if (edits.title !== undefined) next.title = edits.title;
  return next;
}

/** The palette names a notebook status may use, in the order the config error lists them. */
export const STATUS_COLOR_NAMES: readonly StatusColorName[] = ['green', 'blue', 'amber', 'red', 'purple', 'teal', 'pink', 'gray'];

/** What a status dot wears: a palette colour, the theme's primary for an inbox, or muted gray for an unlisted or archived status. */
export type StatusColor = StatusColorName | 'primary' | 'muted';

/**
 * Palette order for custom statuses without a colour of their own; the first ones avoid the green, blue and amber of the
 * known names. Gray is for explicit use only, so a cycled status never looks like a stray muted one. Pink and red are kept
 * two places apart, so they stay apart whichever single colour a theme skips.
 */
export const STATUS_CYCLE: readonly StatusColorName[] = ['purple', 'teal', 'pink', 'blue', 'green', 'red', 'amber'];

const KNOWN_STATUS_COLORS: Readonly<Record<string, StatusColor>> = { done: 'green', working: 'blue', doing: 'blue', 'in-progress': 'blue', todo: 'amber', inbox: 'primary', archived: 'muted' };

const explicitColor = (entry: NotebookStatus) => typeof entry === 'string' ? undefined : entry.color;

const normalizeStatus = (status: string) => status.trim().toLowerCase();

const explicitLabel = (entry: NotebookStatus) => typeof entry === 'string' ? undefined : entry.label;

/** The names the four default statuses go by in each UI language, used when a manifest gives a status no label. */
export const BUILTIN_STATUS_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = { inbox: { en: 'inbox', 'zh-TW': '收件匣' }, working: { en: 'working', 'zh-TW': '進行中' }, done: { en: 'done', 'zh-TW': '完成' }, archived: { en: 'archived', 'zh-TW': '封存' } };

/** The text a label gives one UI language: the exact tag, the tag ignoring case, then its primary language (`zh` for `zh-TW`). */
function labelFor(label: StatusLabel, language: string): string | undefined {
  if (typeof label === 'string') return label;
  const lower = language.toLowerCase();
  const keys = Object.keys(label);
  const key = keys.find(candidate => candidate === language) ?? keys.find(candidate => candidate.toLowerCase() === lower) ?? keys.find(candidate => candidate.toLowerCase() === lower.split('-')[0]);
  return key === undefined ? undefined : label[key];
}

/**
 * What a status is called on screen in a UI language. The notebook's own label for the status wins; without one for this
 * language a default status uses its built-in name, and anything else shows its stored name, which stays what a note's
 * `status:` holds. The status is matched to a list entry the way its colour is: exactly, then ignoring case.
 */
export function statusLabel(status: string, notebookStatuses: readonly NotebookStatus[] = [], language = 'en'): string {
  const entries = notebookStatuses;
  const entry = entries.find(candidate => noteStatusName(candidate) === status) ?? entries.find(candidate => normalizeStatus(noteStatusName(candidate)) === normalizeStatus(status));
  const given = entry && explicitLabel(entry);
  const own = given === undefined ? undefined : labelFor(given, language);
  if (own !== undefined) return own;
  const builtin = isKnownStatus(status) && Object.hasOwn(BUILTIN_STATUS_LABELS, normalizeStatus(status)) ? labelFor(BUILTIN_STATUS_LABELS[normalizeStatus(status)], language) : undefined;
  return builtin ?? status;
}

const isKnownStatus = (status: string) => Object.hasOwn(KNOWN_STATUS_COLORS, normalizeStatus(status));

/** The name of one `statuses` entry, whichever form it was written in. */
export function noteStatusName(entry: NotebookStatus): string {
  return typeof entry === 'string' ? entry : entry.name;
}

/** The names of a `statuses` list, for everything that needs only the vocabulary. */
export function noteStatusNames(statuses: readonly NotebookStatus[] = []): string[] {
  return statuses.map(noteStatusName);
}

/** A notebook's configured statuses as written, or the defaults when it defines none. */
export function configuredNotebookStatuses(notebook?: Pick<NotebookConfig, 'statuses'>): readonly NotebookStatus[] {
  return notebook?.statuses?.length ? notebook.statuses : DEFAULT_NOTE_STATUSES;
}

/** A notebook's configured status names, or the defaults when it defines none. */
export function configuredNoteStatuses(notebook?: Pick<NotebookConfig, 'statuses'>): readonly string[] {
  return noteStatusNames(configuredNotebookStatuses(notebook));
}

/**
 * The colour of a status dot. A colour the notebook gives the status wins; then a known name (done, working,
 * doing, in-progress, todo, inbox, archived) keeps its familiar colour; otherwise a listed status takes the cycle by
 * its position among the custom (non-known-name) entries of its own list, and a status that is not listed stays muted.
 * `avoid` is a cycle colour to skip, the one a theme already uses for its primary, which an inbox wears.
 */
export function statusColor(status: string, notebookStatuses: readonly NotebookStatus[] = [], avoid?: StatusColorName): StatusColor {
  const entries = notebookStatuses;
  let index = entries.findIndex(entry => noteStatusName(entry) === status);
  if (index === -1) index = entries.findIndex(entry => normalizeStatus(noteStatusName(entry)) === normalizeStatus(status));
  const entry = index === -1 ? undefined : entries[index];
  const given = entry && explicitColor(entry);
  if (given) return given;
  if (isKnownStatus(status)) return KNOWN_STATUS_COLORS[normalizeStatus(status)];
  if (index === -1) return 'muted';
  const cycle = STATUS_CYCLE.filter(color => color !== avoid);
  return cycle[entries.slice(0, index).filter(earlier => !isKnownStatus(noteStatusName(earlier))).length % cycle.length];
}

/**
 * The statuses of several notebooks as one list. Each custom status without a colour is resolved against its own
 * notebook's list, so it wears the same colour whichever notebooks are listed and in what order. A name keeps the
 * colour the first notebook defining it gives, except that a colour written in a manifest beats a cycled one, and takes the
 * label of the first notebook that gives it one; a notebook without statuses contributes the defaults, which are all known names.
 */
export function mergeNotebookStatuses(notebooks: readonly Pick<NotebookConfig, 'statuses'>[], avoid?: StatusColorName): NotebookStatus[] {
  const merged = new Map<string, { entry: NotebookStatus; written: boolean; }>();
  const labels = new Map<string, StatusLabel>();
  for (const notebook of notebooks) {
    const entries = configuredNotebookStatuses(notebook);
    for (const entry of entries) {
      const name = noteStatusName(entry);
      const written = explicitColor(entry) !== undefined;
      const label = explicitLabel(entry);
      if (label !== undefined && !labels.has(name)) labels.set(name, label);
      const current = merged.get(name);
      if (current && (current.written || !written)) continue;
      merged.set(name, { entry: written || isKnownStatus(name) ? entry : { name, color: statusColor(name, entries, avoid) as StatusColorName }, written });
    }
  }
  return [...merged.entries()].map(([name, { entry }]) => {
    const label = labels.get(name);
    if (label === undefined || explicitLabel(entry) === label) return entry;
    return { ...(typeof entry === 'string' ? { name } : entry), label };
  });
}

/** Ordered notebook choices followed by observed extensions; metadata stays unchanged. */
export function resolveNoteStatuses(notebook?: Pick<NotebookConfig, 'statuses'>, observed: Iterable<string | undefined> = []): string[] {
  const configured = configuredNoteStatuses(notebook);
  const extensions = new Set<string>();
  for (const status of observed) {
    if (status && !configured.includes(status)) extensions.add(status);
  }
  return [...configured, ...[...extensions].sort()];
}
