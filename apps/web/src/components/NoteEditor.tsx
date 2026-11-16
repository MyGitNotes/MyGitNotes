import { EditorFooter } from './EditorFooter.js';
import { ListTree } from 'lucide-react';
import { useOutlineActions, useOutlineInsertion } from '../lib/outline-actions.js';
import { useTranslation } from '../lib/i18n/index.js';
import { NoteQuickActions } from './note-editor/NoteQuickActions.js';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { parseNoteFile } from '@mygitnotes/core/note-file';
import type { NoteMetadata } from '@mygitnotes/core';
import { currentNoteFile } from '../lib/current-note-file.js';
import type { LiveEditorCarry, LiveMarkdownHandle } from './LiveMarkdownEditor.js';
import { MarkdownEditor, type MarkdownEditorHandle, type MarkdownEditorMode } from './MarkdownEditor.js';
import type { NoteItem } from '../lib/types.js';
import { usePanelContext } from '../lib/panel-context.js';
import { usePhone } from '../lib/use-phone.js';
import { type NoteEditorSessionState, useNoteEditorSession } from './note-editor/useNoteEditorSession.js';
import { useNoteDocumentPanel } from './note-editor/useNoteDocumentPanel.js';
import { NoteCompactFrame } from './note-editor/NoteCompactFrame.js';
import { NoteInlineFrame } from './note-editor/NoteInlineFrame.js';
import { NoteEditorToolbar } from './note-editor/NoteEditorToolbar.js';
import { NoteEditorDocumentPanel } from './note-editor/NoteEditorDocumentPanel.js';
import { NoteEditorLeader } from './note-editor/NoteEditorLeader.js';
import { useVimCommands } from './note-editor/useVimCommands.js';
import { hasEditorNotices, NoteEditorNotices } from './note-editor/NoteEditorNotices.js';
import { usePhoneBarHidden } from './note-editor/usePhoneBarHidden.js';
import { FileManagerDialog } from './files/index.js';
import { today, type VersionText } from '../lib/history-api.js';
import { useNoteDiffStats } from './note-editor/useNoteDiffStats.js';
import { noteViewStyle, readShowFormatToolbar, readShowLineNumbers, useNoteViewPreferences, writeShowFormatToolbar, writeShowLineNumbers } from '../lib/editor-preferences.js';
import type { NoteEditorSession, NoteEditorSharedProps, NotePanelMode } from './note-editor/types.js';
import { createCaretStore } from '../lib/pi-agent/caret-store.js';
import { usePublishAgentTarget } from '../lib/pi-agent/session.js';
import { usePublishPreviewTarget } from '../lib/typst-preview/preview-target.js';
import { isSlideNote } from '../lib/slides/note.js';
import { SlideDeck, type SlideDeckView } from './slides/SlideDeck.js';
import { Pencil } from 'lucide-react';
import { Button } from './Button.js';
import { LiveEditorFrame } from './live/LiveEditorFrame.js';
import { useEditorModeRoute } from '../app/editor-mode-route.js';
import { shownEditorMode } from '../lib/editor-mode-url.js';
import { LiveCollabEditor, type LiveSession } from './live/LiveCollabEditor.js';
import { replaceLiveText, useLiveText, writeLiveFrontmatter, writeLiveYaml } from './live/live-frontmatter.js';
import { useLiveEdit, useLiveTheme } from './live/useLiveEdit.js';

export interface NoteEditorHandle {
  /** Inserts `text` at `at`, or at the caret; no-op while the session is locked. */
  insert: (text: string, at?: number) => void;
}

export interface NoteEditorProps extends NoteEditorSharedProps {
  note: NoteItem;
  /**
   * `zoom` fills the full-screen dialog and keeps its own document panel; `pane` sits in a Focus pane;
   * `compact` is the body alone with a status bar, for a graph card; `inline` is the note as it reads with one line of
   * save state, for a compilation's card or Book section.
   */
  frame: 'zoom' | 'pane' | 'compact' | 'inline';
  /** The active editor answers document-level shortcuts and Escape. */
  active: boolean;
  /** Pane frame: the right rail chooses the document panel section and hosts it. */
  documentPanel?: { target: HTMLElement | null; mode: NotePanelMode | null; onChange: (mode: NotePanelMode | null) => void; };
  /** Zoom frame: saves, then leaves zoom. */
  onClose?: () => void;
  /** Opens the folder picker that moves the note; absent when its notebook is read-only. */
  onMove?: () => void;
  /** Renames the note to the typed title, its file name following; absent when its notebook is read-only. */
  onRename?: (title: string) => Promise<void> | void;
  /** Pane frame: where the Focus pane's tab bar takes the editor's actions; without it they sit above the note row. */
  actionsSlot?: HTMLElement | null;
  /** Reports the session whenever it changes, and null when the editor unmounts. */
  onSession?: (session: NoteEditorSession | null) => void;
  onCaret?: (position: number) => void;
}

