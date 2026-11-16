import { useState } from 'react';
import { closestCenter, DndContext, KeyboardSensor, type Modifier, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Heading, X } from 'lucide-react';
import { type CompilationItem, type CompilationRow, isFileItem } from '@mygitnotes/core/compilation';
import { compilationRowItems, itemSection } from '../lib/compilation-content.js';
import { type OutlineHeading, parseMarkdownOutline } from '../lib/note-navigation.js';
import { headingSlug } from '../lib/workspace-links.js';
import { useLaneNotes } from '../lib/compilation-queries.js';
import { useTranslation } from '../lib/i18n/index.js';
import type { FolderItem, NotebookConfig } from '../lib/types.js';
import { Button } from './Button.js';
import { type CompilationAsset, compilationItemTitle } from './CompilationCard.js';
import { LoadingStatus } from './LoadingStatus.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';

/**
 * Rows move only up and down and stay inside the list's visible box. A row dragged past the end would
 * otherwise grow the list, and auto-scroll would chase it without end.
 */
const withinList: Modifier = ({ transform, draggingNodeRect, containerNodeRect }) => {
  if (!draggingNodeRect || !containerNodeRect) return { ...transform, x: 0 };
  const y = Math.min(Math.max(transform.y, containerNodeRect.top - draggingNodeRect.top), containerNodeRect.bottom - draggingNodeRect.bottom);
  return { ...transform, x: 0, y };
};

interface CompilationOrderDialogProps {
  row: CompilationRow;
  notebooks: NotebookConfig[];
  assets: CompilationAsset[];
  /** Names a dynamic compilation's chapters by folder. */
  folders?: FolderItem[];
  disabled: boolean;
  /** A dynamic compilation: receives every member path, in the order the user set. */
  onSave: (order: string[]) => void;
  /** A custom compilation: receives its items, chapter headings included, in the arranged flat order. */
  onSaveItems?: (items: CompilationItem[]) => void;
  onClose: () => void;
}

interface OrderEntry {
  item: CompilationItem;
  title: string;
  /** A pinned note of a custom compilation: its own title and its headings, to pin one heading's section or the whole note. */
  note?: { title: string; headings: OutlineHeading[]; };
}

/** How a row names a note item: the note's title, then the heading it is anchored to. */
const anchoredTitle = (noteTitle: string, heading: string | undefined) => heading ? `${noteTitle} › ${heading}` : noteTitle;

/**
 * Sets a dynamic compilation's manual order, or arranges a custom compilation's contents (Arrange contents):
 * it opens on a snapshot of the current order and saves once. A custom compilation's rows are its items and chapter
 * headings in one flat list; a heading moves alone, its title edits in place, and removing it keeps its items.
 */
