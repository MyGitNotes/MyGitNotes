import { Braces } from 'lucide-react';
import '../note-row.css';
import { withNoteStatus } from '@mygitnotes/core/note-status';
import { useTranslation } from '../../lib/i18n/index.js';
import { NoteStatusSelect } from '../NoteStatusSelect.js';
import { NoteRowTags } from './NoteRowTags.js';
import { NoteTitleEdit } from './NoteTitleEdit.js';
import type { NoteDocumentPanelState } from './useNoteDocumentPanel.js';
import type { NoteEditorSessionState } from './useNoteEditorSession.js';

interface NoteRowProps {
  path: string;
  session: NoteEditorSessionState;
  docPanel: NoteDocumentPanelState;
  statuses: string[];
  availableTags: string[];
  readOnly: boolean;
  onRename?: (title: string) => Promise<void> | void;
}

/** The note's common metadata in one row: its title (renamed in place), status and tags, and the button that opens the full frontmatter. */
export function NoteRow({ path, session, docPanel, statuses, availableTags, readOnly, onRename }: NoteRowProps) {
  const { t } = useTranslation();
  return (
    <div className='note-row' role='group' aria-label={t('editor.noteRow')}>
      <NoteTitleEdit title={session.title} path={path} locked={session.locked} onRename={readOnly ? undefined : onRename} />
      <NoteStatusSelect status={String(session.metadata.status || '')} statuses={statuses} readOnly={session.locked} onChange={status => session.setMetadata(withNoteStatus(session.metadata, status))} label={t('editor.status')} />
      <NoteRowTags metadata={session.metadata} setMetadata={session.setMetadata} availableTags={availableTags} locked={session.locked} />
      <button type='button' className='note-row-frontmatter ui-icon-button toolbar-icon-button' aria-pressed={docPanel.showFrontmatter} aria-label={t('editor.frontmatter')} title={t('editor.frontmatter')} onClick={() => docPanel.setNotePanel(docPanel.showFrontmatter ? null : 'frontmatter')}>
        <Braces aria-hidden='true' />
      </button>
    </div>
  );
}
