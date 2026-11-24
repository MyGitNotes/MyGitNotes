import type { CompilationRow } from '@mygitnotes/core/compilation';
import { compilationMetadata, compilationText } from './compilation-rows.js';
import { newCompilationPath } from './use-compilation.js';
import { firstFreePath } from './compilation-paths.js';
import type { NotebookConfig } from './types.js';

export interface NewCompilation {
  path: string;
  content: string;
  metadata: Record<string, unknown>;
}

/** The file for a new compilation `row` in `folder` (relative to the notebook root): `<stem>.compilation.yml`, suffixed when taken; the stem defaults to its name. A row without a status starts with `initialStatus`. */
export async function planNewCompilation(row: CompilationRow, notebook: NotebookConfig, folder: string, stem = row.name, initialStatus?: string): Promise<NewCompilation> {
  const path = await firstFreePath(notebook.id, taken => newCompilationPath(notebook, stem, taken, folder));
  const created = row.status || !initialStatus ? row : { ...row, status: initialStatus };
  return { path, content: compilationText({ ...created, path }), metadata: compilationMetadata(created) };
}
