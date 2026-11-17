import { responseError } from './api.js';
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
  /** Live notes (編輯中) a folder move landed without: each stays where it is, as the links to it say. */
  liveLeft?: { path: string; destination?: string; reason: string; }[];
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
