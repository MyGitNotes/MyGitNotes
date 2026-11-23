import YAML from 'yaml';
import { localIdIn } from '@mygitnotes/core/notebook-key';
import { updateWorkspaceConfig } from './api.js';
import type { NotebookConfig, WorkspaceConfig } from './types.js';
import type { WorkspaceRepository } from './workspace-repositories.js';

/** What the appearance picker sets on a notebook: the Lucide icon its mark draws and the palette colour it wears; either may be left out. */
export type NotebookAppearance = Pick<NotebookConfig, 'icon' | 'color'>;

/**
 * The manifest text Settings shows and saves: the stored manifest, without each notebook's `excluded`, which is derived
 * from the `exclude` lists when the manifest is read and is never part of the file.
 */
export const manifestYaml = (config: WorkspaceConfig): string => YAML.stringify({ ...config, notebooks: config.notebooks.map(({ excluded: _excluded, ...notebook }) => notebook) });

/** The manifest with the notebook `localId` given `appearance`: its icon and colour are set as given, and removed where left out. */
export function withNotebookAppearance(config: WorkspaceConfig, localId: string, appearance: NotebookAppearance): WorkspaceConfig {
  if (!config.notebooks.some(notebook => notebook.id === localId)) throw new Error(`The manifest has no notebook '${localId}'.`);
  return {
    ...config,
    notebooks: config.notebooks.map(notebook => {
      if (notebook.id !== localId) return notebook;
      const { icon: _icon, color: _color, ...rest } = notebook;
      return { ...rest, ...(appearance.icon ? { icon: appearance.icon } : {}), ...(appearance.color ? { color: appearance.color } : {}) };
    }),
  };
}

/**
 * Whether a notebook's appearance can be saved in its repository: the requester may commit there, the repository is
 * available and keeps a manifest of its own (a derived one would be created by the save, turning its folders into a
 * fixed list), and it is not the product's `core` branch, whose manifest Settings keeps read-only too.
 */
export const appearanceEditable = (repository: WorkspaceRepository | undefined): boolean => Boolean(repository && repository.write && !repository.unavailable && repository.manifest !== 'derived' && repository.branch !== 'core' && repository.config && repository.configRevision);

/**
 * Commits the notebook's new appearance through the manifest's own write path (`PUT /api/workspace/config`, as
 * Settings → Manifest saves it), refused with a 409 `ApiError` when the manifest moved since it was read. Returns the
 * manifest's new revision.
 */
export async function saveNotebookAppearance(repository: WorkspaceRepository, notebookKey: string, appearance: NotebookAppearance): Promise<string> {
  if (!repository.config) throw new Error(`The manifest of ${repository.title} cannot be read.`);
  const localId = localIdIn(repository.alias, notebookKey) ?? notebookKey;
  const saved = await updateWorkspaceConfig(repository.id, manifestYaml(withNotebookAppearance(repository.config, localId, appearance)), repository.configRevision);
  return saved.configRevision;
}
