import { FileType } from 'lucide-react';
import { useTranslation } from '../../lib/i18n/index.js';
import { usePhone } from '../../lib/use-phone.js';
import { previewDock, usePreviewDock } from '../../lib/typst-preview/dock-store.js';
import { type PreviewNote, useTypstPreviewEnabled } from '../../lib/typst-preview/preview-target.js';
import { usePreviewProject } from '../../lib/typst-preview/use-preview-project.js';

/** Opens and closes the Typst preview dock. It exists only for a note of a thesis-toolkit project in a local workspace, on a screen wide enough for the dock. */
export function TypstPreviewToggle(props: { note: PreviewNote; className?: string; }) {
  // Outside a workspace that offers the preview (remote mode, an editor on its own) nothing is asked, so no query client is needed.
  return useTypstPreviewEnabled() ? <OfferedToggle {...props} /> : null;
}

function OfferedToggle({ note, className = '' }: { note: PreviewNote; className?: string; }) {
  const { t } = useTranslation();
  const phone = usePhone();
  const { open } = usePreviewDock();
  const project = usePreviewProject(note.notebookId, note.path)?.project;
  if (!project || phone) return null;
  const label = t('typstPreview.title');
  return (
    <button type='button' className={`ui-icon-button typst-preview-toggle ${className}`} aria-label={label} title={label} aria-expanded={open} aria-controls={open ? 'typst-preview-dock' : undefined} data-open={open || undefined} onClick={previewDock.toggle}>
      <FileType aria-hidden='true' />
    </button>
  );
}
