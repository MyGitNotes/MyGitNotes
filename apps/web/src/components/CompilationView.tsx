import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DndContext, type DragEndEvent, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Copy, FolderInput, GripVertical, LayoutGrid, ListTree, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { insideAssistantDock } from '../lib/assistant-dock.js';
import { COMPILATION_MAX_ORDER, type CompilationItem, type CompilationRow, moveCompilationItem } from '@mygitnotes/core/compilation';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { useNoteEditing } from '../lib/note-editing.js';
import { useCompilationActions } from '../lib/compilation-actions.js';
import { CompilationEditingProvider, useCompilationEditing } from '../lib/compilation-editing.js';
import { useOutlineActions } from '../lib/outline-actions.js';
import { planCompilationCopy } from '../lib/compilation-copy.js';
import { initialCompilationStatus } from '../lib/compilation-status.js';
import { compilationRowItems } from '../lib/compilation-content.js';
import { dynamicOrderAfterDrop, screenCollision, screenKeyboardCoordinates } from '../lib/compilation-drag.js';
import { readLaneMembers } from '../lib/compilation-queries.js';
import { useTranslation } from '../lib/i18n/index.js';
import { usePanelContext } from '../lib/panel-context.js';
import { compilationStudyRoute } from '../lib/routes.js';
import type { FolderItem, NotebookConfig } from '../lib/types.js';
import { useNoteFacets, useNoteQueryScope } from '../lib/use-note-queries.js';
import { useCompilation } from '../lib/use-compilation.js';
import { useStudyWorkspace } from '../lib/use-study-workspace.js';
import { Button } from './Button.js';
import type { CompilationContentProps } from './CompilationCard.js';
import { CompilationAddItem, CompilationEditRow } from './CompilationDialogs.js';
import { CompilationLane } from './CompilationLane.js';
import { CompilationOrderDialog } from './CompilationOrderDialog.js';
import { CompilationBook } from './CompilationBook.js';
import { LoadingStatus } from './LoadingStatus.js';
import { useCompilationAssets, useCompilationItemOpen } from './useCompilationItemOpen.js';
import { compilationNotebookIds } from '../lib/compilation-rows.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';

const GraphPage = lazy(() => import('./GraphPage.js').then(module => ({ default: module.GraphPage })));
const ignoreSaved = () => {};

export interface CompilationViewProps {
  notebookId: string;
  path: string;
  notebooks: NotebookConfig[];
  folders: FolderItem[];
  /** `zoom` is the full-screen dialog; `pane` fills a Focus pane. */
  frame: 'zoom' | 'pane';
  /** Opens a pinned note where the host opens notes; with `anchor`, a heading-anchored item opens the whole note in zoom at that heading. */
  onOpenNote: (note: NoteListItem, anchor?: string) => void;
  /** Opens a pinned folder inside the Notes page; false lets the item navigate to it. */
  onOpenFolder?: (item: Extract<CompilationItem, { kind: 'folder'; }>) => boolean;
  /** Closes the view: the zoom dialog, or the Focus tab once the file is deleted. */
  onClose?: () => void;
}

