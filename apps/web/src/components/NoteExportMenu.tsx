import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { r2ReferenceKeys } from '@mygitnotes/core/r2-references';
import { Copy, FileArchive, FileText, Printer } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import { noteArchive } from '../lib/note-archive.js';
import { downloadBlob, downloadTextFile, printNoteAsPdf } from '../lib/note-export.js';

interface ExportNote {
  path: string;
  notebookId?: string;
  noteLang?: string;
  title: string;
  content: string;
  onCopy: () => void;
}

/** Saves the note and the private R2 objects it references as one ZIP; an object that cannot be fetched is listed inside it. */
async function downloadWithAssets(path: string, content: string): Promise<void> {
  const archive = await noteArchive({ path, content });
  downloadBlob(archive.filename, new Blob([archive.bytes], { type: 'application/zip' }));
}

/**
 * The ways to take a note's content out of the editor, as menu items: copy it, download it as Markdown, download it with
 * the private R2 objects it references (offered only when it references any), print it as PDF.
 */
export function NoteExportItems({ path, notebookId, noteLang, title, content, onCopy }: ExportNote) {
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
      {r2ReferenceKeys(content).length > 0 && (
        <DropdownMenu.Item onSelect={() => void downloadWithAssets(path, content)}>
          <FileArchive size={14} aria-hidden='true' />
          <span>{t('editor.exportWithAssets')}</span>
        </DropdownMenu.Item>
      )}
      <DropdownMenu.Item onSelect={() => void printNoteAsPdf(title || filename, content, path, t('mermaid.error'), notebookId, t, noteLang)}>
        <Printer size={14} aria-hidden='true' />
        <span>{t('editor.exportPdf')}</span>
      </DropdownMenu.Item>
    </>
  );
}
