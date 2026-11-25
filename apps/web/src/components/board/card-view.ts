import type { NoteListItem } from '@mygitnotes/core/note-query';
import { boardMathText } from '../../lib/board/math-text.js';
import { noteExcerpt } from '../../lib/note-excerpt.js';
import { itemSection } from '../../lib/compilation-content.js';
import { outsideNotebook } from '../../lib/compilation-rows.js';
import type { PlacedCard } from '../../lib/board/placement.js';
import type { FolderItem, NotebookConfig } from '../../lib/types.js';
import type { CompilationAsset } from '../CompilationCard.js';
import type { CardView } from './BoardCard.js';

export interface CardSources {
  /** The loaded note at a notebook and path. */
  noteAt: (notebookId: string, path: string) => NoteListItem | undefined;
  assets: readonly CompilationAsset[];
  notebooks: readonly NotebookConfig[];
  folders: readonly FolderItem[];
  /** The compilation's own notebook: a card of any other carries that notebook's mark. */
  notebookId: string;
  /** Whether the notes are still loading, so a note not found yet is not missing. */
  loading: boolean;
  assetsLoading: boolean;
  dotClass: (status: string) => string;
}

// Camera changes redraw the board; parse a loaded note's formulas only once per note snapshot.
const previews = new WeakMap<NoteListItem, { title: string; excerpt?: string; }>();
function preview(note: NoteListItem) {
  const cached = previews.get(note);
  if (cached) return cached;
  const title = boardMathText(note.title);
  const result = { title, excerpt: typeof note.content === 'string' ? noteExcerpt(boardMathText(note.content), title, 180) : undefined };
  previews.set(note, result);
  return result;
}

const lastSegment = (path: string) => path.split('/').pop() || path;

/**
 * What a card shows, as a lane card reads it: a note its status, title and excerpt; a heading-anchored item its note's
 * title and the heading; a folder its title (the count is read by the card); an asset or video its name. A path in no
 * notebook, a note that is gone and a folder outside its notebook show as missing.
 */
export function cardView(card: PlacedCard, sources: CardSources): CardView {
  const { item } = card;
  const notebook = item.kind === 'youtube' || item.notebookId === sources.notebookId ? undefined : sources.notebooks.find(candidate => candidate.id === item.notebookId);
  const base = { notebook, loading: false, missing: false };
  if (item.kind === 'youtube') return { ...base, title: item.title || 'YouTube' };
  if (item.kind === 'folder') {
    const root = sources.notebooks.find(candidate => candidate.id === item.notebookId)?.root;
    const folder = sources.folders.find(candidate => candidate.notebookId === item.notebookId && `${root}/${candidate.path}` === item.path);
    return { ...base, title: folder?.title ?? lastSegment(item.path), missing: outsideNotebook(item, sources.notebooks) };
  }
  if (item.kind === 'asset') {
    const asset = sources.assets.find(candidate => candidate.path === item.path && candidate.notebookId === item.notebookId);
    return { ...base, title: asset?.name ?? lastSegment(item.path), ...(asset ? { asset } : {}), loading: !asset && sources.assetsLoading, missing: !asset && !sources.assetsLoading };
  }
  const note = sources.noteAt(item.notebookId, item.path);
  if (!note) return { ...base, title: lastSegment(item.path).replace(/\.md$/, ''), loading: sources.loading, missing: !sources.loading };
  const dot = note.status ? sources.dotClass(note.status) : undefined;
  const { title, excerpt } = preview(note);
  if (item.anchor) return { ...base, note, ...(dot ? { dot } : {}), title, excerpt: boardMathText(itemSection(item, note)?.heading ?? item.anchor) };
  return { ...base, note, ...(dot ? { dot } : {}), title: title || lastSegment(item.path), excerpt, loading: typeof note.content !== 'string' };
}
