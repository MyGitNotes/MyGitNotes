import { Tooltip } from '../Tooltip.js';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { AlertTriangle, Check, ExternalLink, FolderInput, LayoutTemplate, ListTree, MoreHorizontal, PencilLine, Trash2 } from 'lucide-react';
import { useTranslation } from '../../lib/i18n/index.js';
import { NoteExportItems } from '../NoteExportMenu.js';
import type { LiveToolbarState } from '../live/LiveToolbarControls.js';

/** What a live note's editor offers though the note is read-only there; see `liveDraft`. */
export interface LiveDraftActions {
  onRename?: () => void;
  /** A collab-first note's own editor: checks the note in, then deletes it; true once it was deleted. */
  onDelete?: () => Promise<boolean>;
}

interface NoteActionsMenuProps {
  path: string;
  notebookId?: string;
  noteLang?: string;
  title: string;
  content: string;
  copyState: 'idle' | 'copied' | 'error';
  onCopy: () => void;
  locked: boolean;
  onAddToOutline?: () => void;
  /** Moves the note to another folder of its notebook. */
  onMove?: () => void;
  /** Copies the note into its notebook's `.templates/` folder as a template named after it. */
  onSaveAsTemplate?: () => void;
  /**
   * A live note read-only here yet movable: a pending one (未歸檔) where its live editor can retarget it, whose `onRename`
   * opens the dialog that names the file its check-in files it as, or a collab-first note's own editor, whose move and
   * `onRename` check the note in first. Move is not locked.
   */
  liveDraft?: LiveDraftActions;
  liveToolbar?: LiveToolbarState;
  className: string;
}

/** The note editor's "⋯" button: the actions that file the note or take it out of the editor — add it to an outline, move it, export or copy it. */
export function NoteActionsMenu({ path, notebookId, noteLang, title, content, copyState, onCopy, locked, onAddToOutline, onMove, onSaveAsTemplate, liveDraft, liveToolbar, className }: NoteActionsMenuProps) {
  const { t } = useTranslation();
  const label = t(copyState === 'copied' ? 'editor.noteCopied' : copyState === 'error' ? 'editor.noteCopyFailed' : 'editor.moreActions');
  const Icon = copyState === 'copied' ? Check : copyState === 'error' ? AlertTriangle : MoreHorizontal;
  const { discard, openInTab } = liveToolbar ?? {};
  return (
    <DropdownMenu.Root>
      <Tooltip label={label}>
        <DropdownMenu.Trigger className={className} aria-label={label}>
          <Icon aria-hidden='true' />
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className='focus-menu' align='end' sideOffset={4} collisionPadding={8} aria-label={t('editor.moreActions')} onEscapeKeyDown={event => event.stopPropagation()}>
          {onAddToOutline && (
            <DropdownMenu.Item disabled={locked} onSelect={onAddToOutline}>
              <ListTree size={14} aria-hidden='true' />
              <span>{t('outline.add')}</span>
            </DropdownMenu.Item>
          )}
          {onMove && (
            <DropdownMenu.Item disabled={locked && !liveDraft} onSelect={onMove}>
              <FolderInput size={14} aria-hidden='true' />
              <span>{t('files.moveNote')}</span>
            </DropdownMenu.Item>
          )}
          {liveDraft?.onRename && (
            <DropdownMenu.Item onSelect={liveDraft.onRename}>
              <PencilLine size={14} aria-hidden='true' />
              <span>{t('files.rename')}</span>
            </DropdownMenu.Item>
          )}
          {onSaveAsTemplate && (
            <DropdownMenu.Item onSelect={onSaveAsTemplate}>
              <LayoutTemplate size={14} aria-hidden='true' />
              <span>{t('templates.saveAs')}</span>
            </DropdownMenu.Item>
          )}
          {openInTab && (
            <DropdownMenu.Item asChild>
              <a href={openInTab} target='_blank' rel='noopener noreferrer'>
                <ExternalLink aria-hidden='true' />
                <span>{t('live.openInTab')}</span>
              </a>
            </DropdownMenu.Item>
          )}
          {discard && (
            <Tooltip label={t(discard.reason ?? 'live.discardHint')}>
              <DropdownMenu.Item className='focus-menu-danger' disabled={discard.disabled} onSelect={discard.run}>
                <Trash2 aria-hidden='true' />
                <span>{t('live.discard')}</span>
              </DropdownMenu.Item>
            </Tooltip>
          )}
          {(onAddToOutline || onMove || onSaveAsTemplate || liveDraft?.onRename || openInTab || discard) && <DropdownMenu.Separator />}
          <NoteExportItems path={path} notebookId={notebookId} noteLang={noteLang} title={title} content={content} onCopy={onCopy} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
