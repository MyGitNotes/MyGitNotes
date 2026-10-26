import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { AlertTriangle, Check, Copy, Download, FileText, Printer } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import { downloadTextFile, printNoteAsPdf } from '../lib/note-export.js';

interface Props {
  path: string;
  notebookId?: string;
  title: string;
  content: string;
  copyState: 'idle' | 'copied' | 'error';
  onCopy: () => void;
  /** Icon size in pixels for the compact frame's bar; the toolbar sizes its icons with CSS. */
  iconSize?: number;
  className: string;
}

type ExportNote = Pick<Props, 'path' | 'notebookId' | 'title' | 'content' | 'onCopy'>;

/** The ways to take a note's content out of the editor, as menu items: copy it, download it as Markdown, print it as PDF. */
export function NoteExportItems({ path, notebookId, title, content, onCopy }: ExportNote) {
  const { t } = useTranslation();
  const filename = path.split('/').pop() || 'note.md';
  return (
    <>
      <DropdownMenu.Item onSelect={onCopy}>
        <Copy size={14} aria-hidden='true' />
        <span>{t('editor.exportCopy')}</span>
      </DropdownMenu.Item>
      <DropdownMenu.Item onSelect={() => downloadTextFile(filename, content, 'text/markdown;charset=utf-8')}>
        <FileText size={14} aria-hidden='true' />
        <span>{t('editor.exportMarkdown')}</span>
      </DropdownMenu.Item>
      <DropdownMenu.Item onSelect={() => void printNoteAsPdf(title || filename, content, path, t('mermaid.error'), notebookId, t)}>
        <Printer size={14} aria-hidden='true' />
        <span>{t('editor.exportPdf')}</span>
      </DropdownMenu.Item>
    </>
  );
}

/** The note editor's Export button: a menu of ways to take the note's content out of the editor. */
export function NoteExportMenu({ path, notebookId, title, content, copyState, onCopy, iconSize, className }: Props) {
  const { t } = useTranslation();
  const label = t(copyState === 'copied' ? 'editor.noteCopied' : copyState === 'error' ? 'editor.noteCopyFailed' : 'editor.export');
  const Icon = copyState === 'copied' ? Check : copyState === 'error' ? AlertTriangle : Download;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={className} aria-label={label} title={label}>
        <Icon size={iconSize} aria-hidden='true' />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className='focus-menu' align='end' sideOffset={4} collisionPadding={8} aria-label={t('editor.export')} onEscapeKeyDown={event => event.stopPropagation()}>
          <NoteExportItems path={path} notebookId={notebookId} title={title} content={content} onCopy={onCopy} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
