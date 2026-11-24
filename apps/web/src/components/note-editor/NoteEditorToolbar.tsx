import { Tooltip } from '../Tooltip.js';
import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ListOrdered, Maximize2, Minimize2, PanelRight, Pencil, Play, Save, ScrollText, Type, X } from 'lucide-react';
import { hasKeymapEntry, primaryShortcutHint } from '../../lib/keyboard/keymap.js';
import { useTranslation } from '../../lib/i18n/index.js';
import type { NoteItem } from '../../lib/types.js';
import { Button } from '../Button.js';
import type { MarkdownEditorMode } from '../MarkdownEditor.js';
import { EditorModeGroup } from './EditorModeGroup.js';
import { AssistantDockToggle } from '../assistant/AssistantDockToggle.js';
import { TypstPreviewToggle } from '../typst-preview/TypstPreviewToggle.js';
import { type LiveDraftActions, NoteActionsMenu } from './NoteActionsMenu.js';
import { noteLanguageTag } from '../../lib/note-language.js';
import { NoteRefreshAction } from './NoteQuickActions.js';
import { NoteRow } from './NoteRow.js';
import { PhoneNoteChrome, type PhoneNoteChromeProps } from './PhoneNoteChrome.js';
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
  /** The modes the head toolbar offers, in order; live and source when left out. */
  editorModes?: readonly MarkdownEditorMode[];
  showLineNumbers: boolean;
  toggleLineNumbers: () => void;
  showFormatToolbar: boolean;
  /** Present when the note offers a formatting toolbar: an editable Markdown note. */
  toggleFormatToolbar?: () => void;
  /** Present when the note can pull its latest version; zoom shows it first among the actions. */
  onRefresh?: () => Promise<void>;
  onClose?: () => void;
  toggleZoom?: () => Promise<void>;
  hasZoomNavigation?: boolean;
  onAddToOutline?: () => void;
  /** Present for a slide note: plays it as a deck, or opens its speaker notes. */
  /** `opener` is the button pressed, which takes the focus back when the deck closes. */
  onPlaySlides?: (view: 'deck' | 'notes', opener?: HTMLElement) => void;
  /** Moves the note to another folder of its notebook; a new note starts at the root and is filed from here. */
  onMove?: () => void;
  /** Renames the note to the typed title, its file name following; absent where the note cannot be renamed. */
  onRename?: (title: string) => Promise<void> | void;
  /** The note is a template file: the note row says so. */
  template?: boolean;
  /** The note's frontmatter does not parse: the row and the phone's bar warn instead of showing a status and tags. */
  frontmatterInvalid?: boolean;
  /** A pending live note whose filing can be changed: its menu offers move and rename while the note is read-only. */
  liveDraft?: LiveDraftActions;
  /** Copies the note into its notebook's templates; absent for a template and a read-only note. */
  onSaveAsTemplate?: () => void;
  statuses: string[];
  availableTags: string[];
  /** Pane frame: the Focus pane's tab bar, which holds the actions. Without it (a phone, where the bar has no room) the actions sit in a row of their own above the note row. */
  actionsSlot?: HTMLElement | null;
  /** On a phone, where a note opens for reading: whether it is being edited, and the buttons that switch. */
  phoneEditing?: { editing: boolean; onEdit: () => void; onDone: () => void; };
  /** On a phone the toolbar is the note screen's title bar and its "⋯" sheet instead of the rows below. */
  phoneChrome?: Pick<PhoneNoteChromeProps, 'quickActions' | 'hasHistory' | 'overlay' | 'hidden' | 'liveBadge' | 'liveEditing'>;
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
function NoteActions({ frame, note, session, docPanel, isMarkdown, autoSave, readOnly, editorMode, setEditorMode, editorModes = ['live', 'raw'], showLineNumbers, toggleLineNumbers, showFormatToolbar, toggleFormatToolbar, onRefresh, onAddToOutline, onPlaySlides, onMove, onSaveAsTemplate, liveDraft, phoneEditing, onClose, toggleZoom, hasZoomNavigation }: Omit<NoteEditorToolbarProps, 'statuses' | 'availableTags' | 'onRename' | 'actionsSlot' | 'template'>) {
  const { t } = useTranslation();
  const zoom = frame === 'zoom';
  const zoomLabel = t(zoom ? 'editor.returnToFocus' : 'editor.zoomNote');
  const zoomHint = !zoom && hasKeymapEntry('focus-zoom-tab') ? primaryShortcutHint('focus-zoom-tab') : undefined;
  return (
    <div className='note-controls flex items-center gap-2'>
      {zoom && onRefresh && <NoteRefreshAction iconOnly onRefresh={onRefresh} disabled={session.isSaving} />}
      {!autoSave && !readOnly && (
        <Tooltip label={t('editor.saveToGitHub')}>
          <Button variant='primary' aria-label={t('editor.saveToGitHub')} disabled={session.locked || !session.hasUnsavedChanges} onClick={session.handleExplicitSave} className='note-save editor-action'>
            <Save className='editor-mobile-icon w-5 h-5' />
            <span>{t(session.isSaving ? 'editor.saving' : 'editor.saveToGitHub')}</span>
          </Button>
        </Tooltip>
      )}
      {!zoom && phoneEditing && <PhoneEditToggle {...phoneEditing} />}
      {onPlaySlides && (
        <div role='group' className='note-controls-group' aria-label={t('slides.playTitle')}>
          <Tooltip label={t('slides.playTitle')}>
            <button type='button' aria-label={t('slides.play')} onClick={event => onPlaySlides('deck', event.currentTarget)} className='ui-icon-button toolbar-icon-button editor-slides-play-action'>
              <Play aria-hidden='true' />
            </button>
          </Tooltip>
          <Tooltip label={t('slides.notesViewTitle')}>
            <button type='button' aria-label={t('slides.notesView')} onClick={event => onPlaySlides('notes', event.currentTarget)} className='ui-icon-button toolbar-icon-button editor-slides-notes-action'>
              <ScrollText aria-hidden='true' />
            </button>
          </Tooltip>
        </div>
      )}
      {/* The mode leads the view, in a group of its own so it reads at a glance. */}
      {isMarkdown && <EditorModeGroup mode={editorMode} modes={editorModes} onChange={setEditorMode} />}
      {/* Two groups in zoom, set apart by a thin separator: the view with the "⋯" menu, and the panels. */}
      <div role='group' className='note-controls-group' aria-label={t('editor.controlsView')}>
        <Tooltip label={t('editor.lineNumbers')}>
          <button type='button' aria-pressed={showLineNumbers} aria-label={t('editor.lineNumbers')} onClick={toggleLineNumbers} className='ui-icon-button toolbar-icon-button editor-line-numbers-action'>
            <ListOrdered aria-hidden='true' />
          </button>
        </Tooltip>
        {toggleFormatToolbar && (
          <Tooltip label={t('editor.formatToolbar')}>
            <button type='button' aria-pressed={showFormatToolbar} aria-label={t('editor.formatToolbar')} onClick={toggleFormatToolbar} className='ui-icon-button toolbar-icon-button editor-format-toolbar-action'>
              <Type aria-hidden='true' />
            </button>
          </Tooltip>
        )}
        {isMarkdown && <TypstPreviewToggle note={note} className='toolbar-icon-button editor-typst-preview-action' />}
        <NoteActionsMenu className='ui-icon-button toolbar-icon-button editor-more-action' path={note.path} notebookId={note.notebookId} noteLang={noteLanguageTag(session.metadata)} title={session.title} content={session.content} copyState={session.copyState} onCopy={session.copyNote} locked={session.locked} onAddToOutline={onAddToOutline} onMove={onMove} onSaveAsTemplate={onSaveAsTemplate} liveDraft={liveDraft} />
      </div>
      {/* A Focus pane leaves the document panel to its rail and the assistant to the window's own toggle, so several panes do not repeat them. */}
      {zoom && (
        <div role='group' className='note-controls-group' aria-label={t('editor.controlsPanels')}>
          <Tooltip label={t('editor.documentPanel')}>
            <button type='button' aria-label={t('editor.documentPanel')} aria-pressed={Boolean(docPanel.notePanel)} onClick={() => togglePanel(docPanel, isMarkdown)} className='ui-icon-button toolbar-icon-button editor-panel-action'>
              <PanelRight aria-hidden='true' />
            </button>
          </Tooltip>
          <AssistantDockToggle className='toolbar-icon-button editor-assistant-action' />
        </div>
      )}
      {hasZoomNavigation && (
        <Tooltip label={zoomLabel} detail={zoomHint}>
          <button type='button' aria-label={zoomLabel} aria-pressed={zoom} disabled={!toggleZoom} onClick={toggleZoom} className='ui-icon-button toolbar-icon-button'>
            {zoom ? <Minimize2 aria-hidden='true' /> : <Maximize2 aria-hidden='true' />}
          </button>
        </Tooltip>
      )}
      {zoom && onClose && (
        <Tooltip label={t('editor.closeNote')}>
          <button type='button' aria-label={t('editor.closeNote')} onClick={session.close} className='ui-icon-button toolbar-icon-button shrink-0'>
            <X aria-hidden='true' />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * The zoom and pane editor's top bars. The note row carries the title, status, tags and the frontmatter button; the actions
 * follow it, or go into the Focus pane's tab bar when that pane hides this bar.
 */
export function NoteEditorToolbar({ onClose, onRename, template = false, frontmatterInvalid, statuses, availableTags, actionsSlot, phoneEditing, phoneChrome, ...actions }: NoteEditorToolbarProps) {
  const { frame, note, session, docPanel, readOnly } = actions;
  const zoom = frame === 'zoom';
  if (phoneChrome) {
    const { frame: phoneFrame, note: phoneNote, session: phoneSession, docPanel: phoneDocPanel, isMarkdown, autoSave, editorMode, setEditorMode, showFormatToolbar, toggleFormatToolbar, onAddToOutline, onPlaySlides, onMove, onSaveAsTemplate } = actions;
    return <PhoneNoteChrome {...phoneChrome} onPlaySlides={onPlaySlides} frame={phoneFrame} note={phoneNote} session={phoneSession} docPanel={phoneDocPanel} isMarkdown={isMarkdown} autoSave={autoSave} readOnly={readOnly} editorMode={editorMode} setEditorMode={setEditorMode} showFormatToolbar={showFormatToolbar} toggleFormatToolbar={toggleFormatToolbar} onAddToOutline={onAddToOutline} onMove={onMove} onRename={onRename} liveDraft={actions.liveDraft} template={template} frontmatterInvalid={frontmatterInvalid} onSaveAsTemplate={onSaveAsTemplate} statuses={statuses} availableTags={availableTags} phoneEditing={phoneEditing} />;
  }
  const controls: ReactNode = <NoteActions {...actions} phoneEditing={phoneEditing} onClose={onClose} />;
  return (
    <div className='note-toolbar relative shrink-0 px-4 py-2 border-b border-line flex items-center justify-between gap-4 bg-sidebar/60' data-actions={actionsSlot ? 'bar' : zoom || frame === 'pane' ? 'row' : 'inline'}>
      <NoteRow path={note.path} session={session} docPanel={docPanel} statuses={statuses} availableTags={availableTags} onRename={onRename} template={template} frontmatterInvalid={frontmatterInvalid} trailing={zoom && phoneEditing ? <PhoneEditToggle {...phoneEditing} /> : undefined} />
      {actionsSlot ? createPortal(controls, actionsSlot) : controls}
    </div>
  );
}
