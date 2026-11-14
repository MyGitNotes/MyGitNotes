import type { SortField, SortOrder } from './note-sort.js';
import type { LiveConflict } from './live-notes.js';

/** A note checked out to the live editor (編輯中), or a pending live note, as reads describe it. */
export interface LiveNoteState {
  /** When this checkout began. */
  since: string;
  /** Connected, non-idle editors. */
  activeEditors: number;
  /** A note created in the editor that has no Git path yet; its path is virtual. */
  pending?: true;
  /** What the last check-in overwrote. */
  conflict?: LiveConflict;
  /** The editor's own page of the note. */
  editorUrl: string;
}

export type ViewMode = 'list' | 'card' | 'kanban' | 'flat' | 'graph';

export interface NoteTemplate {
  id: string;
  title: string;
  file: string;
}

export type NotebookMetadataFieldType = 'string' | 'boolean' | 'number';

export interface NotebookMetadataField {
  key: string;
  type?: NotebookMetadataFieldType;
  label?: string;
}

/** The fixed palette a notebook status may take its colour from, by name only. */
export type StatusColorName = 'green' | 'blue' | 'amber' | 'red' | 'purple' | 'teal' | 'pink' | 'gray';

/** What a status is called on screen: one name for every language, or a name per UI language tag (`en`, `zh-TW`). */
export type StatusLabel = string | Readonly<Record<string, string>>;

/** One entry of a notebook's `statuses`: the bare name, or the name with the colour its dot wears and the label it shows. */
export type NotebookStatus = string | { name: string; color?: StatusColorName; label?: StatusLabel; };

/** A built-in sort field or `metadata.<key>` (a frontmatter key), with the order, newest or last first by default. */
export interface NotebookDefaultSort {
  field: SortField;
  order: SortOrder;
}

export interface NotebookConfig {
  id: string;
  title: string;
  root: string;
  assets?: string;
  default_view?: ViewMode;
  /** How the notebook's lists are ordered until a person picks another order for it. */
  default_sort?: NotebookDefaultSort;
  statuses?: NotebookStatus[];
  templates?: NoteTemplate[];
  metadata?: NotebookMetadataField[];
  pathAliases?: Record<string, string>;
  /** Globs, relative to the notebook root, of paths that are not notes (see `notebook-exclude.ts`); the notebook's own, as written. */
  exclude?: string[];
  /**
   * The globs a notebook applies: the workspace's `exclude` followed by the notebook's own. Derived when the manifest is
   * read and never written back; left out when nothing is excluded.
   */
  excluded?: string[];
}

export type YouTubeDisplayMode = 'thumbnail' | 'medium' | 'theater';

export interface WorkspacePreferences {
  defaultYoutubeDisplayMode?: YouTubeDisplayMode;
  defaultShowLineNumbers?: boolean;
}

export interface WorkspaceConfig {
  schema_version: number;
  workspace: { title: string; default_notebook: string; };
  notebooks: NotebookConfig[];
  /** Globs, relative to each notebook's root, of paths that are not notes in any notebook; see `notebook-exclude.ts` for the dialect. */
  exclude?: string[];
  /** Obsolete: `hide_dotfiles` is still accepted so older manifests load, and kept when present, but nothing reads it. */
  files?: { hide_dotfiles?: boolean; };
  preferences?: WorkspacePreferences;
}

export interface NoteMetadata {
  id?: string;
  title?: string;
  status?: string;
  hiden?: boolean;
  tags?: string[];
  [key: string]: unknown;
}

export interface NoteItem {
  revision?: string;
  id: string;
  path: string;
  notebookId: string;
  title: string;
  status?: string;
  tags: string[];
  metadata: NoteMetadata;
  content: string;
  lineNumberOffset?: number;
  mtime?: number;
  size?: number;
  /** Filename-derived specialized note kind; absent means an ordinary note. */
  kind?: 'compilation' | 'outline';
  /** Why a compilation cannot open: a syntax, schema, scope or duplicate-id problem. */
  invalid?: string;
  /** Present while the note is checked out to the live editor: the text above is the live text. */
  live?: LiveNoteState;
}

/**
 * `text_file`, `pdf_file`, `html_file` and `other_file` are the files of a notebook that are not notes: a link to one opens
 * it as read-only text, as a PDF, as a sandboxed page, or as a download.
 */
export type ResourceType = 'note' | 'compilation' | 'outline' | 'template' | 'agent_instruction' | 'agent_doc' | 'workspace_config' | 'asset' | 'text_file' | 'pdf_file' | 'html_file' | 'other_file' | 'product_source' | 'hidden';

export interface ClassifiedResource {
  path: string;
  type: ResourceType;
  notebookId?: string;
}

export interface FolderItem {
  notebookId: string;
  path: string;
  title: string;
  order: number;
  description?: string;
}

export interface FolderMetadata {
  title?: string;
  order?: number;
  description?: string;
  [key: string]: unknown;
}