/** The footer's actions: Refresh unless zoom shows it beside the title, and Commit and Restore for an editable dirty note. */
function footerActions({ frame, readOnly, session, refresh, canCommit }: { frame: NoteEditorProps['frame']; readOnly: boolean; session: NoteEditorSessionState; refresh?: () => Promise<void>; canCommit: boolean; }) {
  const editable = !readOnly && session.isDirty;
  return { onRefresh: frame === 'zoom' ? undefined : refresh, onCommit: editable && canCommit && !session.blocked ? async () => void await session.commitNote() : undefined, onRestore: editable ? session.restoreNote : undefined };
}

/** A note's editing session: content, frontmatter, drafts, autosave, conflicts, crash recovery and the document panel. */
export const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(({ note, frame, active, documentPanel, actionsSlot, onClose, onMove, onRename, onSession, onCaret, statuses, metadataFields, readOnly: givenReadOnly = false, autoSave = true, draftMode = false, remoteBase, conflictReason, onMarkConflict, onSave, onReadRemote, onRestoreFile, onCommitFile, readDiff, isDirty: propIsDirty = false, availableTags = [], beforeFileChange, onFilesChanged, branch, draftScope, template = false, onSaveAsTemplate, live, openInZoom }, ref) => {
  const isMarkdown = /\.(md|markdown|mdx)$/i.test(note.path);
  // A note of a repository with a live editor is read here and edited there; `refresh` is declared below and read only after render.
  const liveEdit = useLiveEdit({ note, live, frame, refetch: () => void refresh?.(), hasDraft: () => Boolean(sessionRef.current?.isDirty) });
  const liveTheme = useLiveTheme();
  // A pending live note is read here, yet where its live editor can retarget it the app hands it move and rename (it is
  // movable then), which set where its check-in files it. A collab-first note's own editor moves, renames and deletes it
  // after checking it in (A7).
  const own = givenReadOnly ? undefined : liveEdit.fileActions;
  const liveDraft = liveEdit.active && note.live?.pending && !givenReadOnly && onMove ? { onRename: onRename && frame === 'zoom' ? () => void onRename(note.title) : undefined } : own ? { onRename: own.rename && (() => void own.rename!()), onDelete: own.remove } : undefined;
  const moveNote = own?.move ? () => void own.move!() : givenReadOnly || template ? undefined : onMove;
  // Offline, the direct editor writes nothing over the note's conflict draft, its one draft slot (cf16-F002).
  const readOnly = givenReadOnly || liveEdit.active || liveEdit.conflictHold;
  const { setHasOpenNote } = usePanelContext();
  // The workspace rail hides only behind zoom; a pane editor shares the page with it. It hides before the
  // first paint, so zoom opens at its final width instead of widening once the rail has gone.
  useLayoutEffect(() => {
    if (frame !== 'zoom') return;
    setHasOpenNote(true);
    return () => setHasOpenNote(false);
  }, [frame, setHasOpenNote]);

  // A phone has no room for line numbers, and its notes have no card frame: whatever this device chose for a larger screen stays stored.
  const phone = usePhone();
  // Zoom and a Focus pane take their mode from the page's URL (`?mode=`); a graph card, and an editor embedded without the
  // app's router, keep their own. Split needs zoom on a wider screen: a phone and a Focus pane show live for it, and a pane
  // hands split to zoom, so Back returns to the pane.
  const modeRoute = useEditorModeRoute();
  const routed = modeRoute && (frame === 'zoom' || frame === 'pane') ? modeRoute : null;
  const [ownMode, setOwnMode] = useState<MarkdownEditorMode>('live');
  const editorMode = routed ? shownEditorMode(routed.mode, { frame: frame as 'zoom' | 'pane', phone }) : ownMode;
  const setEditorMode = (mode: MarkdownEditorMode) => {
    if (!routed) return setOwnMode(mode);
    if (mode === 'split' && frame === 'pane') return openInZoom?.('split');
    routed.setMode(mode);
  };
  const editorModes: MarkdownEditorMode[] = routed && !phone && (frame === 'zoom' || openInZoom) ? ['live', 'raw', 'split'] : ['live', 'raw'];
  const [showLineNumbers, setShowLineNumbers] = useState(() => readShowLineNumbers(note.notebookId));
  const toggleLineNumbers = () =>
    setShowLineNumbers(value => {
      const next = !value;
      writeShowLineNumbers(next);
      return next;
    });
  const [showFormatToolbar, setShowFormatToolbar] = useState(() => readShowFormatToolbar());
  const toggleFormatToolbar = () =>
    setShowFormatToolbar(value => {
      const next = !value;
      writeShowFormatToolbar(next);
      return next;
    });
  const viewPreferences = useNoteViewPreferences();
  const lineNumbersShown = showLineNumbers && !phone;
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  // The editor's view is rebuilt when the note moves between frames, as a zoom borrows it from a card or a Book section; this hands its caret and undo history over.
  const carry = useRef<LiveEditorCarry | null>(null);
  const [caret] = useState(createCaretStore);
  const trackCaret = (position: number, end?: number) => {
    caret.set(position, end);
    onCaret?.(position);
  };

  const directSession = useNoteEditorSession({ note, readOnly, autoSave, draftMode, remoteBase, conflictReason, onMarkConflict, onSave, onReadRemote, onRestoreFile, onCommitFile, propIsDirty, branch, draftScope, onClose, onSession });
  // A note in the built-in collab editor: its row and document panel read and write the live text (collab-frontmatter).
  const [liveSession, setLiveSession] = useState<LiveSession | null>(null);
  const collabShown = Boolean(live && liveEdit.checkout && live.editor.kind === 'builtin');
  const shared = collabShown ? liveSession : null;
  const { text: liveText, frontmatter: liveFrontmatter } = useLiveText(shared?.text ?? null);
  const collabEditorRef = useRef<LiveMarkdownHandle>(null);
  const liveBody = shared ? liveText.slice(liveFrontmatter.bodyStart) : '';
  const liveTitle = useMemo(() => (shared ? parseNoteFile(liveText.slice(0, liveFrontmatter.bodyStart) + liveBody, note.path).title : ''), [shared, liveText, liveFrontmatter.bodyStart, liveBody, note.path]);
  const liveLocked = !shared?.online || !liveFrontmatter.valid;
  const liveShared = useRef<{ text: LiveSession['text'] | null; metadata: NoteMetadata; }>({ text: null, metadata: {} });
  useEffect(() => {
    liveShared.current = { text: shared?.text ?? null, metadata: liveFrontmatter.metadata };
  });
  /** Writes the keys the control changed into the live text; the YAML view writes its text. Nothing while offline (Q2). */
  const setLiveMetadata = useCallback((next: Record<string, unknown>, yaml?: string) => {
    const { text, metadata } = liveShared.current;
    if (!text) return;
    if (yaml !== undefined) writeLiveYaml(text, yaml);
    else writeLiveFrontmatter(text, metadata, next as NoteMetadata);
  }, []);
  const session: NoteEditorSessionState = shared ? { ...directSession, content: liveBody, metadata: liveFrontmatter.metadata, title: liveTitle, locked: liveLocked, setMetadata: setLiveMetadata as NoteEditorSessionState['setMetadata'] } : directSession;
  // Read when the browser is back online: a direct editor opened offline gives way to the collab editor only with nothing typed.
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  });
  const outlines = useOutlineActions();
  const awaitingRecovery = useOutlineInsertion(note, session, editorRef);
  const addToOutline = !template && outlines?.canAdd(note.notebookId) && !session.locked ? () => outlines.add({ ...note, title: session.title, content: session.content }) : undefined;
  // A graph card has no footer to show the counts in.
  const { t } = useTranslation();
  const changes = useNoteDiffStats(frame === 'compact' || frame === 'inline' ? undefined : readDiff, session.isDirty, !session.isSaving && !session.hasUnsavedChanges);
  const refresh = onReadRemote && !session.blocked ? session.pullLatest : undefined;
  // The panel's find and outline speak in body positions and lines; the collab editor holds the whole file, frontmatter included.
  const liveOffsets = useRef({ on: false, bodyStart: 0, lines: 0 });
  useEffect(() => {
    liveOffsets.current = { on: Boolean(shared), bodyStart: liveFrontmatter.bodyStart, lines: liveFrontmatter.lineOffset };
  });
  const panelEditorRef = useRef<MarkdownEditorHandle>(null);
  /* eslint-disable react/refs -- A stable handle that forwards to whichever editor shows the note. */
  if (!panelEditorRef.current) {
    const collabEditor = () => (liveOffsets.current.on ? collabEditorRef.current : null);
    (panelEditorRef as React.MutableRefObject<MarkdownEditorHandle>).current = {
      insert: (text, at) => editorRef.current?.insert(text, at),
      insertAnnotated: line => editorRef.current?.insertAnnotated(line),
      revealRange: (from, to, focus) => {
        const collab = collabEditor();
        if (!collab) return editorRef.current?.revealRange(from, to, focus);
        collab.revealRange(from + liveOffsets.current.bodyStart, to + liveOffsets.current.bodyStart, focus);
      },
      goToLine: (line, options) => {
        const collab = collabEditor();
        if (!collab) return editorRef.current?.goToLine(line, options);
        collab.goToLine(line + liveOffsets.current.lines, options);
      },
      getCurrentLine: () => {
        const collab = collabEditor();
        return collab ? Math.max(1, collab.getCurrentLine() - liveOffsets.current.lines) : editorRef.current?.getCurrentLine() ?? 1;
      },
      getSelection: () => {
        const collab = collabEditor();
        if (!collab) return editorRef.current?.getSelection() ?? null;
        const selection = collab.getSelection();
        const start = liveOffsets.current.bodyStart;
        return selection && { from: Math.max(0, selection.from - start), to: Math.max(0, selection.to - start) };
      },
      ready: () => Boolean(collabEditor()?.ready() ?? editorRef.current?.ready()),
      focus: () => (collabEditor() ?? editorRef.current)?.focus(),
    };
  }
  /* eslint-enable react/refs */
  const docPanel = useNoteDocumentPanel({ frame, active, isMarkdown, content: session.content, editorMode, setEditorMode, documentPanel, editorRef: panelEditorRef, metadata: session.metadata, notePath: note.path, branch, draftScope, readOnly });
  // The active editor is the file the agent panel names to Pi, with the line its caret is on.
  const contentRef = useRef(session.content);
  useEffect(() => {
    contentRef.current = session.content;
  }, [session.content]);
  const lineNumberOffset = session.baseNote.lineNumberOffset || 0;
  const agentTarget = useMemo(() => ({ notebookId: note.notebookId, path: note.path, caret, content: () => contentRef.current, lineNumberOffset, focusEditor: () => editorRef.current?.focus() }), [note.notebookId, note.path, caret, lineNumberOffset, editorRef]);
  usePublishAgentTarget(agentTarget, active && (frame === 'zoom' || frame === 'pane'));
  // The same editor is the note the Typst preview follows.
  const previewNote = useMemo(() => ({ notebookId: note.notebookId, path: note.path }), [note.notebookId, note.path]);
  usePublishPreviewTarget(previewNote, active && (frame === 'zoom' || frame === 'pane'));

  // A phone opens every note for reading: a long press then only selects text instead of raising the keyboard,
  // whose resize moved the page under the selection. Editing starts from the toolbar's Edit button.
  const [editing, setEditing] = useState(false);
  const reading = phone && !editing && !session.locked;
  const finishEditing = () => {
    setEditing(false);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };
  // An insert made while reading switches to editing first; the editor drops inserts while it is read-only,
  // so the text waits until the editor has become writable.
  const pendingInserts = useRef<(() => void)[]>([]);
  const insert = (text: string, at?: number) => {
    if (session.locked) return;
    if (!reading) return editorRef.current?.insert(text, at);
    pendingInserts.current.push(() => editorRef.current?.insert(text, at));
    setEditing(true);
  };
  useEffect(() => {
    if (!reading) { for (const flush of pendingInserts.current.splice(0)) flush(); }
  }, [reading]);

  useImperativeHandle(ref, () => ({ insert }));

  const historyTarget = useMemo(() => ({ path: note.path, notebookId: note.notebookId }), [note.path, note.notebookId]);
  // The history compares and keeps the note as saving it would write the file; a restored file goes back into the editor's fields.
  const { content: sessionContent, metadata: sessionMetadata, setContent: setSessionContent, setMetadata: setSessionMetadata } = session;
  const [stampFallback] = useState(() => new Date());
  const currentFile = useCallback((latest: string | null) => currentNoteFile(note.path, sessionMetadata, sessionContent, latest, stampFallback), [note.path, sessionContent, sessionMetadata, stampFallback]);
  const restoreFile = useCallback((text: string) => {
    const parsed = parseNoteFile(text, note.path);
    setSessionContent(parsed.content);
    setSessionMetadata(parsed.metadata);
  }, [note.path, setSessionContent, setSessionMetadata]);

  const liveCurrent = useCallback(() => liveShared.current.text?.toString() ?? '', []);
  const restoreLive = useCallback((text: string) => {
    const shared = liveShared.current.text;
    if (shared && window.confirm(t('history.restoreLiveConfirm'))) replaceLiveText(shared, text);
  }, [t]);

  // The formatting toolbar's Insert image opens the notebook's assets; a chosen image goes in at the caret.
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  /** Whether the image being picked becomes an annotate block. */
  const [pickAnnotated, setPickAnnotated] = useState(false);
  const insertImage = (ref: string) => {
    setImagePickerOpen(false);
    if (!pickAnnotated) return insert(`\n${ref}\n`);
    if (session.locked) return;
    if (!reading) return editorRef.current?.insertAnnotated(ref);
    pendingInserts.current.push(() => editorRef.current?.insertAnnotated(ref));
    setEditing(true);
  };

  // A slide note plays as a deck over the window, from the text as it is now; the toolbar offers it for a Markdown note only.
  const [deck, setDeck] = useState<{ view: SlideDeckView; opener?: HTMLElement; } | null>(null);
  const slideDeck = isMarkdown && isSlideNote(session.metadata) ? (view: SlideDeckView, opener?: HTMLElement) => setDeck({ view, opener }) : undefined;

  // Vim's `:w` does what the footer's Commit does, or the toolbar's Save where the note saves by hand; with nothing to
  // write it succeeds, so `:wq` still closes. `:q` closes a zoomed note the way its back button does.
  const canCommitNow = Boolean(footerActions({ frame, readOnly, session, refresh, canCommit: Boolean(onCommitFile) }).onCommit);
  const vimRoot = useVimCommands({ write: async () => canCommitNow ? session.commitNote() : !autoSave && !readOnly && session.hasUnsavedChanges ? session.handleExplicitSave() : true, quit: frame === 'zoom' && onClose ? session.close : undefined });
  // A phone's note screen: the title bar rides over the text and slides away while it scrolls down, unless a notice, the formatting toolbar or the framed live editor's bar sits above the text and needs the room the bar would cover.
  const [rootElement, setRootElement] = useState<HTMLElement | null>(null);
  const rootRef = useCallback((node: HTMLElement | null) => {
    vimRoot(node);
    setRootElement(node);
  }, [vimRoot]);
  const formatToolbarShown = showFormatToolbar && !reading;
  const barOverlay = phone && !hasEditorNotices(session) && !formatToolbarShown && !liveEdit.checkout && !liveEdit.hasNotices;
  const barHidden = usePhoneBarHidden(rootElement, barOverlay);

  // A compilation's section and a graph card show the note as it reads; their 編輯 opens zoom.
  const liveEditButton = liveEdit.edit && (
    <div className='note-live-edit'>
      <Button size='small' onClick={liveEdit.edit} title={t('live.toolbar')}>
        <Pencil size={13} aria-hidden='true' />
        {t('editor.startEditing')}
      </Button>
    </div>
  );

  if (frame === 'inline') {
    return (
      <div className='note-editor' data-frame={frame} data-source-notebook={note.notebookId}>
        <NoteEditorNotices session={session} notePath={note.path} />
        {liveEditButton}
        {awaitingRecovery && (
          <p role='status'>
            {t('outline.recoveryPending')} <button type='button' className='ui-button' onClick={() => outlines?.cancel()}>{t('common.cancel')}</button>
          </p>
        )}
        <NoteInlineFrame note={note} session={session} editorRef={editorRef} onCaret={onCaret} carry={carry} />
      </div>
    );
  }

  if (frame === 'compact') {
    return (
      <div className='note-editor' data-frame={frame} data-source-notebook={note.notebookId}>
        <NoteEditorNotices session={session} notePath={note.path} />
        {liveEditButton}
        {addToOutline && (
          <button type='button' className='ui-icon-button' title={t('outline.add')} aria-label={t('outline.add')} onClick={addToOutline}>
            <ListTree aria-hidden='true' />
          </button>
        )}
        {awaitingRecovery && (
          <p role='status'>
            {t('outline.recoveryPending')} <button type='button' className='ui-button' onClick={() => outlines?.cancel()}>{t('common.cancel')}</button>
          </p>
        )}
        <NoteCompactFrame note={note} session={session} editorRef={editorRef} isMarkdown={isMarkdown} editorMode={editorMode} setEditorMode={setEditorMode} showLineNumbers={lineNumbersShown} toggleLineNumbers={toggleLineNumbers} onCaret={onCaret} carry={carry} />
      </div>
    );
  }

  const liveHistory = { target: historyTarget, dirty: true, current: liveCurrent, onRestore: shared?.online ? restoreLive : undefined };
  const liveRename = givenReadOnly || template ? undefined : liveEdit.checkout?.pending ? (title: string) => setLiveMetadata({ ...liveFrontmatter.metadata, title }) : own?.rename ? (title: string) => void own.rename!(title) : undefined;
  const quickActions = <NoteQuickActions {...footerActions({ frame, readOnly, session, refresh, canCommit: Boolean(onCommitFile) })} changes={changes} disabled={session.isSaving} />;
  const history = { target: historyTarget, dirty: session.isDirty, current: currentFile, onRestore: readOnly || session.locked ? undefined : restoreFile, onCommitVersion: onCommitFile && !readOnly ? async (text: VersionText) => void await session.commitNote({ path: note.path, today: today(), ...text }) : undefined };
  const directPanel = { ...docPanel, isMarkdown, history, onRename: readOnly || template ? undefined : onRename, notePath: note.path, content: session.content, lineNumberOffset: session.baseNote.lineNumberOffset || 0, metadata: session.metadata, setMetadata: session.setMetadata, statuses, metadataFields, availableTags, locked: session.locked, notebookId: note.notebookId, readOnly };
  // In the collab editor: the live text's history (read against the live text, restored into it after a confirm), the
  // title per Q3 (a filed note renames after checking in, a pending one writes `title:`), the Gist read-only (Q4).
  // The YAML view stays writable while the block does not parse, so it can be fixed there; the form is disabled by `frontmatterInvalid`.
  const panel = shared ? { ...directPanel, history: liveHistory, onRename: liveRename, lineNumberOffset: liveFrontmatter.lineOffset, readOnly: false, locked: !shared.online, yamlSource: liveFrontmatter.yaml, frontmatterInvalid: liveFrontmatter.valid ? undefined : liveFrontmatter.error ?? '', liveNote: true } : directPanel;
  return (
    <div ref={rootRef} className='note-editor' data-frame={frame} data-source-notebook={note.notebookId} data-phone-bar={phone ? barOverlay ? 'overlay' : 'flow' : undefined} data-bar-hidden={barHidden || undefined} style={noteViewStyle(viewPreferences)}>
      <NoteEditorNotices session={session} notePath={note.path} />
      <div className='editor-notices'>{liveEdit.notices}</div>
      <NoteEditorToolbar frame={frame} note={note} session={session} docPanel={docPanel} isMarkdown={isMarkdown} autoSave={autoSave} readOnly={readOnly} editorMode={editorMode} setEditorMode={setEditorMode} editorModes={editorModes} showLineNumbers={lineNumbersShown} toggleLineNumbers={toggleLineNumbers} showFormatToolbar={showFormatToolbar} toggleFormatToolbar={isMarkdown && !session.locked ? toggleFormatToolbar : undefined} phoneEditing={phone && !session.locked ? { editing, onEdit: () => setEditing(true), onDone: finishEditing } : liveEdit.edit ? { editing: false, onEdit: liveEdit.edit, onDone: liveEdit.edit } : undefined} onRefresh={refresh} onClose={onClose} onMove={moveNote} onRename={readOnly || template ? undefined : onRename} liveDraft={liveDraft} template={template} onSaveAsTemplate={readOnly || template || !onSaveAsTemplate ? undefined : () => onSaveAsTemplate({ title: session.title, metadata: session.metadata, content: session.content })} statuses={statuses} availableTags={availableTags} actionsSlot={actionsSlot} onAddToOutline={addToOutline} onPlaySlides={slideDeck} phoneChrome={phone ? { quickActions, hasHistory: Boolean(history), overlay: barOverlay, hidden: barHidden, liveBadge: liveEdit.badgeShown, liveEditing: Boolean(liveEdit.checkout) } : undefined} />
      {awaitingRecovery && (
        <p role='status'>
          {t('outline.recoveryPending')} <button type='button' className='ui-button' onClick={() => outlines?.cancel()}>{t('common.cancel')}</button>
        </p>
      )}
      {live && liveEdit.checkout && (live.editor.kind === 'builtin' ? (
        <LiveCollabEditor checkout={liveEdit.checkout} editor={live.editor} title={session.title} scope={draftScope} onRefetch={liveEdit.refetch} onClose={liveEdit.close} onCheckedIn={liveEdit.checkedIn} onReleased={liveEdit.released} onDiscarded={liveEdit.discarded} onMergeConflict={live.onMergeConflict} onUnsavedChange={liveEdit.unsavedChange} onLive={setLiveSession} editorRef={collabEditorRef} slides={isSlideNote(session.metadata)} showLineNumbers={lineNumbersShown} mode={isMarkdown ? editorMode : 'raw'} body={liveBody}>
          {shared && <NoteEditorDocumentPanel frame={frame} target={documentPanel?.target} notePanel={docPanel.notePanel} panel={panel} />}
        </LiveCollabEditor>
      ) : <LiveEditorFrame checkout={liveEdit.checkout} editor={live.editor} theme={liveTheme} title={session.title} onRefetch={liveEdit.refetch} onClose={liveEdit.close} onCheckedIn={liveEdit.checkedIn} onDiscarded={liveEdit.discarded} />)}
      {formatToolbarShown && !liveEdit.checkout && <div ref={setToolbarSlot} className='note-format-toolbar' />}
      {!liveEdit.checkout && (
        <div className='note-editor-body'>
          <MarkdownEditor
            ref={editorRef}
            content={session.content}
            path={note.path}
            notebookId={note.notebookId}
            mode={editorMode}
            readOnly={session.locked || reading}
            onChange={session.setContent}
            onCaret={trackCaret}
            toolbarSlot={showFormatToolbar ? toolbarSlot : null}
            ariaLabel='Note content'
            showLineNumbers={lineNumbersShown}
            lineNumberOffset={session.baseNote.lineNumberOffset}
            onInsertImage={session.locked ? undefined : options => {
              setPickAnnotated(Boolean(options?.annotated));
              setImagePickerOpen(true);
            }}
            carry={carry}
            slides={isSlideNote(session.metadata)}
          />
          <NoteEditorDocumentPanel frame={frame} target={documentPanel?.target} notePanel={docPanel.notePanel} panel={panel} />
        </div>
      )}
      {!phone && !liveEdit.checkout && <EditorFooter content={session.content} path={note.path} state={session.editorState} status={session.editorStatus} actions={quickActions} />}
      {docPanel.isEditorLeaderOpen && <NoteEditorLeader docPanel={docPanel} isMarkdown={isMarkdown} />}
      {deck && <SlideDeck content={session.content} path={note.path} notebookId={note.notebookId} title={session.title} lineNumberOffset={session.baseNote.lineNumberOffset || 0} view={deck.view} opener={deck.opener} onClose={() => setDeck(null)} />}
      {imagePickerOpen && <FileManagerDialog notebookId={note.notebookId} writable={!readOnly} mode='pick-image' onInsert={session.locked ? undefined : insertImage} beforeChange={beforeFileChange} onChanged={onFilesChanged} onClose={() => setImagePickerOpen(false)} />}
    </div>
  );
});
NoteEditor.displayName = 'NoteEditor';
