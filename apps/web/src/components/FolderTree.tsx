import { type FolderAction, FolderActions } from './FolderActions.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, type DragMoveEvent, DragOverlay, MouseSensor, pointerWithin, TouchSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { Folder, FolderPlus } from 'lucide-react';
import type { FolderCommand } from '@mygitnotes/core';
import type { FolderItem } from '../lib/types.js';
import { dropPosition, folderDropCommand } from '../lib/folder-drag.js';
import { TOUCH_NOTE_DROP, TOUCH_NOTE_OVER } from '../lib/touch-note-drag.js';
import { buildFolderTree, expandedPathsForFolder, type FolderTreeNode } from '../lib/folder-tree.js';
import { carriesNoteMove, type DraggedNote, droppedNote } from '../lib/note-drag.js';
import { useTranslation } from '../lib/i18n/index.js';
import { NavTree, NavTreeChildren, NavTreeRow } from './NavTree.js';

type DropHint = 'before' | 'after' | 'inside';
interface DropTarget {
  path: string;
  position: DropHint;
}

/** A row a dragged folder can land on; where on the row it lands follows the pointer (see `dropPosition`). */
function DropZone({ path, hint, disabled, children }: { path: string; hint?: DropHint; disabled: boolean; children?: React.ReactNode; }) {
  const drop = useDroppable({ id: `folder:${path}`, disabled, data: { path } });
  /* eslint-disable react/refs -- dnd-kit returns callback refs and render state together; forwarding its callbacks is intentional. */
  return <div ref={drop.setNodeRef} data-folder-drop={path} className={`folder-drop-body ${hint ? `drop-${hint}` : ''}`}>{children}</div>;
  /* eslint-enable react/refs */
}

/** The pointer's height during a drag: where it went down, moved by the drag so far. */
function pointerY(activator: Event, deltaY: number) {
  const start = 'touches' in activator ? (activator as TouchEvent).touches[0]?.clientY ?? 0 : (activator as MouseEvent).clientY;
  return start + deltaY;
}

/**
 * Takes a note dragged from the note list (a native drag, apart from the folder drags of dnd-kit) and marks the row
 * under it; without `onDrop` it only renders its children.
 */