export function CompilationOrderDialog({ row, notebooks, assets, folders = [], disabled, onSave, onSaveItems, onClose }: CompilationOrderDialogProps) {
  const { t } = useTranslation();
  const custom = row.kind === 'custom';
  // Every member, whatever the study filter shows, so the saved order leaves none of them behind.
  const members = { ...row, study: undefined };
  // A custom compilation's notes are read with their content, for the headings a note item can be anchored to.
  const lane = useLaneNotes(members, { all: true, content: custom });
  const [entries, setEntries] = useState<OrderEntry[] | null>(null);
  // The row a new chapter goes after: the one that last held focus.
  const [focused, setFocused] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  // The snapshot is taken once, when the members arrive; later refetches do not reset what the user arranged.
  if (entries === null && !lane.loading && !lane.error) {
    // A dynamic compilation grouped by folder shows its chapters as fixed separators.
    const items = custom ? row.items : compilationRowItems(members, lane.notes, assets, notebooks, folders).filter(item => isFileItem(item) || item.kind === 'heading');
    setEntries(items.map(item => {
      const note = custom && item.kind === 'note' ? lane.notes.find(candidate => candidate.path === item.path && candidate.notebookId === item.notebookId) : undefined;
      if (!note || item.kind !== 'note') return { item, title: compilationItemTitle(item, lane.notes, assets) };
      return { item, title: anchoredTitle(note.title, item.anchor && (itemSection(item, note)?.heading ?? item.anchor)), note: { title: note.title, headings: parseMarkdownOutline(note.content ?? '') } };
    }));
  }
  const title = custom ? t('compilation.arrange') : t('compilation.editOrder');
  const blank = Boolean(entries?.some(entry => entry.item.kind === 'heading' && !entry.item.title.trim()));
  const addChapter = () => {
    const heading: CompilationItem = { id: crypto.randomUUID(), kind: 'heading', title: '' };
    setEntries(current => {
      if (!current) return current;
      const after = focused === null ? -1 : current.findIndex(entry => entry.item.id === focused);
      const at = after < 0 ? current.length : after + 1;
      return [...current.slice(0, at), { item: heading, title: '' }, ...current.slice(at)];
    });
    setFresh(heading.id);
  };
  const retitle = (id: string, value: string) => setEntries(current => current && current.map(entry => entry.item.id === id && entry.item.kind === 'heading' ? { item: { ...entry.item, title: value }, title: value } : entry));
  const anchorTo = (id: string, heading: string) =>
    setEntries(current =>
      current && current.map(entry => {
        if (entry.item.id !== id || entry.item.kind !== 'note' || !entry.note) return entry;
        const { id: itemId, notebookId, path } = entry.item;
        return { ...entry, item: { id: itemId, kind: 'note', notebookId, path, ...(heading ? { anchor: heading } : {}) }, title: anchoredTitle(entry.note.title, heading || undefined) };
      })
    );
  const remove = (id: string) => setEntries(current => current && current.filter(entry => entry.item.id !== id));
  // A row under a heading is indented, and only content items are numbered.
  const shown: { entry: OrderEntry; indent: boolean; index: number | null; }[] = [];
  for (const entry of entries ?? []) {
    const heading = entry.item.kind === 'heading';
    const previous = shown.at(-1);
    const underHeading = heading || Boolean(previous && (previous.indent || previous.entry.item.kind === 'heading'));
    shown.push({ entry, indent: !heading && underHeading, index: heading ? null : shown.filter(row => row.index !== null).length + 1 });
  }

  return (
    <WorkspaceDialog title={`${title}: ${row.name}`} className='compilation-order-dialog' onClose={onClose}>
      <p className='screen-dialog-hint'>{t(custom ? 'compilation.arrangeHint' : 'compilation.orderHint')}</p>
      {lane.error && <p role='alert' className='screen-error'>{lane.error}</p>}
      {!entries ? !lane.error && <LoadingStatus>{t('screen.loading')}</LoadingStatus> : entries.length === 0 && !custom ? <p className='screen-dialog-hint'>{t('compilation.orderEmpty')}</p> : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[withinList]}
          onDragEnd={({ active, over }) => {
            if (!over || active.id === over.id) return;
            setEntries(current => {
              if (!current) return current;
              const from = current.findIndex(entry => entry.item.id === active.id);
              const to = current.findIndex(entry => entry.item.id === over.id);
              if (from < 0 || to < 0) return current;
              // A dynamic chapter's members reorder within it only: a drop on a separator or in another chapter is refused.
              const chapterAt = (index: number) => current.slice(0, index + 1).filter(entry => entry.item.kind === 'heading').length;
              if (!custom && (current[to].item.kind === 'heading' || chapterAt(from) !== chapterAt(to))) return current;
              return arrayMove(current, from, to);
            });
          }}
        >
          <SortableContext items={entries.map(entry => entry.item.id)} strategy={verticalListSortingStrategy}>
            <ol className='compilation-order-list' aria-label={title} onFocus={event => setFocused((event.target as HTMLElement).closest<HTMLElement>('[data-entry]')?.dataset.entry ?? null)}>{shown.map(({ entry, indent, index }) => <OrderRow key={entry.item.id} entry={entry} index={index} indent={indent} fixed={!custom && entry.item.kind === 'heading'} autoFocus={entry.item.id === fresh} onRetitle={retitle} onRemove={remove} onAnchor={anchorTo} />)}</ol>
          </SortableContext>
        </DndContext>
      )}
      {custom && entries && (
        <Button type='button' className='compilation-order-add' onClick={addChapter}>
          <Heading size={14} aria-hidden='true' />
          {t('compilation.addChapter')}
        </Button>
      )}
      <div className='workspace-dialog-actions'>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant='primary'
          disabled={disabled || !entries?.length || blank}
          onClick={() => {
            if (!entries) return;
            if (custom) onSaveItems?.(entries.map(entry => entry.item.kind === 'heading' ? { ...entry.item, title: entry.item.title.trim() } : entry.item));
            else onSave(entries.flatMap(entry => isFileItem(entry.item) ? [entry.item.path] : []));
            onClose();
          }}
        >
          {t(custom ? 'common.save' : 'compilation.orderSave')}
        </Button>
      </div>
    </WorkspaceDialog>
  );
}

