import type { NotebookConfig, NotebookStatus, NoteMetadata, StatusColorName } from './types.js';

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

/** Palette order for statuses without a colour of their own; the first custom ones avoid the green, blue and amber of the known names. */
const STATUS_CYCLE: readonly StatusColorName[] = ['purple', 'teal', 'pink', 'red', 'gray', 'green', 'blue', 'amber'];

const KNOWN_STATUS_COLORS: Readonly<Record<string, StatusColor>> = { done: 'green', working: 'blue', doing: 'blue', 'in-progress': 'blue', todo: 'amber', inbox: 'primary', archived: 'muted' };

const explicitColor = (entry: NotebookStatus) => typeof entry === 'string' ? undefined : entry.color;

const normalizeStatus = (status: string) => status.trim().toLowerCase();

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
 * doing, in-progress, todo, inbox, archived) keeps its familiar colour; otherwise a listed status takes the
 * palette by its position in the list, and a status that is not listed stays muted.
 */
export function statusColor(status: string, notebookStatuses: readonly NotebookStatus[] = []): StatusColor {
  const entries = notebookStatuses;
  let index = entries.findIndex(entry => noteStatusName(entry) === status);
  if (index === -1) index = entries.findIndex(entry => normalizeStatus(noteStatusName(entry)) === normalizeStatus(status));
  const entry = index === -1 ? undefined : entries[index];
  const given = entry && explicitColor(entry);
  if (given) return given;
  const known = Object.hasOwn(KNOWN_STATUS_COLORS, normalizeStatus(status)) ? KNOWN_STATUS_COLORS[normalizeStatus(status)] : undefined;
  if (known) return known;
  return index === -1 ? 'muted' : STATUS_CYCLE[index % STATUS_CYCLE.length];
}

/** The statuses of several notebooks as one list: first occurrence of a name keeps its place, the first colour given to a name wins, and a notebook without statuses contributes the defaults. */
export function mergeNotebookStatuses(notebooks: readonly Pick<NotebookConfig, 'statuses'>[]): NotebookStatus[] {
  const merged = new Map<string, NotebookStatus>();
  for (const notebook of notebooks) {
    for (const entry of configuredNotebookStatuses(notebook)) {
      const name = noteStatusName(entry);
      const current = merged.get(name);
      if (current === undefined || (!explicitColor(current) && explicitColor(entry))) merged.set(name, entry);
    }
  }
  return [...merged.values()];
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