export function NoteDropTarget({ onDrop, className = '', children }: { onDrop?: (note: DraggedNote) => void; className?: string; children: React.ReactNode; }) {
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // A touch drag (lib/touch-note-drag) has no native drag events; it tells the target under the finger with its own.
  useEffect(() => {
    const element = ref.current;
    if (!element || !onDrop) return;
    const onOver = (event: Event) => setOver((event as CustomEvent<boolean>).detail);
    const onTouchDrop = (event: Event) => onDrop((event as CustomEvent<DraggedNote>).detail);
    element.addEventListener(TOUCH_NOTE_OVER, onOver);
    element.addEventListener(TOUCH_NOTE_DROP, onTouchDrop);
    return () => {
      element.removeEventListener(TOUCH_NOTE_OVER, onOver);
      element.removeEventListener(TOUCH_NOTE_DROP, onTouchDrop);
    };
  }, [onDrop]);
  if (!onDrop) return <div className={className || undefined}>{children}</div>;
  return (
    <div
      ref={ref}
      data-note-drop=''
      className={`${className} ${over ? 'folder-note-over' : ''}`.trim() || undefined}
      onDragOver={event => {
        if (!carriesNoteMove(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={event => {
        setOver(false);
        const note = droppedNote(event);
        if (!note) return;
        event.preventDefault();
        onDrop(note);
      }}
    >
      {children}
    </div>
  );
}

function TreeItem({ folder, hint, disabled, selected, onSelect, onManage, onDropNote, hasChildren, isExpanded, onToggleExpand }: { folder: FolderItem; hint?: DropHint; disabled: boolean; selected: boolean; onSelect: () => void; onManage: (action: FolderAction) => void; onDropNote?: (note: DraggedNote) => void; hasChildren: boolean; isExpanded: boolean; onToggleExpand: (event: React.MouseEvent) => void; }) {
  const { t } = useTranslation();
  // The whole row drags: past a few pixels with a mouse, after a long press on touch, so a click still selects.
  const drag = useDraggable({ id: folder.path, disabled });

  /* eslint-disable react/refs -- dnd-kit returns callback refs and render state together; forwarding its callbacks is intentional. */
  return (
    <div ref={drag.setNodeRef} {...(disabled ? {} : drag.listeners)} className={`folder-tree-item ${selected ? 'is-selected' : ''} ${disabled ? '' : 'is-draggable'}`} style={{ opacity: drag.isDragging ? 0.35 : undefined }}>
      <NoteDropTarget onDrop={disabled ? undefined : onDropNote}>
        <DropZone path={folder.path} hint={hint} disabled={disabled}>
          <NavTreeRow hasChildren={hasChildren} isExpanded={isExpanded} onToggleExpand={onToggleExpand} expandAriaLabel={isExpanded ? t('folder.collapse') : t('folder.expand')} title={folder.title} selected={selected} onSelect={onSelect} actions={<FolderActions title={folder.title} disabled={disabled} onAction={onManage} />} buttonProps={{ title: folder.description || folder.path }} />
        </DropZone>
      </NoteDropTarget>
    </div>
  );
  /* eslint-enable react/refs */
}

/** The notebook root: a folder drops into it, and so does a note. */
function RootRow({ hint, selected, disabled, onSelect, onDropNote }: { hint?: DropHint; selected: boolean; disabled: boolean; onSelect: () => void; onDropNote?: (note: DraggedNote) => void; }) {
  const { t } = useTranslation();
  return (
    <NoteDropTarget onDrop={disabled ? undefined : onDropNote}>
      <DropZone path='' hint={hint} disabled={disabled}>
        <NavTreeRow hasChildren={false} title={t('folder.allFolders')} selected={selected} onSelect={onSelect} />
      </DropZone>
    </NoteDropTarget>
  );
}

function TreeBranch({ node, target, expanded, onToggleExpand, disabled, isSelected, selectFolder, onManageFiles, onDropNote }: { node: FolderTreeNode; target?: DropTarget; expanded: Set<string>; onToggleExpand: (path: string, event: React.MouseEvent) => void; disabled: boolean; isSelected: (path: string | null) => boolean; selectFolder: (folder: string | null) => void; onManageFiles: (path: string, action?: FolderAction) => void; onDropNote?: (note: DraggedNote, folder: string | null) => void; }) {
  const isExpanded = expanded.has(node.path);
  const hasChildren = node.children.length > 0;
  const folder = node.folder;

  return (
    <div className='nav-tree-node' key={node.path}>
      <TreeItem folder={folder} hint={target?.path === folder.path ? target.position : undefined} disabled={disabled} selected={isSelected(folder.path)} onSelect={() => selectFolder(folder.path)} onManage={action => onManageFiles(folder.path, action)} onDropNote={onDropNote && (note => onDropNote(note, folder.path))} hasChildren={hasChildren} isExpanded={isExpanded} onToggleExpand={event => onToggleExpand(node.path, event)} />
      {hasChildren && isExpanded && <NavTreeChildren>{node.children.map(child => <TreeBranch key={child.path} node={child} target={target} expanded={expanded} onToggleExpand={onToggleExpand} disabled={disabled} isSelected={isSelected} selectFolder={selectFolder} onManageFiles={onManageFiles} onDropNote={onDropNote} />)}</NavTreeChildren>}
    </div>
  );
}

export function FolderTree({ showHeading = false, showRoot = false, onManageFiles, selectedPaths, allFoldersSelected, folders, notebookId, selected, onSelect, writable, beforeChange, onChanged, onDropNote, expandCommand }: {
  showHeading?: boolean;
  showRoot?: boolean;
  onManageFiles: (path: string, action?: FolderAction) => void;
  selectedPaths?: string[];
  allFoldersSelected?: boolean;
  folders: FolderItem[];
  notebookId: string;
  selected: string | null;
  onSelect: (folder: string | null) => void;
  writable: boolean;
  /** Refuses a folder change before it is sent, by throwing the reason. */
  beforeChange?: (command: FolderCommand) => Promise<void>;
  onChanged?: () => Promise<void>;
  /** Moves a note dropped on a folder (null for the root row) of this notebook. */
  onDropNote?: (note: DraggedNote, folder: string | null) => void;
  /** Each new object expands or collapses every folder once. */
  expandCommand?: { expanded: boolean; };
}) {
  const { t } = useTranslation();
  const [revision, setRevision] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState<string>();
  const [target, setTarget] = useState<DropTarget>();

  const tree = useMemo(() => buildFolderTree(folders, notebookId), [folders, notebookId]);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    const targets = selected ? [selected] : selectedPaths || [];
    for (const target of targets) {
      for (const p of expandedPathsForFolder(target)) initial.add(p);
    }
    return initial;
  });

  const [expansionSelection, setExpansionSelection] = useState({ selected, selectedPaths });
  if (expansionSelection.selected !== selected || expansionSelection.selectedPaths !== selectedPaths) {
    setExpansionSelection({ selected, selectedPaths });
    const next = new Set(expanded);
    for (const target of selected ? [selected] : selectedPaths || []) {
      for (const path of expandedPathsForFolder(target)) next.add(path);
    }
    if (next.size !== expanded.size) setExpanded(next);
  }

  // A tree mounted after the last command keeps its selection-based expansion.
  const [appliedExpandCommand, setAppliedExpandCommand] = useState(expandCommand);
  if (expandCommand && expandCommand !== appliedExpandCommand) {
    setAppliedExpandCommand(expandCommand);
    const paths = (nodes: FolderTreeNode[]): string[] => nodes.flatMap(node => [node.path, ...paths(node.children)]);
    setExpanded(expandCommand.expanded ? new Set(paths(tree)) : new Set());
  }

  const toggleExpand = (path: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const isSelected = (path: string | null) => selectedPaths ? (path === null ? allFoldersSelected ?? selectedPaths.length === 0 : selectedPaths.includes(path)) : selected === path;

  // A note of another notebook has no place among these folders.
  const dropNote = onDropNote && ((note: DraggedNote, folder: string | null) => {
    if (note.notebookId === notebookId) onDropNote(note, folder);
  });

  /** Where a drag would land: the row under the pointer, and beside or inside it by the pointer's height; the root only takes folders in. */
  const dropTarget = ({ active, over, activatorEvent, delta }: Pick<DragMoveEvent, 'active' | 'over' | 'activatorEvent' | 'delta'>): DropTarget | undefined => {
    if (!over) return;
    const path = String(over.data.current?.path ?? '');
    if (path === String(active.id)) return;
    return { path, position: path ? dropPosition(pointerY(activatorEvent, delta.y), over.rect.top, over.rect.height) : 'inside' };
  };

  const list = useMemo(() => folders.filter(folder => folder.notebookId === notebookId), [folders, notebookId]);
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }));

  const refresh = async () => {
    const response = await fetch(`/api/folder-manager?notebookId=${encodeURIComponent(notebookId)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t('folder.failed'));
    setRevision(data.revision);
    return data.revision as string;
  };

  /* eslint-disable react-hooks/exhaustive-deps -- Only notebook, folder-list or write-permission changes refresh the server revision; translation helper identity must not issue another request. */
  useEffect(() => {
    /* eslint-disable react/set-state-in-effect -- The revision request clears the previous revision and error before fetching; mutation commands must wait for the new server revision. */
    setError('');
    /* eslint-enable react/set-state-in-effect */
    setRevision('');
    if (writable) void refresh().catch(err => setError(err.message));
  }, [notebookId, folders, writable]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const mutate = async (command: FolderCommand) => {
    if (busy || !writable) return;
    setBusy(true);
    setError('');
    try {
      await beforeChange?.(command);
      // Any note saved or moved since the tree loaded changes the revision, so it is read again just before the
      // change, as a note move reads the file revision; the server still checks the command against its folders.
      const current = await refresh();
      const response = await fetch('/api/folder-manager', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command, revision: current }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('folder.failed'));
      setRevision(data.revision);
      await onChanged?.();
      onSelect(data.selectedPath || null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disabled = !writable || busy || !revision;
  const errorMessage = error && (
    <div role='alert' className='folder-error'>
      {error}
      <button
        type='button'
        className='ui-button'
        onClick={() => {
          void refresh().then(() => {
            setError('');
            return onChanged?.();
          }).catch(err => setError(err.message));
        }}
      >
        {t('folder.reload')}
      </button>
    </div>
  );

  return (
    <section aria-label={t('folder.folders')}>
      {showHeading && (
        <div className='folder-tree-heading'>
          <h4>{t('folder.folders')}</h4>
          {writable && (
            <div className='folder-heading-actions'>
              <button type='button' className='ui-icon-button' disabled={busy} aria-label={t('folder.create')} onClick={() => onManageFiles(selected || '')}>
                <FolderPlus size={16} />
              </button>
            </div>
          )}
        </div>
      )}
      {errorMessage}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={({ active }) => setDragging(String(active.id))}
        onDragMove={event => {
          const next = dropTarget(event);
          if (next?.path !== target?.path || next?.position !== target?.position) setTarget(next);
        }}
        onDragCancel={() => {
          setDragging(undefined);
          setTarget(undefined);
        }}
        onDragEnd={event => {
          setDragging(undefined);
          setTarget(undefined);
          const drop = dropTarget(event);
          if (!drop || disabled) return;
          const command = folderDropCommand(notebookId, String(event.active.id), drop.path, drop.position, list);
          if (command) void mutate(command);
        }}
      >
        <NavTree aria-label={t('folder.folders')}>{showRoot && <RootRow hint={target?.path === '' ? target.position : undefined} selected={isSelected(null)} disabled={disabled} onSelect={() => onSelect(null)} onDropNote={dropNote && (note => dropNote(note, null))} />} {tree.map(rootNode => <TreeBranch key={rootNode.path} node={rootNode} target={target} expanded={expanded} onToggleExpand={toggleExpand} disabled={disabled} isSelected={isSelected} selectFolder={onSelect} onManageFiles={onManageFiles} onDropNote={writable ? dropNote : undefined} />)}</NavTree>
        <DragOverlay>
          {dragging && (
            <div className='screen-drag-overlay'>
              <Folder size={16} />
              {list.find(folder => folder.path === dragging)?.title}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </section>
  );
}
