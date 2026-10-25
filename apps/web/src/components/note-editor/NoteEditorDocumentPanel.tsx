import { createPortal } from 'react-dom';
import { useTranslation } from '../../lib/i18n/index.js';
import { usePhone } from '../../lib/use-phone.js';
import { PhoneSheet } from '../PhoneSheet.js';
import { phoneToolLabel } from './phone-tools.js';
import type { NotePanelMode } from './types.js';
import { NoteDocumentPanel, type NoteDocumentPanelProps } from './NoteDocumentPanel.js';

/** Zoom keeps the document panel beside the body with its own tabs; a pane renders it into the right rail's target. */
export function NoteEditorDocumentPanel({ frame, target, notePanel, panel }: { frame: 'zoom' | 'pane'; target?: HTMLElement | null; notePanel: NotePanelMode | null; panel: Omit<NoteDocumentPanelProps, 'includeTabs'>; }) {
  const { t } = useTranslation();
  const phone = usePhone();
  // A phone shows the open section as a full-height sheet, whichever frame holds the note (a pane's goes to the page's tool sheet).
  if (phone && frame === 'zoom') {
    return notePanel
      ? (
        <PhoneSheet variant='full' title={t(phoneToolLabel(notePanel))} onClose={() => panel.setNotePanel(null)}>
          <NoteDocumentPanel includeTabs={false} {...panel} />
        </PhoneSheet>
      )
      : null;
  }
  if (frame === 'zoom') {
    return (
      <aside className='note-document-panel' data-open={Boolean(notePanel)} data-panel={notePanel || undefined} aria-label={t('editor.documentPanel')}>
        <NoteDocumentPanel includeTabs {...panel} />
      </aside>
    );
  }
  if (!target || !notePanel) return null;
  return createPortal(
    <section className='note-document-panel' data-open='true' data-panel={notePanel} data-frame='rail' aria-label={t('editor.documentPanel')}>
      <NoteDocumentPanel includeTabs={false} {...panel} />
    </section>,
    target,
  );
}