function OrderRow({ entry, index, indent, fixed, autoFocus, onRetitle, onRemove, onAnchor }: { entry: OrderEntry; index: number | null; indent: boolean; /** A derived chapter of a dynamic compilation: a separator that neither moves nor takes a drop. */ fixed: boolean; autoFocus: boolean; onRetitle: (id: string, title: string) => void; onRemove: (id: string) => void; onAnchor: (id: string, heading: string) => void; }) {
  const { t } = useTranslation();
  const sort = useSortable({ id: entry.item.id, disabled: fixed });
  const heading = entry.item.kind === 'heading';
  if (fixed) {
    return (
      <li ref={sort.setNodeRef} className='compilation-order-row compilation-order-separator' data-entry={entry.item.id} data-heading='fixed'>
        <span className='compilation-order-title'>{entry.title}</span>
      </li>
    );
  }
  /* eslint-disable react/refs -- dnd-kit sortable bindings are callback refs and render state, forwarded to the row and its handle. */
  return (
    <li ref={sort.setNodeRef} className='compilation-order-row' data-entry={entry.item.id} data-heading={heading || undefined} data-indent={indent || undefined} data-dragging={sort.isDragging || undefined} style={{ transform: CSS.Translate.toString(sort.transform), transition: sort.transition }}>
      <Button type='button' size='icon' ref={sort.setActivatorNodeRef} {...sort.attributes} {...sort.listeners} className='screen-drag-handle' aria-label={`${t(heading ? 'compilation.moveChapter' : 'screen.moveItem')}: ${entry.title}`}>
        <GripVertical size={16} aria-hidden='true' />
      </Button>
      {heading
        ? (
          <>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus -- A chapter just added takes focus so its title can be typed at once. */}
            <input className='ui-control compilation-order-chapter' aria-label={t('compilation.chapterTitle')} placeholder={t('compilation.chapterTitle')} value={entry.title} maxLength={100} autoFocus={autoFocus} onChange={event => onRetitle(entry.item.id, event.target.value)} />
            <Button type='button' size='icon' aria-label={`${t('compilation.removeChapter')}: ${entry.title}`} title={t('compilation.removeChapter')} onClick={() => onRemove(entry.item.id)}>
              <X size={14} aria-hidden='true' />
            </Button>
          </>
        )
        : (
          <>
            <span className='compilation-order-index'>{index}</span>
            <span className='compilation-order-title'>{entry.title}</span>
            {entry.note && entry.item.kind === 'note' && (entry.note.headings.length > 0 || entry.item.anchor) && <HeadingChoice note={entry.note} anchor={entry.item.anchor} onChange={heading => onAnchor(entry.item.id, heading)} />}
          </>
        )}
    </li>
  );
  /* eslint-enable react/refs */
}

/** The heading a pinned note shows, or the whole note: every heading of the note, a repeated one disabled, and an anchor whose heading is gone kept until another is chosen. */
function HeadingChoice({ note, anchor, onChange }: { note: NonNullable<OrderEntry['note']>; anchor?: string; onChange: (heading: string) => void; }) {
  const { t } = useTranslation();
  const top = Math.min(...note.headings.map(heading => heading.depth));
  const current = anchor ? note.headings.find(heading => headingSlug(heading.label) === headingSlug(anchor))?.label ?? anchor : '';
  const gone = Boolean(anchor) && !note.headings.some(heading => heading.label === current);
  return (
    <select className='ui-control compilation-order-heading' aria-label={`${t('screen.itemHeading')}: ${note.title}`} value={current} onChange={event => onChange(event.target.value)}>
      <option value=''>{t('screen.itemWholeNote')}</option>
      {gone && <option value={current}>{t('screen.headingMissingOption', { label: current })}</option>}
      {note.headings.map((heading, index) => {
        const repeated = note.headings.slice(0, index).some(earlier => headingSlug(earlier.label) === headingSlug(heading.label));
        return <option key={index} value={repeated ? `${index}:${heading.label}` : heading.label} disabled={repeated}>{`${'\u00a0\u00a0'.repeat(heading.depth - top)}${repeated ? t('screen.headingDuplicateOption', { label: heading.label }) : heading.label}`}</option>;
      })}
    </select>
  );
}
