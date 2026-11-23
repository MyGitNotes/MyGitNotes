import { Tooltip } from '../Tooltip.js';
import { Braces } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import '../note-row.css';
import { withNoteStatus } from '@mygitnotes/core/note-status';
import { useTranslation } from '../../lib/i18n/index.js';
import { FrontmatterInvalid, NoteStatusSelect } from '../NoteStatusSelect.js';
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
  /** Renames the note from its title; absent where it cannot be renamed, which shows the title as text. */
  onRename?: (title: string) => Promise<void> | void;
  /** The note is one of its notebook's template files, which the row labels ahead of the title. */
  template?: boolean;
  /** Shown after the frontmatter button; zoom puts a phone's Edit button here. */
  trailing?: ReactNode;
  /** The note's frontmatter does not parse: a warning stands where its status and tags would, which it could not read. */
  frontmatterInvalid?: boolean;
}

/**
 * Below this width the status and tags drop to a line of their own under the title and frontmatter button. Above it the
 * title, the status chip, the tags folded to + and the frontmatter button share one line, the title giving way first.
 */
const NARROW_BELOW = 240;

/** The note's common metadata in one row: its title (renamed in place), status and tags, and the button that opens the full frontmatter. */
export function NoteRow({ path, session, docPanel, statuses, availableTags, onRename, template = false, trailing, frontmatterInvalid = false }: NoteRowProps) {
  const { t } = useTranslation();
  const row = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () => {
      const { width } = element.getBoundingClientRect();
      setNarrow(width > 0 && width < NARROW_BELOW);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={row} className='note-row' data-narrow={narrow || undefined} role='group' aria-label={t('editor.noteRow')}>
      {template && (
        <Tooltip label={t('templates.labelHint')}>
          <span className='note-row-template'>{t('templates.label')}</span>
        </Tooltip>
      )}
      <NoteTitleEdit title={session.title} path={path} locked={session.locked} onRename={onRename} />
      {frontmatterInvalid ? <FrontmatterInvalid announce /> : (
        <>
          <NoteStatusSelect status={String(session.metadata.status || '')} statuses={statuses} readOnly={session.locked} onChange={status => session.setMetadata(withNoteStatus(session.metadata, status))} label={t('editor.status')} />
          <NoteRowTags metadata={session.metadata} setMetadata={session.setMetadata} availableTags={availableTags} locked={session.locked} />
        </>
      )}
      <Tooltip label={t('editor.frontmatter')}>
        <button type='button' className='note-row-frontmatter ui-icon-button toolbar-icon-button' aria-pressed={docPanel.showFrontmatter} aria-label={t('editor.frontmatter')} onClick={() => docPanel.setNotePanel(docPanel.showFrontmatter ? null : 'frontmatter')}>
          <Braces aria-hidden='true' />
        </button>
      </Tooltip>
      {trailing}
    </div>
  );
}
