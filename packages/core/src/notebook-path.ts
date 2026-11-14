import type { NotebookConfig } from './types.js';

/**
 * Whether `relative`, a path inside `notebook`, is one the notebook reaches at all: not a dot name, a dependency or build
 * folder, an agent file, or its assets. An excluded path is one, so a note can link to it and open the file. Free of Node
 * modules, so the web app tells the same paths apart.
 */
export function isNotebookPath(relative: string, notebook: NotebookConfig): boolean {
  const assetDir = (notebook.assets || 'assets').replace(/\\/g, '/').replace(/\/$/, '');
  return !relative.split('/').some(p => p.startsWith('.') || p.toLowerCase() === 'agents.md' || ['node_modules', 'dist', 'build'].includes(p)) && relative !== assetDir && !relative.startsWith(`${assetDir}/`) && !/(^|\/)docs\/agent(\/|$)/.test(relative);
}
