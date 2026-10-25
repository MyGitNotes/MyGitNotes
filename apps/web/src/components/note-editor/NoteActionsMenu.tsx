import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { AlertTriangle, Check, FolderInput, ListTree, MoreHorizontal } from 'lucide-react';
import { useTranslation } from '../../lib/i18n/index.js';
import { NoteExportItems } from '../NoteExportMenu.js';

interface NoteActionsMenuProps {
  path: string;
  notebookId?: string;
  title: string;
  content: string;
  copyState: 'idle' | 'copied' | 'error';
  onCopy: () => void;
  locked: boolean;
  onAddToOutline?: () => void;
  /** Moves the note to another folder of its notebook. */
  onMove?: () => void;
  className: string;
}

/** The note editor's "⋯" button: the actions that file the note or take it out of the editor — add it to an outline, move it, export or copy it. */
export function NoteActionsMenu({ path, notebookId, title, content, copyState, onCopy, locked, onAddToOutline, onMove, className }: NoteActionsMenuProps) {
  const { t } = useTranslation();
  const label = t(copyState === 'copied' ? 'editor.noteCopied' : copyState === 'error' ? 'editor.noteCopyFailed' : 'editor.moreActions');
  const Icon = copyState === 'copied' ? Check : copyState === 'error' ? AlertTriangle : MoreHorizontal;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={className} aria-label={label} title={label}>
        <Icon aria-hidden='true' />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className='focus-menu' align='end' sideOffset={4} collisionPadding={8} aria-label={t('editor.moreActions')} onEscapeKeyDown={event => event.stopPropagation()}>
          {onAddToOutline && (
            <DropdownMenu.Item disabled={locked} onSelect={onAddToOutline}>
              <ListTree size={14} aria-hidden='true' />
              <span>{t('outline.add')}</span>
            </DropdownMenu.Item>
          )}
          {onMove && (
            <DropdownMenu.Item disabled={locked} onSelect={onMove}>
              <FolderInput size={14} aria-hidden='true' />
              <span>{t('files.moveNote')}</span>
            </DropdownMenu.Item>
          )}
          {(onAddToOutline || onMove) && <DropdownMenu.Separator />}
          <NoteExportItems path={path} notebookId={notebookId} title={title} content={content} onCopy={onCopy} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
