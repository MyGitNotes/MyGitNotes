export type { NotebookConfig, NotebookMetadataField, NotebookStatus, StatusColorName, ViewMode, WorkspaceConfig } from '@mygitnotes/core';
import type { LiveNoteState } from '@mygitnotes/core';

export interface NoteItem {
  revision?: string;
  id: string;
  path: string;
  notebookId: string;
  title: string;
  status?: string;
  tags: string[];
  metadata: Record<string, unknown>;
  content: string;
  lineNumberOffset?: number;
  mtime?: number;
  size?: number;
  /** The author date of the newest commit that changed the note's text, as the server read it from Git. */
  lastCommitAt?: string;
  /** The note's edit date the server resolved (Git, else the frontmatter `updated`), which lists show and sort by. */
  updated?: string;
  /** The note opens a frontmatter block that cannot be read: it has no status or tags until it is fixed. */
  frontmatterInvalid?: true;
  /** Present while the note is checked out to the live editor (編輯中), or pending: the text is the live text. */
  live?: LiveNoteState;
}

export interface AssetItem {
  hash?: string;
  directory?: string;
  revision?: string;
  name: string;
  path: string;
  size: number;
  mtime: number;
  rawUrl: string;
  markdownRef: string;
}

export interface GitStatus {
  branch: string;
  isClean: boolean;
  staged: string[];
  modified: string[];
  untracked: string[];
  upstream?: string | null;
  ahead?: number;
  behind?: number;
}

export interface FileChange {
  path: string;
  /** The repository holding the change; two repositories can hold the same path. */
  repository?: string;
  staged: boolean;
  unstaged: boolean;
  kind: 'added' | 'modified' | 'deleted' | 'conflict';
  tracked: boolean;
  revision: string;
  available?: boolean;
  unavailableReason?: 'conflict' | 'protected' | 'unsupported';
  /** An untracked workspace dotfile that can be reviewed but not committed in bulk from the header. */
  manualCommitOnly?: true;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

export interface LocalDraft {
  path: string;
  content: string;
  metadata: Record<string, unknown>;
  savedAt: number;
}

export interface FolderItem {
  notebookId: string;
  path: string;
  title: string;
  order: number;
  description?: string;
}

export interface ChangeRequest {
  action: 'review' | 'commit' | 'restore';
  /** Changes named by `changeKey`. */
  keys: string[];
}
