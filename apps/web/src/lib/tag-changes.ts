import type { RepositoryId } from '@mygitnotes/core/repository';
import type { SkippedFile } from '@mygitnotes/core/note-file';
import { applyTagChange } from './api.js';
import type { I18nContextValue } from './i18n/index.js';
import { groupByRepository, type WorkspaceRepository } from './workspace-repositories.js';

export interface TagEntry {
  path: string;
  notebookId: string;
  tags: string[];
}

/** A file the server left as it was: a compilation that would not open with its new tags, and why. */
export interface SkippedTagFile extends SkippedFile {
  notebookId: string;
}

/**
 * A tag change stopped part way; `committed` names the repositories whose commit landed before the failure, `skipped`
 * the files those commits left out.
 */
export class PartialTagChangeError extends Error {
  constructor(message: string, readonly committed: RepositoryId[], readonly skipped: SkippedTagFile[] = []) {
    super(message);
  }
}

/**
 * Applies tag entries one repository at a time, one commit each, in the order their notebooks first appear, and stops at
 * the first failure. `onCommitted` receives each repository's new revision as its commit lands. Answers the files the
 * commits left out: a compilation that would not open with its new tags is skipped while the rest are written.
 */
export async function applyTagEntries(repositories: WorkspaceRepository[], entries: TagEntry[], message: string, onCommitted: (repository: WorkspaceRepository, revision: string | undefined) => void): Promise<SkippedTagFile[]> {
  const committed: RepositoryId[] = [];
  const skipped: SkippedTagFile[] = [];
  for (const { repository, items } of groupByRepository(repositories, entries, entry => entry.notebookId)) {
    try {
      const result = await applyTagChange(repository.id, items, repository.revision, message);
      committed.push(repository.id);
      for (const file of result.skipped ?? []) skipped.push({ ...file, notebookId: items.find(item => item.path === file.path)?.notebookId ?? '' });
      onCommitted(repository, result.revision);
    } catch (error) {
      if (!committed.length) throw error;
      throw new PartialTagChangeError((error as Error).message, committed, skipped);
    }
  }
  return skipped;
}

/** Whether a tag entry is one of the skipped files. */
export const wasSkipped = (skipped: readonly SkippedTagFile[], entry: { path: string; notebookId: string; }) => skipped.some(file => file.path === entry.path && file.notebookId === entry.notebookId);

/** The notice that names the skipped files and why, or an empty string when none was skipped. */
export function skippedTagNotice(t: I18nContextValue['t'], skipped: readonly SkippedTagFile[]): string {
  return skipped.length ? t('sidebar.tagSkippedCompilations', { count: skipped.length, files: skipped.map(file => `${file.path} (${file.reason})`).join('; ') }) : '';
}
