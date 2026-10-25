import { type ReactNode, useState } from 'react';
import { ArrowLeft, Check, Code2, Copy, Eye, FileText, FolderInput, ListTree, MoreHorizontal, Pencil, PencilLine, Printer, Save, Type } from 'lucide-react';
import { withNoteStatus } from '@mygitnotes/core/note-status';
import '../phone-notes.css';
import { useTranslation } from '../../lib/i18n/index.js';
import { downloadTextFile, printNoteAsPdf } from '../../lib/note-export.js';
import { noteStem } from '../../lib/note-move.js';
import { type PanelToolId, usePanelContext } from '../../lib/panel-context.js';
import { usePhoneNotes } from '../../lib/phone-notes.js';
import type { NoteItem } from '../../lib/types.js';
import type { MarkdownEditorMode } from '../MarkdownEditor.js';
import { NoteStatusSelect } from '../NoteStatusSelect.js';
import { PhoneSheet } from '../PhoneSheet.js';
import { PHONE_TOOLS } from './phone-tools.js';
import { NoteRowTags } from './NoteRowTags.js';
import type { NoteDocumentPanelState } from './useNoteDocumentPanel.js';
import type { NoteEditorSessionState } from './useNoteEditorSession.js';

export interface PhoneNoteChromeProps {
  frame: 'zoom' | 'pane';
  note: NoteItem;
  session: NoteEditorSessionState;
  docPanel: NoteDocumentPanelState;
  isMarkdown: boolean;
  autoSave: boolean;
  readOnly: boolean;
  editorMode: MarkdownEditorMode;
  setEditorMode: (mode: MarkdownEditorMode) => void;
  showFormatToolbar: boolean;
  /** Present when the note offers a formatting toolbar: an editable Markdown note. */
  toggleFormatToolbar?: () => void;
  onAddToOutline?: () => void;
  onMove?: () => void;
  onRename?: (title: string) => Promise<void> | void;
  statuses: string[];
  availableTags: string[];
  /** Whether the note has a history section to offer. */
  hasHistory: boolean;
  /** Refresh, Commit and Restore, which the footer carried before a phone had none. */
  quickActions: ReactNode;
  /** Reading versus editing: the title bar's toggle. Absent while the note cannot be edited. */
  phoneEditing?: { editing: boolean; onEdit: () => void; onDone: () => void; };
  /** The bar rides over the text and slides away while the text scrolls down; false keeps it in the page flow, above a notice or the formatting toolbar. */
  overlay: boolean;
  hidden: boolean;
}

/** A phone's note screen top: back to the list, the title, the status dot, edit or read, and the "⋯" sheet that holds everything else. */
export function PhoneNoteChrome(props: PhoneNoteChromeProps) {
  const { t } = useTranslation();
  const { frame, session, autoSave, readOnly, statuses, phoneEditing, overlay, hidden } = props;
  const { back } = usePhoneNotes();
  const [menuOpen, setMenuOpen] = useState(false);
  const title = session.title || t('editor.untitled');
  return (
    <>
      <div className='phone-note-bar' role='group' aria-label={t('phone.noteBar')} data-overlay={overlay || undefined} data-hidden={hidden || undefined} {...(hidden ? { inert: '' } : {})}>
        {frame === 'zoom'
          ? (
            <button type='button' className='ui-icon-button' aria-label={t('editor.closeNote')} title={t('editor.closeNote')} onClick={session.close}>
              <ArrowLeft aria-hidden='true' />
            </button>
          )
          : (
            <button type='button' className='ui-icon-button' aria-label={t('phone.back')} title={t('phone.back')} onClick={back}>
              <ArrowLeft aria-hidden='true' />
            </button>
          )}
        <div className='phone-note-title' title={title}>{title}</div>
        <NoteStatusSelect dotOnly status={String(session.metadata.status || '')} statuses={statuses} readOnly={session.locked} onChange={status => session.setMetadata(withNoteStatus(session.metadata, status))} label={t('editor.status')} />
        {!autoSave && !readOnly && (
          <button type='button' className='ui-icon-button' aria-label={t('editor.saveToGitHub')} title={t('editor.saveToGitHub')} disabled={session.locked || !session.hasUnsavedChanges} onClick={session.handleExplicitSave}>
            <Save aria-hidden='true' />
          </button>
        )}
        {phoneEditing && <button type='button' className='ui-icon-button phone-note-edit' aria-pressed={phoneEditing.editing} aria-label={t(phoneEditing.editing ? 'editor.finishEditing' : 'editor.startEditing')} title={t(phoneEditing.editing ? 'editor.finishEditing' : 'editor.startEditing')} onClick={phoneEditing.editing ? phoneEditing.onDone : phoneEditing.onEdit}>{phoneEditing.editing ? <Check aria-hidden='true' /> : <Pencil aria-hidden='true' />}</button>}
        <button type='button' className='ui-icon-button' aria-label={t('editor.moreActions')} title={t('editor.moreActions')} aria-haspopup='dialog' aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
          <MoreHorizontal aria-hidden='true' />
        </button>
      </div>
      {menuOpen && <PhoneNoteSheet {...props} title={title} onClose={() => setMenuOpen(false)} />}
    </>
  );
}

