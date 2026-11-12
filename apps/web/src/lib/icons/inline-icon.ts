import { loadLucideIcons, lucideIcon, lucideIconsLoaded } from './lucide-registry.js';

/** One `:icon[Name]{size="16"}` or `:icon{name="Name" size="16"}` directive in a text. */
export interface InlineIcon {
  /** The directive's range in the text. */
  from: number;
  to: number;
  /** The icon name as written: PascalCase as Lucide writes it, or kebab-case. */
  name: string;
  /** The size as written, when there is one. */
  size?: string;
}

/** The shape elements a Lucide icon is drawn with; the sanitizer's allow-list (`DOMPURIFY_DIRECTIVE_CONFIG`) names the same ones. */
const SHAPES = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']);
/** A directive needs its brackets or braces, so `:icons` and a bare `:icon` stay text. Attributes never cross a line. */
const DIRECTIVE = /:icon(?:\[([^\]\n]*)\](?:\{([^}\n]*)\})?|\{([^}\n]*)\})/g;
const ATTRIBUTE = /(?<![\w-])(name|size)=(?:"([^"]*)"|'([^']*)'|([^\s}]+))/g;
/** A positive number, in pixels, or one with a CSS length unit; the size goes into an SVG attribute, never into a style. */
const SIZE = /^(?:\d+(?:\.\d+)?|\.\d+)(?:px|em|rem|ex|ch|pt|vw|vh|%)?$/;
const DEFAULT_SIZE = '1em';

export function findInlineIcons(text: string): InlineIcon[] {
  const found: InlineIcon[] = [];
  for (const match of text.matchAll(DIRECTIVE)) {
    const attributes: Record<string, string> = {};
    for (const attribute of (match[2] ?? match[3] ?? '').matchAll(ATTRIBUTE)) attributes[attribute[1]] = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
    const name = (attributes.name || match[1] || '').trim();
    found.push({ from: match.index, to: match.index + match[0].length, name, size: attributes.size?.trim() || undefined });
  }
  return found;
}

/** The size an SVG `width` and `height` take: a number is pixels, a CSS length stays as written, anything else is 1em. */
export function iconSize(input?: string): string {
  const size = input?.trim() ?? '';
  return SIZE.test(size) && Number.parseFloat(size) > 0 ? size : DEFAULT_SIZE;
}

const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The glyph drawn for a name Lucide does not have, and for a name whose set has not loaded yet: a dashed square with a question mark. */
const FALLBACK_SHAPES = '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 3"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>';

function holder(name: string, size: string, shapes: string, state?: 'pending' | 'missing'): string {
  const label = escapeAttribute(name);
  const svg = `<svg width="${escapeAttribute(size)}" height="${escapeAttribute(size)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes}</svg>`;
  return `<span class="lucide-icon inline-icon${state ? ` lucide-icon-${state}` : ''}" data-lucide="${label}" data-size="${escapeAttribute(size)}" title="${label}" role="img" aria-label="${label}">${svg}</span>`;
}

/**
 * One icon as the HTML a note carries: its real Lucide shapes in an SVG sized by width and height attributes (never a
 * style, which a public page's sanitizer would drop), `currentColor`, and the name in its title. A name Lucide does not
 * have gets the fallback glyph; before the icon set has loaded every name does, and `hydratePendingIcons` redraws it.
 */
export function inlineIconHtml(name: string, sizeInput?: string): string {
  const size = iconSize(sizeInput);
  if (!lucideIconsLoaded()) {
    requestIcons();
    return holder(name, size, FALLBACK_SHAPES, 'pending');
  }
  const icon = lucideIcon(name);
  if (!icon) return holder(name, size, FALLBACK_SHAPES, 'missing');
  const shapes = icon.children.filter(([tag]) => SHAPES.has(tag)).map(([tag, attributes]) => `<${tag} ${Object.entries(attributes).filter(([key]) => key !== 'key' && /^[a-z][a-z0-9-]*$/.test(key)).map(([key, value]) => `${key}="${escapeAttribute(String(value))}"`).join(' ')}/>`).join('');
  return holder(icon.name, size, shapes);
}

/** The code spans of a line, whose text is shown, never drawn. */
function codeSpans(line: string): { from: number; to: number; }[] {
  return [...line.matchAll(/(`+)(?!`)[^]*?(?<!`)\1(?!`)/g)].map(match => ({ from: match.index, to: match.index + match[0].length }));
}

/** `line` with each icon directive outside inline code drawn. */
export function renderInlineIcons(line: string): string {
  if (!line.includes(':icon')) return line;
  const code = codeSpans(line);
  let result = '', position = 0;
  for (const icon of findInlineIcons(line)) {
    if (code.some(span => icon.from < span.to && icon.to > span.from)) continue;
    result += line.slice(position, icon.from) + inlineIconHtml(icon.name || 'circle', icon.size);
    position = icon.to;
  }
  return result + line.slice(position);
}

let hydration: Promise<void> | null = null;
/** Starts loading the icon set, and redraws the placeholders of the document once it is there. */
function requestIcons(): void {
  hydration ??= loadLucideIcons().then(() => {
    if (typeof document !== 'undefined') hydratePendingIcons(document);
  }).catch((error: unknown) => {
    hydration = null;
    console.error('The Lucide icon set did not load; icons stay as placeholders.', error);
  });
}

/**
 * Redraws each placeholder under `root` that was made before the icon set loaded, now that it has. The placeholder's own
 * element stays, so whatever the page attached to it (an editor widget's click handler) keeps working.
 */
export function hydratePendingIcons(root: ParentNode): void {
  if (!lucideIconsLoaded()) return;
  for (const placeholder of root.querySelectorAll<HTMLElement>('.lucide-icon-pending[data-lucide]')) {
    const template = document.createElement('template');
    template.innerHTML = inlineIconHtml(placeholder.dataset.lucide ?? '', placeholder.dataset.size);
    const drawn = template.content.firstElementChild;
    if (!drawn) continue;
    placeholder.classList.remove('lucide-icon-pending');
    placeholder.classList.toggle('lucide-icon-missing', drawn.classList.contains('lucide-icon-missing'));
    for (const attribute of ['data-lucide', 'title', 'aria-label']) placeholder.setAttribute(attribute, drawn.getAttribute(attribute) ?? '');
    placeholder.replaceChildren(...drawn.childNodes);
  }
}
