/**
 * The note templates the app ships, offered in the New note menu after a notebook's own (`notebooks[].templates`). Their text is in the
 * app's language and filled in here, so they need no file in the workspace and no request to it. Their ids hold a colon, which a
 * notebook's template id cannot, so the two never collide.
 */
import type { TranslationKey } from './i18n/en.js';
import type { RenderedNoteTemplate } from './new-note.js';

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

interface BuiltinNoteTemplate {
  id: `builtin:${string}`;
  /** The template's name in the menu. */
  title: TranslationKey;
  /** The note's text, with `{title}` for the new note's title. */
  body: TranslationKey;
  metadata: Record<string, unknown>;
}

export const BUILTIN_NOTE_TEMPLATES: readonly BuiltinNoteTemplate[] = [
  // A blog reads a note by its separators unless it says `structure: headings`, and plays it with contour-deck only for `engine: contour`.
  { id: 'builtin:slides', title: 'template.slides', body: 'template.slides.body', metadata: { type: 'slide', slideOptions: { engine: 'contour', structure: 'headings' } } },
];

/** Whether a template id names one of {@link BUILTIN_NOTE_TEMPLATES}. */
export function isBuiltinTemplate(id: string): boolean {
  return id.startsWith('builtin:');
}

/** The built-in templates as the New note menu lists them. */
export function builtinNoteTemplates(t: Translate): { id: string; title: string; }[] {
  return BUILTIN_NOTE_TEMPLATES.map(template => ({ id: template.id, title: t(template.title) }));
}

/**
 * A built-in template filled in for a new note titled `title`. Its metadata carries no title: the note's heading names it, as a blank
 * note's does.
 */
export function renderBuiltinNoteTemplate(id: string, title: string, t: Translate): RenderedNoteTemplate {
  const template = BUILTIN_NOTE_TEMPLATES.find(candidate => candidate.id === id);
  if (!template) throw new Error(`There is no built-in template '${id}'`);
  return { content: t(template.body, { title }), metadata: structuredClone(template.metadata) };
}
