export interface RenderedNoteTemplate {
  content: string;
  metadata: Record<string, unknown>;
}

export interface NewNoteDraft {
  content: string;
  metadata: Record<string, unknown>;
  status: string;
}

/**
 * Builds a new note's initial content, metadata and status. A template supplies the content
 * and any extra metadata fields, but the tags and status the user confirmed in the dialog
 * always win over whatever the re-rendered template would otherwise set.
 */
export function buildNewNoteDraft(params: { slug: string; title: string; tags: string[]; status: string; template?: RenderedNoteTemplate; }): NewNoteDraft {
  const { slug, title, tags, status, template } = params;
  if (!template) return { content: `# ${title}\n\nWrite your note here.\n`, metadata: { id: slug, title, tags }, status };
  return { content: template.content, metadata: { id: slug, ...template.metadata, tags }, status };
}

/** A value a live New asks for before the note is created: a placeholder of the template's path, with its declared default. */
export interface LivePathPrompt {
  name: string;
  default: string;
  description?: string;
}

const PATH_PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}/g;

/**
 * The placeholders of a template's path pattern a live New asks for (spec §8, Q1): every one but `title`, `date` and
 * `time`, which the note's first check-in fills from the note itself. None without a path pattern.
 */
export function livePathPrompts(template: { path?: string; placeholders: { name: string; default?: string; description?: string; }[]; }): LivePathPrompt[] {
  if (!template.path) return [];
  const names = [...new Set([...template.path.matchAll(PATH_PLACEHOLDER)].map(match => match[1]))].filter(name => name !== 'title' && name !== 'date' && name !== 'time');
  return names.map(name => {
    const declared = template.placeholders.find(placeholder => placeholder.name === name);
    return { name, default: declared?.default ?? '', ...(declared?.description ? { description: declared.description } : {}) };
  });
}
