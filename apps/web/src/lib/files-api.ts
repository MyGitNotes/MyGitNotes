import { responseError } from './api.js';
import type { I18nContextValue } from './i18n/index.js';
import type { FileCommand } from '@mygitnotes/core';
export interface FileEntry {
  path: string;
  name: string;
  directory: boolean;
  noteDirectory?: boolean;
  size: number;
  hidden: boolean;
  hash?: string;
  presentation: 'image' | 'pdf' | 'audio' | 'video' | 'file';
}
export interface FileListing {
  root: string;
  entries: FileEntry[];
  revision: string;
  writable: boolean;
  remote: boolean;
}
export interface FileRead {
  path: string;
  hash?: string;
  content?: string | null;
  revision: string;
  metadata?: { title: string; description?: string; order: number; };
}
export interface FileResult {
  revision: string;
  selectedPath: string;
  pathMap: Record<string, string>;
  deletedPaths: string[];
  /**
   * Live notes (編輯中) a folder move landed without: each stays where it is, as the links to it say, unless `moved`;
   * with `linksBroken`, its own links to the notes moved still lead where they were.
   */
  liveLeft?: LiveLeft[];
}
export interface LiveLeft {
  path: string;
  destination?: string;
  reason: string;
  linksBroken?: true;
  moved?: true;
}
/** What a person is told of the live notes a move that landed could not wholly take along; null when nothing. */
export function liveLeftMessage(left: readonly LiveLeft[] | undefined, t: I18nContextValue['t']): string | null {
  const entries = Array.isArray(left) ? left : [];
  const stayed = entries.filter(entry => !entry.moved).map(entry => entry.path), broken = entries.filter(entry => entry.linksBroken).map(entry => entry.path);
  const said = [...(stayed.length ? [t('folder.liveLeft', { paths: stayed.join(', ') })] : []), ...(broken.length ? [t('folder.liveLinksBroken', { paths: broken.join(', ') })] : [])];
  return said.length ? said.join(' ') : null;
}
const query = (notebookId: string, path?: string) => new URLSearchParams({ notebookId, ...(path ? { path } : {}) }).toString();
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  // A refusal reads as the other routes' do: 「編輯中，請先簽回」 for a checked-out note, with the paths it names.
  if (!response.ok) throw await responseError(response, 'File operation failed.');
  return response.json();
}
export const fetchFiles = (notebookId: string) => request<FileListing>('/api/files?' + query(notebookId));
export const readFile = (notebookId: string, path: string) => request<FileRead>('/api/files/read?' + query(notebookId, path));
export const rawFileUrl = (notebookId: string, path: string) => '/api/files/raw?' + query(notebookId, path);
/**
 * Runs `command`; a revision the caller read must still be current, and a move needs none, since it is planned from the
 * workspace as the server reads it. `editing`: a live note's move from its own editor, which the server checks in at once
 * when nobody else edits the note.
 */
export const mutateFile = (command: FileCommand, revision?: string, options?: { editing?: boolean; }) => request<FileResult>('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command, revision, ...(options?.editing ? { editing: true } : {}) }) });
