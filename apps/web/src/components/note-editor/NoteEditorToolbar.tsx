import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, ListOrdered, PanelRight, Pencil, Save, Type } from 'lucide-react';
import { useTranslation } from '../../lib/i18n/index.js';
import type { NoteItem } from '../../lib/types.js';
import { Button } from '../Button.js';
import type { MarkdownEditorMode } from '../MarkdownEditor.js';
import { EditorModeToggle } from './EditorModeToggle.js';
import { AssistantDockToggle } from '../assistant/AssistantDockToggle.js';
import { NoteActionsMenu } from './NoteActionsMenu.js';
import { NoteRefreshAction } from './NoteQuickActions.js';
import { NoteRow } from './NoteRow.js';
import type { NoteDocumentPanelState } from './useNoteDocumentPanel.js';
import type { NoteEditorSessionState } from './useNoteEditorSession.js';

interface NoteEditorToolbarProps {
  frame: 'zoom' | 'pane';
  note: NoteItem;
  session: NoteEditorSessionState;
  docPanel: NoteDocumentPanelState;
  isMarkdown: boolean;
  autoSave: boolean;
  readOnly: boolean;
  editorMode: MarkdownEditorMode;
  setEditorMode: (mode: MarkdownEditorMode) => void;
  showLineNumbers: boolean;
  toggleLineNumbers: () => void;
  showFormatToolbar: boolean;
  /** Present when the note offers a formatting toolbar: an editable Markdown note. */
  toggleFormatToolbar?: () => void;
  /** Present when the note can pull its latest version; zoom shows it first among the actions. */
  onRefresh?: () => Promise<void>;
  onClose?: () => void;
  onAddToOutline?: () => void;
  /** Moves the note to another folder of its notebook; a new note starts at the root and is filed from here. */
  onMove?: () => void;
  /** Renames the note to the typed title, its file name following; absent where the note cannot be renamed. */
  onRename?: (title: string) => Promise<void> | void;
  statuses: string[];
  availableTags: string[];
  /** Pane frame: the Focus pane's tab bar, which holds the actions. Without it (a phone, where the bar has no room) the actions sit in a row of their own above the note row. */
  actionsSlot?: HTMLElement | null;
  /** On a phone, where a note opens for reading: whether it is being edited, and the buttons that switch. */
  phoneEditing?: { editing: boolean; onEdit: () => void; onDone: () => void; };
}

/** Switches a phone's note between reading and editing. */
function PhoneEditToggle({ editing, onEdit, onDone }: NonNullable<NoteEditorToolbarProps['phoneEditing']>) {
  const { t } = useTranslation();
  return (
    <Button variant={editing ? 'primary' : undefined} className='note-edit-toggle' onClick={editing ? onDone : onEdit}>
      {editing ? <Check aria-hidden='true' /> : <Pencil aria-hidden='true' />}
      <span>{t(editing ? 'editor.finishEditing' : 'editor.startEditing')}</span>
    </Button>
  );
}

/** Reopens the section the panel showed last; an outline falls back to find for a note that is not Markdown. */
function togglePanel(docPanel: NoteDocumentPanelState, isMarkdown: boolean) {
  const last = docPanel.lastNotePanel.current;
  if (docPanel.notePanel) docPanel.setNotePanel(null);
  else if (last === 'find' || (last === 'outline' && !isMarkdown)) docPanel.openFind();
  else if (last === 'outline') docPanel.openOutline();
  else docPanel.setNotePanel(last);
}