/** One open compilation: its header, then the lane, book or graph arrangement. Edits write the file through the note actions. */
export function CompilationView({ notebookId, path, notebooks, folders, frame, onOpenNote, onOpenFolder, onClose }: CompilationViewProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const editing = useNoteEditing();
  const slots = useCompilationEditing();
  const actions = useCompilationActions();
  const outlines = useOutlineActions();
  const compilation = useCompilation({ notebookId, path }, notebooks);
  const study = useStudyWorkspace(actions.repository(notebookId), ignoreSaved);
  const { assets, error: assetError, loading: assetsLoading } = useCompilationAssets(notebooks, compilationNotebookIds(compilation.page.rows[0] as CompilationRow | undefined, notebookId));
  const facets = useNoteFacets(false);
  const [dialog, setDialog] = useState<'edit' | 'add' | 'delete' | 'order' | 'arrange' | null>(null);
  const [dragging, setDragging] = useState<string>();
  const [readingOrder, setReadingOrder] = useState(false);
  const pendingDrop = useRef(false);
  const queryClient = useQueryClient();
  const scope = useNoteQueryScope();
  const [missing, setMissing] = useState(false);
  const [notice, setNotice] = useState('');
  const row = compilation.page.rows[0] as CompilationRow | undefined;
  const itemOpen = useCompilationItemOpen({ notebooks, assets, onOpenNote, onMissing: () => setMissing(true) });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: screenKeyboardCoordinates }));
  const disabled = !compilation.writable || compilation.loading;
  // A folder source includes assets, so an incomplete asset read must not become a saved manual order.
  const dragDisabled = row?.kind === 'dynamic' && row.source.kind === 'folder' && (assetsLoading || assetError);
  const latest = useRef<{ row: CompilationRow | undefined; scope: typeof scope; assets: typeof assets; blocked: boolean; } | null>(null);
  useLayoutEffect(() => {
    latest.current = { row, scope, assets, blocked: disabled || dragDisabled };
    return () => {
      latest.current = null;
    };
  }, [row, scope, assets, disabled, dragDisabled]);
  const { setHasOpenNote } = usePanelContext();
  // Like a zoomed note, a zoomed compilation hides the workspace rail before the first paint, so both dialogs share the same edges.
  useLayoutEffect(() => {
    if (frame !== 'zoom') return;
    setHasOpenNote(true);
    return () => setHasOpenNote(false);
  }, [frame, setHasOpenNote]);

  // In zoom the Escape key closes the view, unless a dialog of its own is open.
  useEffect(() => {
    if (frame !== 'zoom' || !onClose) return;
    const close = (event: KeyboardEvent) => {
      // Escape typed in the assistant dock beside the view belongs to the dock.
      if (event.key !== 'Escape' || event.defaultPrevented || dragging !== undefined || insideAssistantDock(event.target) || document.querySelectorAll('[role="dialog"]').length > 1) return;
      void editing.flushEditors().then(saved => saved && onClose());
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [frame, onClose, editing, dragging]);

  const open: CompilationContentProps['onOpen'] = (item, note) => {
    setMissing(false);
    if (item.kind === 'folder' && onOpenFolder?.(item)) return;
    itemOpen.open(item, note);
  };
  const copy = async () => {
    if (!row) return;
    try {
      const next = await planCompilationCopy(row, initialCompilationStatus(notebooks, notebookId, facets.facets));
      await actions.create(notebookId, next.path, next.content, next.metadata);
      setNotice(t('compilation.copied', { title: next.title }));
    } catch (error) {
      compilation.setError((error as Error).message);
    }
  };
  const remove = async () => {
    if (!compilation.note) return;
    setDialog(null);
    try {
      await actions.remove(compilation.note);
      onClose?.();
    } catch (error) {
      compilation.setError((error as Error).message);
    }
  };
  const startStudy = async () => {
    if (await editing.flushEditors()) navigate(compilationStudyRoute(notebookId, path));
  };
  const change = (next: CompilationRow) => compilation.change({ rows: [next] });
  const dropItem = async ({ active, over }: DragEndEvent) => {
    setDragging(undefined);
    if (!row || !over || active.id === over.id || disabled || dragDisabled || row.study?.status || pendingDrop.current) return;
    const id = String(active.id), target = String(over.id);
    if (slots.editing?.slot === id) return;
    if (row.kind === 'custom') {
      // A heading moves alone, shifting the chapter boundary. A card lands in the chapter its drop index falls in.
      const from = row.items.findIndex(item => item.id === id);
      const to = target === `lane:${row.id}` ? row.items.length - 1 : row.items.findIndex(item => item.id === target);
      if (from < 0 || to < 0 || from === to) return;
      compilation.change(moveCompilationItem(compilation.page, id, row.id, to));
      void compilation.save();
      return;
    }
    pendingDrop.current = true;
    setReadingOrder(true);
    try {
      const notes = await readLaneMembers(queryClient, scope, row);
      const current = latest.current;
      if (!current || current.row !== row || current.blocked) return;
      if (!notes || current.scope !== scope || current.assets !== assets) throw new Error(t('compilation.orderChanged'));
      const items = compilationRowItems(row, notes, assets, notebooks, folders);
      const manualOrder = dynamicOrderAfterDrop(items, row.group === 'folder', id, target);
      if (!manualOrder) return;
      if (manualOrder.length > COMPILATION_MAX_ORDER) throw new Error(t('compilation.orderTooLong', { limit: COMPILATION_MAX_ORDER }));
      change({ ...row, sort: { field: 'manual', order: 'asc' }, manualOrder });
      void compilation.save();
    } catch (error) {
      if (latest.current?.row === row) compilation.setError((error as Error).message);
    } finally {
      pendingDrop.current = false;
      if (latest.current) setReadingOrder(false);
    }
  };
  // A change of arrangement unmounts the slot being edited, so its note is saved first and a failed save keeps everything as it is (E8).
  const rearrange = (current: CompilationRow, next: CompilationRow) => {
    if (next.view === current.view) return change(next);
    void slots.finish().then(saved => saved && change(next));
  };
  const addToFocus = compilation.note ? editing.addToFocus({ ...compilation.note, content: compilation.note.content ?? '' }) : undefined;
  const move = compilation.writable && compilation.note ? editing.moveNote?.({ ...compilation.note, content: compilation.note.content ?? '' }) : undefined;
  // Renaming retitles the compilation through its own row, then the file follows the new name.
  const rename = (current: CompilationRow) => compilation.writable && compilation.note ? editing.renameNote?.({ ...compilation.note, content: compilation.note.content ?? '', title: current.name }, title => change({ ...current, name: title })) : undefined;

  const view = (current: CompilationRow) => {
    const common = {
      row: current,
      notebooks,
      assets,
      folders,
      onOpen: open,
      disabled,
      dragDisabled,
      readOnly: !compilation.writable,
      study,
      facets: facets.facets,
      onStudy: () => void startStudy(),
      onView: (next: CompilationRow['view']) => rearrange(current, { ...current, view: next }),
      onStudyChange: (value: NonNullable<CompilationRow['study']>) => change({ ...current, study: value }),
      onAdd: () => setDialog('add'),
      extra: (
        <>
          {outlines?.canAdd(notebookId) && compilation.writable && compilation.note && (
            <button
              type='button'
              className='ui-icon-button'
              disabled={disabled}
              aria-label={t('outline.add')}
              title={t('outline.add')}
              onClick={() => outlines.add({ ...compilation.note!, content: compilation.note!.content ?? '' })}
            >
              <ListTree aria-hidden='true' />
            </button>
          )}
          {(compilation.writable || addToFocus) && (
            // Secondary actions share one menu so the header stays on one line in a narrow Focus pane.
            <DropdownMenu.Root>
              <DropdownMenu.Trigger className='ui-icon-button' aria-label={`${t('compilation.more')}: ${current.name}`} title={t('compilation.more')}>
                <MoreHorizontal size={16} aria-hidden='true' />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className='focus-menu' align='end' sideOffset={4} collisionPadding={8} onEscapeKeyDown={event => event.stopPropagation()}>
                  {addToFocus && (
                    <DropdownMenu.Item onSelect={addToFocus}>
                      <LayoutGrid size={14} aria-hidden='true' />
                      <span>{t('focus.addTo')}</span>
                    </DropdownMenu.Item>
                  )}
                  {compilation.writable && (
                    <>
                      <DropdownMenu.Item
                        disabled={disabled}
                        onSelect={() => setDialog('edit')}
                      >
                        <Pencil size={14} aria-hidden='true' />
                        <span>{t('screen.editRow')}</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item disabled={disabled} onSelect={() => void copy()}>
                        <Copy size={14} aria-hidden='true' />
                        <span>{t('compilation.copy')}</span>
                      </DropdownMenu.Item>
                      {move && (
                        <DropdownMenu.Item disabled={disabled} onSelect={move}>
                          <FolderInput size={14} aria-hidden='true' />
                          <span>{t('compilation.move')}</span>
                        </DropdownMenu.Item>
                      )}
                      <DropdownMenu.Item disabled={disabled} onSelect={() => setDialog('delete')}>
                        <Trash2 size={14} aria-hidden='true' />
                        <span>{t('compilation.delete')}</span>
                      </DropdownMenu.Item>
                    </>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
        </>
      ),
      onSort: (sort: NonNullable<Extract<CompilationRow, { kind: 'dynamic'; }>['sort']>) => current.kind === 'dynamic' && change({ ...current, sort }),
      onEditOrder: current.kind === 'dynamic' && compilation.writable ? () => setDialog('order') : undefined,
      onArrange: current.kind === 'custom' && compilation.writable ? () => setDialog('arrange') : undefined,
      onRename: rename(current),
      onCreateNote: actions.createNote,
    };
    return current.view === 'book' ? <CompilationBook {...common} /> : (
      <CompilationLane
        {...common}
        onRemove={id => {
          if (current.kind !== 'custom') return;
          const next = { ...current, items: current.items.filter(item => item.id !== id) };
          if (slots.editing?.slot === id) void slots.finish().then(saved => saved && change(next));
          else change(next);
        }}
        graph={current.view === 'graph'
          ? (
            <Suspense fallback={<p role='status'>{t('graph.title')}</p>}>
              <GraphPage notebooks={notebooks} lane={current} screen={compilation} />
            </Suspense>
          )
          : undefined}
      />
    );
  };

  return (
    <CompilationEditingProvider value={slots}>
      <div className='compilation-view' data-frame={frame} data-arrangement={row?.view}>
        {frame === 'zoom' && onClose && (
          <div className='compilation-frame-bar'>
            <Button type='button' size='icon' aria-label={t('common.close')} title={t('common.close')} onClick={() => void editing.flushEditors().then(saved => saved && onClose())}>
              <X size={18} />
            </Button>
          </div>
        )}
        <div className='compilation-body'>
          {compilation.error && <p role='alert' className='screen-error'>{compilation.error}</p>}
          {assetError && <p role='alert' className='screen-error'>{t('screen.assetsError')}</p>}
          {missing && <p role='alert' className='screen-error'>{t('screen.missing')}</p>}
          {notice && <p role='status' className='screen-dialog-hint'>{notice}</p>}
          {readingOrder && <p role='status' className='screen-dialog-hint'>{t('compilation.loadingOrder')}</p>}
          {compilation.loading ? <LoadingStatus>{t('screen.loading')}</LoadingStatus> : compilation.missing ? <p role='alert' className='screen-error'>{t('compilation.notFound')}</p> : !row
            ? (
              <div className='screen-board-empty' role='alert'>
                <h3>{compilation.invalid[0]?.title ?? path.split('/').pop()}</h3>
                <p>{t('compilation.invalid')}</p>
                <p className='screen-form-error'>{compilation.invalid[0]?.error}</p>
              </div>
            )
            : (
              <DndContext sensors={sensors} collisionDetection={screenCollision} onDragStart={({ active }) => setDragging(String(active.data.current?.title ?? active.id))} onDragCancel={() => setDragging(undefined)} onDragEnd={event => void dropItem(event)}>
                {view(row)}
                <DragOverlay dropAnimation={null} style={{ pointerEvents: 'none' }}>
                  {dragging !== undefined && (
                    // Keep the measured drag rectangle as large as the source, even though the label is compact.
                    <div className='screen-drag-overlay-frame'>
                      <div className='screen-drag-overlay'>
                        <GripVertical size={16} aria-hidden='true' /> {dragging}
                      </div>
                    </div>
                  )}
                </DragOverlay>
              </DndContext>
            )}
        </div>
        {row && dialog === 'edit' && <CompilationEditRow row={row} disabled={disabled} notebooks={notebooks} assets={assets} folders={folders} selectedNotebookId={notebookId} onClose={() => setDialog(null)} onApply={next => rearrange(row, next)} onRemove={() => setDialog('delete')} />}
        {row?.kind === 'custom' && dialog === 'add' && <CompilationAddItem notebooks={notebooks} assets={assets} folders={folders} rowName={row.name} notebookId={row.notebookId} items={row.items} onClose={() => setDialog(null)} onAdd={items => change({ ...row, items })} />}
        {row?.kind === 'custom' && dialog === 'arrange' && <CompilationOrderDialog row={row} notebooks={notebooks} assets={assets} disabled={disabled} onClose={() => setDialog(null)} onSave={() => {}} onSaveItems={items => change({ ...row, items })} />}
        {row?.kind === 'dynamic' && dialog === 'order' && <CompilationOrderDialog row={row} notebooks={notebooks} assets={assets} folders={folders} disabled={disabled} onClose={() => setDialog(null)} onSave={order => change({ ...row, sort: { field: 'manual', order: 'asc' }, manualOrder: order })} />}
        {row && dialog === 'delete' && (
          <WorkspaceDialog title={t('compilation.delete')} onClose={() => setDialog(null)}>
            <p>{t('compilation.deleteHint', { title: row.name })}</p>
            <div className='workspace-dialog-actions'>
              <Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
              <Button variant='primary' onClick={() => void remove()}>{t('compilation.delete')}</Button>
            </div>
          </WorkspaceDialog>
        )}
        {itemOpen.preview}
      </div>
    </CompilationEditingProvider>
  );
}
