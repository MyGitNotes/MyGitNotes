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

export interface NotebookConfig {
  id: string;
  title: string;
  root: string;
  assets?: string;
  default_view?: ViewMode;
  statuses?: NotebookStatus[];
  templates?: NoteTemplate[];
  metadata?: NotebookMetadataField[];
  pathAliases?: Record<string, string>;
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
}

export type ResourceType = 'note' | 'compilation' | 'outline' | 'agent_instruction' | 'agent_doc' | 'workspace_config' | 'asset' | 'product_source' | 'hidden';

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
