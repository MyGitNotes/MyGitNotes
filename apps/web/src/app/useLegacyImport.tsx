import { useState } from 'react';
import { Button } from '../components/Button.js';
import { LegacyOutlineDialog } from '../components/LegacyOutlineDialog.js';
import { readNote } from '../lib/api.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import { useLegacyBookmarkRecovery } from '../lib/use-legacy-bookmark-recovery.js';
import type { useNoteActions } from './useNoteActions.js';
import type { useWorkspaceNotes } from './useWorkspaceNotes.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  repositories: WorkspaceState['repositories'];
  config: WorkspaceState['config'];
  refreshWorkspace: WorkspaceState['refreshWorkspace'];
  refreshNotes: ReturnType<typeof useWorkspaceNotes>['refreshNotes'];
  handleOpenNote: ReturnType<typeof useNoteActions>['handleOpenNote'];
  t: I18nContextValue['t'];
}

/** Old outlines and bookmarks brought into the workspace: the notice of ones left to recover, and the import dialog. */
export function useLegacyImport({ repositories, config, refreshWorkspace, refreshNotes, handleOpenNote, t }: Params) {
  const legacyRecovery = useLegacyBookmarkRecovery(repositories.map(repository => repository.id));
  const [legacyImportOpen, setLegacyImportOpen] = useState(false);
  const notice = (legacyRecovery.recoveries.length > 0 || legacyRecovery.error) && (
    <div role='alert' className='shrink-0 px-4 py-2 text-sm bg-surface border-b border-line flex flex-wrap items-center gap-2'>
      <span>{legacyRecovery.error || t('legacyOutline.notice')}</span>
      <Button onClick={() => setLegacyImportOpen(true)}>{t('legacyOutline.recovery')}</Button>
    </div>
  );
  const dialog = legacyImportOpen && (
    <LegacyOutlineDialog
      repositories={repositories}
      notebooks={config?.notebooks ?? []}
      recoveries={legacyRecovery.recoveries}
      recoveryError={legacyRecovery.error}
      onRecoveryChanged={legacyRecovery.refresh}
      onClose={() => setLegacyImportOpen(false)}
      onCreated={async ref => {
        await refreshWorkspace(true);
        await refreshNotes();
        const note = await readNote(ref.path, ref.notebookId);
        if (!await handleOpenNote(note)) throw new Error(t('legacyOutline.openFailed'));
        setLegacyImportOpen(false);
      }}
    />
  );
  return { openLegacyImport: () => setLegacyImportOpen(true), notice, dialog };
}
