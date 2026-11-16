import { compilationChapters, type CompilationItem } from '@mygitnotes/core/compilation';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { type CompilationAsset, compilationItemTitle } from '../components/CompilationCard.js';
import type { NotebookConfig } from './types.js';
import { outsideNotebook } from './compilation-rows.js';

export interface BookChapter {
  /** The compilation item's id. */
  id: string;
  /** The heading's anchor in the book body; unique among the compilation's chapters and sub-sections. */
  anchor: string;
  kind: CompilationItem['kind'];
  title: string;
  /** The item names a note or file that is not there. */
  missing: boolean;
  item: CompilationItem;
  note?: NoteListItem;
  asset?: CompilationAsset;
  /** A chapter heading's items, each a chapter one level down; absent for an item's own chapter. */
  members?: BookChapter[];
}

/** One line of the contents list: a chapter, or a folder's note beneath it. */
export interface BookEntry {
  anchor: string;
  title: string;
  /** 0 for a chapter, 1 for an item under a chapter heading or a folder's note section, 2 for a note of a folder under a heading. */
  level: 0 | 1 | 2;
  missing?: boolean;
  /** The entry is a chapter heading. */
  heading?: boolean;
}

export const chapterAnchor = (item: CompilationItem) => `chapter:${item.id}`;
/** A folder's note section; `path` names the note within the folder chapter. */
export const sectionAnchor = (item: CompilationItem, path: string) => `${chapterAnchor(item)}/${path}`;

/**
 * The book's chapters: the compilation's members in the order lane cards would show them. A chapter heading is a
 * chapter whose `members` are the items up to the next heading; an item before the first heading is a chapter of its
 * own. A note that has not been found is only missing once the notes have loaded; a file or folder outside its
 * notebook's root is missing at once, given `notebooks`.
 */
export function bookChapters(items: readonly CompilationItem[], notes: readonly NoteListItem[], assets: readonly CompilationAsset[], loading = false, notebooks: readonly Pick<NotebookConfig, 'id' | 'root'>[] = []): BookChapter[] {
  const noteList = [...notes], assetList = [...assets];
  const itemChapter = (item: CompilationItem): BookChapter => {
    const note = item.kind === 'note' ? noteList.find(candidate => candidate.path === item.path && candidate.notebookId === item.notebookId) : undefined;
    const asset = item.kind === 'asset' ? assetList.find(candidate => candidate.path === item.path && candidate.notebookId === item.notebookId) : undefined;
    const missing = outsideNotebook(item, notebooks) || (item.kind === 'note' ? !note && !loading : item.kind === 'asset' && !asset);
    return { id: item.id, anchor: chapterAnchor(item), kind: item.kind, title: compilationItemTitle(item, noteList, assetList), missing, item, ...(note ? { note } : {}), ...(asset ? { asset } : {}) };
  };
  return compilationChapters(items).map(chapter => chapter.heading ? { id: chapter.heading.id, anchor: chapterAnchor(chapter.heading), kind: 'heading', title: chapter.heading.title, missing: false, item: chapter.heading, members: chapter.items.map(itemChapter) } : itemChapter(chapter.items[0]));
}

/** Every chapter and every item chapter under a heading, in book order. */
export const allChapters = (chapters: readonly BookChapter[]): BookChapter[] => chapters.flatMap(chapter => [chapter, ...(chapter.members ?? [])]);

/**
 * The contents list: every chapter in order, each folder's note sections beneath it, and the live title
 * of the section being edited in place of the saved one.
 */
export function bookEntries(chapters: readonly BookChapter[], sections: ReadonlyMap<string, readonly BookEntry[]>, liveTitles: ReadonlyMap<string, string> = new Map()): BookEntry[] {
  const titled = (entry: BookEntry): BookEntry => ({ ...entry, title: liveTitles.get(entry.anchor) || entry.title });
  // An item and the note sections of its folder; under a heading both sit one level further in.
  const item = (chapter: BookChapter, level: 0 | 1): BookEntry[] => [titled({ anchor: chapter.anchor, title: chapter.title, level, ...(chapter.missing ? { missing: true } : {}) }), ...(sections.get(chapter.id) ?? []).map(entry => titled({ ...entry, level: level === 0 ? 1 : 2 }))];
  return chapters.flatMap(chapter => chapter.members ? [titled({ anchor: chapter.anchor, title: chapter.title, level: 0, heading: true }), ...chapter.members.flatMap(member => item(member, 1))] : item(chapter, 0));
}

/**
 * The contents entry of the section that edits in the compilation's slot `slot`: a chapter's own id, or
 * `<folder id>:<note path>` for a note section under a folder chapter. `null` when no chapter owns the slot.
 */
export function slotAnchor(slot: string, chapters: readonly BookChapter[]): string | null {
  const every = allChapters(chapters);
  const own = every.find(chapter => chapter.id === slot);
  if (own) return own.anchor;
  const folder = every.find(chapter => chapter.kind === 'folder' && slot.startsWith(`${chapter.id}:`));
  return folder ? sectionAnchor(folder.item, slot.slice(folder.id.length + 1)) : null;
}
