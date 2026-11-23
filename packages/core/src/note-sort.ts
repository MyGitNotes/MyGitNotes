export const BUILTIN_SORT_FIELDS = ['updated', 'created', 'title', 'status'] as const;
export type BuiltinSortField = (typeof BUILTIN_SORT_FIELDS)[number];
/** Sorts by the frontmatter key after the dot, as in `metadata.date`. */
export type MetadataSortField = `metadata.${string}`;
export type SortField = BuiltinSortField | MetadataSortField;
export type SortOrder = 'asc' | 'desc';

const METADATA_SORT_PREFIX = 'metadata.';
const METADATA_SORT_KEY = /^[\p{L}\p{N}_-]+$/u;

/** Whether a value names a sort: a built-in field, or `metadata.<key>` with a key of letters, digits, `_` and `-`. */
export function isSortField(value: unknown): value is SortField {
  if (typeof value !== 'string') return false;
  if ((BUILTIN_SORT_FIELDS as readonly string[]).includes(value)) return true;
  return value.startsWith(METADATA_SORT_PREFIX) && METADATA_SORT_KEY.test(value.slice(METADATA_SORT_PREFIX.length));
}

/** The frontmatter key a `metadata.<key>` sort reads; undefined for a built-in field. */
export function metadataSortKey(field: string): string | undefined {
  return field.startsWith(METADATA_SORT_PREFIX) ? field.slice(METADATA_SORT_PREFIX.length) : undefined;
}

export interface SortableNote {
  title: string;
  status?: string;
  metadata: Record<string, unknown>;
  mtime?: number;
  /** The edit date a source resolved from Git (`edit-dates.ts`), which goes before the frontmatter `updated`. */
  updated?: string;
}

function getTimestamp(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

/**
 * The time a note was last modified: the edit date its source resolved (`updated`, from Git), else its frontmatter
 * `updated` field, else its file mtime; 0 when none is known.
 */
export function noteUpdatedTime(note: Pick<SortableNote, 'metadata' | 'mtime' | 'updated'>): number {
  return getTimestamp(note.updated ?? note.metadata?.updated, note.mtime || 0);
}

/** The time a note was created: its `created` (else `date`) field, else its file mtime; 0 when none is known. */
export function noteCreatedTime(note: Pick<SortableNote, 'metadata' | 'mtime'>): number {
  return getTimestamp(note.metadata?.created ?? note.metadata?.date, note.mtime || 0);
}

/** A frontmatter value as a sort key: a point in time, text, or nothing (absent, blank or not scalar). */
type MetadataSortValue = { kind: 'date'; time: number; } | { kind: 'text'; text: string; } | undefined;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function metadataSortValue(value: unknown): MetadataSortValue {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : { kind: 'date', time: value.getTime() };
  if (Array.isArray(value)) {
    const text = value.filter(item => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean').join(', ').trim();
    return text ? { kind: 'text', text } : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return { kind: 'text', text: String(value) };
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (ISO_DATE.test(text)) {
    const time = Date.parse(text);
    if (!Number.isNaN(time)) return { kind: 'date', time };
  }
  return { kind: 'text', text };
}

/** Dates by time, text naturally (as titles are); a date sorts before text. Positive when `a` comes after `b`. */
function compareMetadataValues(a: NonNullable<MetadataSortValue>, b: NonNullable<MetadataSortValue>): number {
  if (a.kind === 'date' && b.kind === 'date') return a.time - b.time;
  if (a.kind === 'text' && b.kind === 'text') return a.text.localeCompare(b.text, undefined, { numeric: true, sensitivity: 'base' });
  return a.kind === 'date' ? -1 : 1;
}

const compareTitles = (a: SortableNote, b: SortableNote) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Sorts notes by field and order; status sorting follows the notebook workflow order with unknown statuses last.
 * Returns a new array without mutating the original.
 */
export function sortNotes<T extends SortableNote>(notes: T[], field: SortField, order: SortOrder, statuses: string[] = []): T[] {
  const factor = order === 'asc' ? 1 : -1;
  const key = metadataSortKey(field);
  if (key !== undefined) {
    // Notes without a usable value stay last in either order; equal values fall back to the newest update.
    // A note without a `date` sorts by when it was created, as a `created` sort falls back to `date`: a note just made from a
    // template that sets no date (a pending live note among them) sorts as the newest, not among the notes nobody dated.
    const valueOf = (note: T) => metadataSortValue(note.metadata?.[key]) ?? (key === 'date' ? metadataSortValue(note.metadata?.created) : undefined);
    const values = new Map(notes.map(note => [note, valueOf(note)]));
    return [...notes].sort((a, b) => {
      const valueA = values.get(a), valueB = values.get(b);
      const byValue = valueA && valueB ? factor * compareMetadataValues(valueA, valueB) : valueA ? -1 : valueB ? 1 : 0;
      if (byValue) return byValue;
      const timeA = noteUpdatedTime(a), timeB = noteUpdatedTime(b);
      return timeA !== timeB ? timeB - timeA : compareTitles(a, b);
    });
  }
  return [...notes].sort((a, b) => {
    switch (field) {
      case 'title':
        return factor * (a.title || '').trim().localeCompare((b.title || '').trim(), undefined, { numeric: true, sensitivity: 'base' });
      case 'status': {
        const indexA = statuses.indexOf((a.status || '').trim().toLowerCase());
        const indexB = statuses.indexOf((b.status || '').trim().toLowerCase());
        const rankA = indexA >= 0 ? indexA : Number.MAX_SAFE_INTEGER;
        const rankB = indexB >= 0 ? indexB : Number.MAX_SAFE_INTEGER;
        return rankA !== rankB ? factor * (rankA - rankB) : compareTitles(a, b);
      }
      case 'created': {
        const timeA = noteCreatedTime(a);
        const timeB = noteCreatedTime(b);
        return timeA !== timeB ? factor * (timeA - timeB) : compareTitles(a, b);
      }
      case 'updated':
      default: {
        const timeA = noteUpdatedTime(a);
        const timeB = noteUpdatedTime(b);
        return timeA !== timeB ? factor * (timeA - timeB) : compareTitles(a, b);
      }
    }
  });
}