/** One row of the sheet: an icon, a name, and what it does when pressed. */
function SheetItem({ icon, label, onClick, disabled, pressed }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; }) {
  return (
    <button type='button' className='phone-sheet-item' disabled={disabled} aria-pressed={pressed} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

/** Renaming in the sheet: the title in a field, Enter or the button renames the note, its file name following. */
function RenameRow({ title, onRename, onDone }: { title: string; onRename: (title: string) => Promise<void> | void; onDone: () => void; }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (draft === null) return <SheetItem icon={<PencilLine aria-hidden='true' />} label={t('files.rename')} onClick={() => setDraft(title)} />;
  const next = draft.trim();
  const valid = Boolean(noteStem(next));
  const submit = async () => {
    if (!valid || busy) return;
    if (next === title) return onDone();
    setBusy(true);
    try {
      await onRename(next);
    } finally {
      setBusy(false);
      onDone();
    }
  };
  return (
    <form
      className='phone-sheet-rename'
      onSubmit={event => {
        event.preventDefault();
        void submit();
      }}
    >
      <input
        className='ui-control'
        aria-label={t('files.renameLabel')}
        value={draft}
        maxLength={100}
        autoFocus
        onFocus={event => event.target.select()}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            setDraft(null);
          }
        }}
      />
      <button type='submit' className='ui-button' disabled={!valid || busy}>{t('files.rename')}</button>
    </form>
  );
}

/** The "⋯" sheet: the note's status and tags, the tools the rail offered on a larger screen, and the actions that file or export it. */
function PhoneNoteSheet({ frame, note, session, docPanel, isMarkdown, readOnly, editorMode, setEditorMode, showFormatToolbar, toggleFormatToolbar, onAddToOutline, onMove, onRename, statuses, availableTags, hasHistory, quickActions, title, onClose }: PhoneNoteChromeProps & { title: string; onClose: () => void; }) {
  const { t } = useTranslation();
  const panel = usePanelContext();
  const { changesCount } = usePhoneNotes();
  const words = session.content.trim().split(/\s+/).filter(Boolean).length;
  const filename = note.path.split('/').pop() || 'note.md';
  // A zoomed note covers the workspace tools; only the note's own sections are offered there.
  const tools = PHONE_TOOLS.filter(tool => (frame === 'pane' || !['calendar', 'todo', 'changes'].includes(tool.id)) && (tool.id !== 'outline' || isMarkdown) && (tool.id !== 'history' || hasHistory));
  const openTool = (id: PanelToolId) => {
    onClose();
    if (id === 'find') docPanel.openFind();
    else if (id === 'outline') docPanel.openOutline();
    else if (id === 'frontmatter' || id === 'view' || id === 'history') docPanel.setNotePanel(id);
    else panel.openTool(id);
  };
  const act = (run: () => void) => () => {
    onClose();
    run();
  };
  return (
    <PhoneSheet title={title} onClose={onClose} className='phone-note-sheet'>
      <p className='phone-sheet-meta' role='status' aria-label={t('phone.saveState')}>{t('editor.words', { count: words })}{' · '}{session.editorStatus}</p>
      <section className='phone-sheet-section' aria-label={t('phone.noteActions')}>
        <div className='phone-sheet-field'>
          <span>{t('editor.status')}</span>
          <NoteStatusSelect status={String(session.metadata.status || '')} statuses={statuses} readOnly={session.locked} onChange={status => session.setMetadata(withNoteStatus(session.metadata, status))} label={t('editor.status')} />
        </div>
        <NoteRowTags metadata={session.metadata} setMetadata={session.setMetadata} availableTags={availableTags} locked={session.locked} />
      </section>
      <section className='phone-sheet-section' aria-label={t('phone.noteTools')}>
        <div className='phone-sheet-tools'>
          {tools.map(({ id, icon: Icon, label }) => (
            <button
              type='button'
              key={id}
              className='phone-sheet-tool'
              data-tool={id}
              onClick={() => openTool(id)}
            >
              <Icon aria-hidden='true' />
              {id === 'changes' && changesCount > 0 && <span className='phone-sheet-badge' aria-label={String(changesCount)}>{changesCount > 99 ? '99+' : changesCount}</span>}
              <span>{t(label)}</span>
            </button>
          ))}
        </div>
      </section>
      <section className='phone-sheet-section phone-sheet-list'>
        {isMarkdown && <SheetItem icon={editorMode === 'live' ? <Code2 aria-hidden='true' /> : <Eye aria-hidden='true' />} label={t(editorMode === 'live' ? 'editor.switchToSource' : 'editor.switchToLive')} onClick={act(() => setEditorMode(editorMode === 'live' ? 'raw' : 'live'))} />}
        {toggleFormatToolbar && <SheetItem icon={<Type aria-hidden='true' />} label={t('editor.formatToolbar')} pressed={showFormatToolbar} onClick={toggleFormatToolbar} />}
        <div className='phone-sheet-quick'>{quickActions}</div>
        {onRename && !readOnly && <RenameRow title={session.title} onRename={onRename} onDone={onClose} />}
        {onMove && <SheetItem icon={<FolderInput aria-hidden='true' />} label={t('files.moveNote')} disabled={session.locked} onClick={act(onMove)} />}
        {onAddToOutline && <SheetItem icon={<ListTree aria-hidden='true' />} label={t('outline.add')} disabled={session.locked} onClick={act(onAddToOutline)} />}
        <SheetItem icon={<Copy aria-hidden='true' />} label={t(session.copyState === 'copied' ? 'editor.noteCopied' : session.copyState === 'error' ? 'editor.noteCopyFailed' : 'editor.exportCopy')} onClick={() => void session.copyNote()} />
        <SheetItem icon={<FileText aria-hidden='true' />} label={t('editor.exportMarkdown')} onClick={act(() => downloadTextFile(filename, session.content, 'text/markdown;charset=utf-8'))} />
        <SheetItem icon={<Printer aria-hidden='true' />} label={t('editor.exportPdf')} onClick={act(() => void printNoteAsPdf(session.title || filename, session.content, note.path, t('mermaid.error'), note.notebookId))} />
      </section>
    </PhoneSheet>
  );
}