/** The editor's actions: refresh and save, the view (mode, line numbers, formatting toolbar), the "⋯" menu, and in zoom the panels. */
function NoteActions({ frame, note, session, docPanel, isMarkdown, autoSave, readOnly, editorMode, setEditorMode, showLineNumbers, toggleLineNumbers, showFormatToolbar, toggleFormatToolbar, onRefresh, onAddToOutline, onMove, phoneEditing }: Omit<NoteEditorToolbarProps, 'statuses' | 'availableTags' | 'onClose' | 'onRename' | 'actionsSlot'>) {
  const { t } = useTranslation();
  const zoom = frame === 'zoom';
  return (
    <div className='note-controls flex items-center gap-2'>
      {zoom && onRefresh && <NoteRefreshAction iconOnly onRefresh={onRefresh} disabled={session.isSaving} />}
      {!autoSave && !readOnly && (
        <Button variant='primary' aria-label={t('editor.saveToGitHub')} title={t('editor.saveToGitHub')} disabled={session.locked || !session.hasUnsavedChanges} onClick={session.handleExplicitSave} className='note-save editor-action'>
          <Save className='editor-mobile-icon w-5 h-5' />
          <span>{t(session.isSaving ? 'editor.saving' : 'editor.saveToGitHub')}</span>
        </Button>
      )}
      {!zoom && phoneEditing && <PhoneEditToggle {...phoneEditing} />}
      {/* Two groups in zoom, set apart by a thin separator: the view with the "⋯" menu, and the panels. */}
      <div role='group' className='note-controls-group' aria-label={t('editor.controlsView')}>
        {isMarkdown && <EditorModeToggle mode={editorMode} onChange={setEditorMode} className='ui-icon-button toolbar-icon-button editor-mode-toggle' showKey />}
        <button type='button' aria-pressed={showLineNumbers} aria-label={t('editor.lineNumbers')} title={t('editor.lineNumbers')} onClick={toggleLineNumbers} className='ui-icon-button toolbar-icon-button editor-line-numbers-action'>
          <ListOrdered aria-hidden='true' />
        </button>
        {toggleFormatToolbar && (
          <button type='button' aria-pressed={showFormatToolbar} aria-label={t('editor.formatToolbar')} title={t('editor.formatToolbar')} onClick={toggleFormatToolbar} className='ui-icon-button toolbar-icon-button editor-format-toolbar-action'>
            <Type aria-hidden='true' />
          </button>
        )}
        <NoteActionsMenu className='ui-icon-button toolbar-icon-button editor-more-action' path={note.path} notebookId={note.notebookId} title={session.title} content={session.content} copyState={session.copyState} onCopy={session.copyNote} locked={session.locked} onAddToOutline={onAddToOutline} onMove={onMove} />
      </div>
      {/* A Focus pane leaves the document panel to its rail and the assistant to the window's own toggle, so several panes do not repeat them. */}
      {zoom && (
        <div role='group' className='note-controls-group' aria-label={t('editor.controlsPanels')}>
          <button type='button' aria-label={t('editor.documentPanel')} title={t('editor.documentPanel')} aria-pressed={Boolean(docPanel.notePanel)} onClick={() => togglePanel(docPanel, isMarkdown)} className='ui-icon-button toolbar-icon-button editor-panel-action'>
            <PanelRight aria-hidden='true' />
          </button>
          <AssistantDockToggle className='toolbar-icon-button editor-assistant-action' />
        </div>
      )}
    </div>
  );
}

/**
 * The zoom and pane editor's top bars. The note row carries the title, status, tags and the frontmatter button; the actions
 * follow it in zoom, which makes one row led by the back button, and go into the Focus pane's tab bar in a pane.
 */
export function NoteEditorToolbar({ onClose, onRename, statuses, availableTags, actionsSlot, phoneEditing, ...actions }: NoteEditorToolbarProps) {
  const { t } = useTranslation();
  const { frame, note, session, docPanel, readOnly } = actions;
  const zoom = frame === 'zoom';
  const controls: ReactNode = <NoteActions {...actions} phoneEditing={phoneEditing} />;
  return (
    <div className='note-toolbar relative shrink-0 px-4 py-2 border-b border-line flex items-center justify-between gap-4 bg-sidebar/60' data-actions={zoom ? 'row' : actionsSlot ? 'bar' : 'inline'}>
      {zoom && (onClose
        ? (
          <button type='button' aria-label={t('editor.closeNote')} title={t('editor.closeNote')} onClick={session.close} className='note-close ui-icon-button toolbar-icon-button shrink-0'>
            <ArrowLeft aria-hidden='true' />
          </button>
        )
        : null)}
      <NoteRow path={note.path} session={session} docPanel={docPanel} statuses={statuses} availableTags={availableTags} readOnly={readOnly} onRename={onRename} />
      {zoom && phoneEditing && <PhoneEditToggle {...phoneEditing} />}
      {actionsSlot ? createPortal(controls, actionsSlot) : controls}
    </div>
  );
}
