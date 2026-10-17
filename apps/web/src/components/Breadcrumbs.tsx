import React from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { BreadcrumbSegment } from '../lib/folder-tree.js';
import { useTranslation } from '../lib/i18n/index.js';

interface BreadcrumbsProps {
  segments: BreadcrumbSegment[];
  currentFolder: string | null;
  onSelectFolder: (folder: string | null) => void;
  subfolderCount?: number;
  noteCount?: number;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ segments, currentFolder, onSelectFolder, subfolderCount = 0, noteCount = 0 }) => {
  const { t } = useTranslation();

  // Parent folder for the "Back / Up" button
  const parentFolder = currentFolder ? currentFolder.includes('/') ? currentFolder.slice(0, currentFolder.lastIndexOf('/')) : null : null;

  return (
    <nav aria-label='Breadcrumbs' className='workspace-breadcrumbs flex items-center justify-between gap-3 px-3 py-2 md:px-4 md:py-2.5 rounded-xl border bg-fg/[0.02] mb-4 text-xs select-none transition-colors flex-wrap sm:flex-nowrap' style={{ borderColor: 'var(--color-line)' }}>
      <div className='flex items-center gap-1.5 flex-wrap min-w-0'>
        {currentFolder !== null && (
          <button type='button' onClick={() => onSelectFolder(parentFolder)} title={t('folder.goUpTooltip')} aria-label={t('folder.goUpTooltip')} className='inline-flex items-center gap-1 px-2 py-1 -ml-1 rounded-lg text-muted hover:text-fg hover:bg-fg/5 transition active:scale-95 shrink-0'>
            <ArrowLeft className='w-3.5 h-3.5' />
            <span className='font-medium hidden sm:inline'>{t('folder.up')}</span>
          </button>
        )}
        {/* Folder cards and note rows already read as folders; the path lists only the folders below the root. */}
        <div className='flex items-center gap-1.5 flex-wrap min-w-0'>
          {segments.filter(seg => seg.path !== null).map((seg, idx, shown) => {
            const isLast = idx === shown.length - 1;

            return (
              <React.Fragment key={seg.path}>
                {idx > 0 && <ChevronRight className='w-3.5 h-3.5 text-muted shrink-0 mx-0.5' />}
                {isLast
                  ? (
                    <span className='flex items-center gap-1.5 font-semibold text-fg truncate px-1.5 py-0.5 rounded bg-fg/5'>
                      <span className='truncate max-w-[160px] md:max-w-xs'>{seg.name}</span>
                    </span>
                  )
                  : (
                    <button
                      type='button'
                      onClick={() => onSelectFolder(seg.path)}
                      className='flex items-center gap-1.5 text-muted hover:text-fg transition px-1.5 py-0.5 rounded hover:bg-fg/5 truncate'
                    >
                      <span className='truncate max-w-[120px] md:max-w-[200px]'>{seg.name}</span>
                    </button>
                  )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
      {/* Right: Summary indicator */}
      <div className='flex items-center gap-3 shrink-0 justify-between sm:justify-end w-full sm:w-auto pt-1 sm:pt-0 border-t sm:border-t-0 border-line'>
        <div className='flex items-center gap-1.5 text-muted text-[11px] font-mono'>
          {subfolderCount > 0 && <span className='inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-fg/5 text-muted'>{subfolderCount === 1 ? t('folder.subfolderCount', { count: 1 }) : t('folder.subfoldersCount', { count: subfolderCount })}</span>}
          <span className='inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-fg/5 text-muted'>{noteCount === 1 ? t('folder.noteCount', { count: 1 }) : t('folder.notesCount', { count: noteCount })}</span>
        </div>
      </div>
    </nav>
  );
};
