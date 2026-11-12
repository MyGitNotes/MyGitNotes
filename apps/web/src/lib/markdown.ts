import { Lexer, Marked, type MarkedExtension } from 'marked';
import markedCjkFriendly from 'marked-cjk-friendly';
import DOMPurify from 'dompurify';
import { parseYouTubeUrl } from '@mygitnotes/core/compilation';
import { isOutlinePath } from '@mygitnotes/core/outline';
import { parseR2Reference, r2AssetUrl, r2PreviewType } from '@mygitnotes/core/r2-references';
import { newTabRel } from './same-origin.js';
import { headingSlug, resolveWorkspaceHref } from './workspace-links.js';
import { escapeHtml, type NoteLanguage, stringsFor, stripMdxImports, transformDirectives, transformMdxComponents } from './directives.js';
import type { SlideRendering } from './slides/directives.js';
import { labelSlidePreview } from './slides/structure.js';
import { isMermaidInfo, MERMAID_BLOCK_SELECTOR } from './mermaid.js';
import { createMarkedMath, type MathOutput } from './math.js';
import { DEFAULT_YOUTUBE_LABELS, type YouTubeDisplayMode, type YouTubeLabels } from './youtube-embed.js';

// With `breaks`, marked's inline text rule stops before every `\n` that follows spaces by testing ` *\n` at each position
// of a run of spaces, which reads to the end of the run each time: a line of n spaces costs n² steps, seconds for a
// pasted block of 100k. The test is redundant inside the rule: the non-space character before a run already ends the
// text there (`[^ ](?= *\n)`), and so does the check at the start of the match. Dropping it matches the same text.
const BREAKS_TEXT_RULE = Lexer.rules.inline.breaks.text;
const LINEAR_BREAKS_TEXT_RULE = new RegExp(BREAKS_TEXT_RULE.source.replace('\\b_| *\\n', '\\b_'));
const linearBreaksText: MarkedExtension = LINEAR_BREAKS_TEXT_RULE.source === BREAKS_TEXT_RULE.source ? {} : {
  tokenizer: {
    inlineText(src) {
      if (!this.options.gfm || !this.options.breaks) return false;
      const cap = LINEAR_BREAKS_TEXT_RULE.exec(src);
      return cap ? { type: 'text', raw: cap[0], text: cap[0], escaped: this.lexer.state.inRawBlock } : false;
    },
  },
};

// CommonMark cannot close emphasis when a full-width punctuation mark sits before the delimiter and
// a CJK character after it, so `**二口女（ふたくちおんな）**意象` renders as literal asterisks.
function newMarked(math: MarkedExtension): Marked {
  const marked = new Marked(markedCjkFriendly(), linearBreaksText, math);
  // A mermaid fence renders to a placeholder holding its source as text; sanitized HTML cannot carry the SVG, so each
  // surface draws the diagram once the HTML is mounted (see hydrateMermaid). The source stays in the <pre> because
  // DOMPurify drops an attribute value containing `-->`, which every flowchart edge does.
  marked.use({ renderer: { code: ({ text, lang }) => isMermaidInfo(lang ?? '') ? `<div class="note-mermaid"><pre>${escapeHtml(text)}</pre></div>\n` : false } });
  return marked;
}

const md = newMarked(createMarkedMath('html'));

export const DOMPURIFY_DIRECTIVE_CONFIG = { ADD_TAGS: ['iframe', 'details', 'summary', 'aside', 'section', 'article', 'header', 'footer', 'figure', 'figcaption', 'abbr', 'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'cite'], ADD_ATTR: ['allow', 'allowfullscreen', 'loading', 'data-video-id', 'data-start', 'data-youtube-mode', 'data-youtube-mode-option', 'data-youtube-session', 'data-youtube-source-url', 'data-youtube-copy', 'data-copy-label', 'data-copied-label', 'data-copy-failed-label', 'controls', 'preload', 'data-type', 'data-variant', 'data-stat', 'data-cols', 'data-col-span', 'data-direction', 'data-arrow', 'data-icon', 'data-qrcode', 'data-size', 'data-component-name', 'data-lucide', 'data-slide-index', 'data-vertical', 'data-label', 'data-card-type', 'open', 'aria-label', 'aria-hidden', 'style', 'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'] };

/** Where a chat reply's links resolve from: the folder Pi runs in, repository-relative and on disk. */
export interface ChatLinkBase {
  /** Repository-relative folder Pi runs in; relative links resolve from it. */
  folder: string;
  /** The repository's absolute folder on disk, so a link Pi writes as an absolute path still reaches the note. */
  repositoryRoot: string;
}

/** A reply link as a workspace href: an absolute file path inside the repository becomes repository-rooted. */
function chatHref(href: string, base: ChatLinkBase): string | null {
  if (!href.startsWith('/')) return href;
  return href.startsWith(`${base.repositoryRoot}/`) ? href.slice(base.repositoryRoot.length) : null;
}

/**
 * Pages a reply could be read on, at a host no URL in it can name: a source resolved against one that lands elsewhere
 * names a host of its own. Both schemes, since `https:host` is a path on an https page but a host on an http one.
 */
const WORKSPACE_PROBES = ['https://workspace.invalid/folder/', 'http://workspace.invalid/folder/'];
/** Whether `source` loads from another host, parsed as the browser would (`//host`, `/\host`, `https:host` and any scheme with a host count); `@/`, repository-rooted and relative paths stay in the workspace, and a source with no host at all (`data:`, `r2:`) counts as elsewhere, so it shows as a link. */
function loadsFromElsewhere(source: string): boolean {
  return WORKSPACE_PROBES.some(probe => {
    try {
      return new URL(source, probe).host !== 'workspace.invalid';
    } catch {
      return false;
    }
  });
}
/** Attributes that only name or describe, which nothing reads as CSS; math keeps its TeX source, backslashes and all, in `aria-label`. `src` is a URL, checked on its own below. */
const TEXT_ATTRIBUTE = /^(?:alt|title|aria-[\w-]+)$/;
/** Attributes that load a resource on their own, beside `src`; a reply needs none of them. */
const LOADING_ATTRIBUTES = ['srcset', 'poster', 'background', 'data', 'lowsrc', 'dynsrc', 'formaction', 'ping'];

/**
 * A reply can quote any note an injected instruction told the agent to read, so nothing in it may load from another
 * host without a click: such a load sends whatever its URL carries. An image from elsewhere becomes a link to it (its
 * alt text and address), other media from elsewhere go, and so do the attributes and styles that load by themselves,
 * the PDF figures, which load their `href`, and the mermaid diagrams, which load the images they name. Workspace
 * images stay. `<style>` never gets here: the sanitizer drops it.
 */
function keepLoadsInWorkspace(document: Document) {
  for (const element of document.body.querySelectorAll('*')) {
    for (const name of LOADING_ATTRIBUTES) element.removeAttribute(name);
    if (/url|image|@import|\\/i.test(element.getAttribute('style') ?? '')) element.removeAttribute('style');
    if (element.tagName !== 'A') {
      for (const name of ['href', 'xlink:href']) if (loadsFromElsewhere(element.getAttribute(name) ?? '')) element.removeAttribute(name);
      // SVG reads `fill`, `mask`, `filter`, `clip-path` and the like as CSS, where `url(` and `image-set(` load and an escape can spell either.
      for (const { name, value } of Array.from(element.attributes)) if (!TEXT_ATTRIBUTE.test(name) && name !== 'src' && /url|image|\\/i.test(value)) element.removeAttribute(name);
    }
    if (element.matches('figure.ann-pdf')) element.classList.remove('ann-pdf');
    // Mermaid loads the images a diagram names while it draws it, before anything could clean its SVG, so a reply's
    // diagram stays its source, as a code block.
    if (element.matches(MERMAID_BLOCK_SELECTOR)) {
      const code = document.createElement('code');
      code.className = 'language-mermaid';
      code.textContent = element.textContent;
      const block = document.createElement('pre');
      block.append(code);
      element.replaceWith(block);
      continue;
    }
    const source = element.getAttribute('src');
    if (source === null || !loadsFromElsewhere(source)) continue;
    if (element.tagName !== 'IMG') {
      element.remove();
      continue;
    }
    const alt = element.getAttribute('alt')?.trim();
    const link = document.createElement('a');
    link.href = source;
    link.className = 'chat-external-image';
    link.textContent = alt ? `${alt} (${source})` : source;
    element.replaceWith(link);
  }
}

/**
 * HTML for a chat reply, in the notes' Markdown dialect (CJK emphasis, math; a mermaid diagram stays its source). Links are workspace
 * links, so the surrounding WorkspaceLinks opens a note in the app and a web page in a new tab; without a
 * `base` only web links stay. Nothing in it loads from another host until it is clicked.
 */
export function renderChatMarkdown(text: string, base?: ChatLinkBase): string {
  const parsed = new DOMParser().parseFromString(DOMPurify.sanitize(md.parse(text, { gfm: true }) as string, { FORBID_TAGS: ['style'] }), 'text/html');
  keepLoadsInWorkspace(parsed);
  const origin = typeof window !== 'undefined' ? window.location.origin : undefined;
  // A file standing in the folder, since relative hrefs resolve from their source file's folder.
  const sourcePath = base ? `${base.folder}/.pi-agent` : '';
  for (const link of parsed.querySelectorAll('a')) {
    const original = link.getAttribute('href') || '';
    const href = base ? chatHref(original, base) : /^https?:\/\//i.test(original) ? original : null;
    const target = href ? resolveWorkspaceHref(href, sourcePath, undefined, origin) : null;
    if (!href || !target || !base && target.kind !== 'external') {
      link.removeAttribute('href');
      continue;
    }
    link.setAttribute('href', href);
    link.dataset.workspaceLink = href;
    link.dataset.sourcePath = sourcePath;
    link.rel = 'noopener noreferrer';
    if (target.kind === 'external') link.target = '_blank';
  }
  for (const table of parsed.querySelectorAll('table')) {
    const scroller = parsed.createElement('div');
    scroller.className = 'markdown-table-scroll';
    table.replaceWith(scroller);
    scroller.append(table);
  }
  return parsed.body.innerHTML;
}

export { loadLucideIcons } from './icons/lucide-registry.js';

/** What a note is rendered with: the HTML parser and the DOMPurify instance of the window it runs in. */
export interface NoteRendererOptions {
  /** `new DOMParser()` of a browser window, or of a jsdom window on a server. */
  parser: DOMParser;
  /** DOMPurify bound to that same window. */
  purify: Pick<typeof DOMPurify, 'sanitize'>;
  /** Links to this origin resolve as workspace links; defaults to the browser's own. */
  origin?: string;
  /** `mathml` draws formulas without inline style, for a page that may carry none; the default is the app's HTML output. */
  mathOutput?: MathOutput;
  /** The language of the labels a note's directives write (annotation and handout labels); the browser's `renderNote` follows the page, a server defaults to English. */
  language?: NoteLanguage;
}

/** What a note is, beyond its text, that changes how it is drawn. */
export interface NoteRenderOptions {
  /**
   * Set for a `type: slide` note. `preview` draws its slide directives as a reader sees them (labelled notes, numbered steps, labelled
   * slide and page dividers, an error box for a directive contour-deck refuses); `deck` writes them as the markers contour-deck builds a
   * deck from, and throws a `SlideDeckError` for such a directive. Without it a note keeps the general rendering.
   */
  slides?: SlideRendering;
  /**
   * The slide note's `slideOptions.structure` (`slideStructureOf`): with `headings`, contour-deck's headings mode, a `---` is a block, a
   * `##` a slide and a `###` a page, and `::vertical` is refused. Without it the note is read by its separators.
   */
  structure?: string;
}

interface RenderContext {
  marked: Marked;
  parser: DOMParser;
  purify: Pick<typeof DOMPurify, 'sanitize'>;
  origin: string | undefined;
  language?: NoteLanguage;
}

/**
 * The notes' Markdown pipeline (marked, the MyGitNotes directives, KaTeX) bound to a window, so a server can render the
 * same HTML the app does under a jsdom window. The app uses {@link renderNote}.
 */
export function createNoteRenderer({ parser, purify, origin, mathOutput = 'html', language = 'en' }: NoteRendererOptions) {
  const marked = mathOutput === 'html' ? md : newMarked(createMarkedMath(mathOutput));
  return {
    /** `notebookId` names the note's notebook, so an asset URL reaches the right repository when notebook roots repeat across repositories. */
    renderNote: (content: string, notePath: string, tableLabel?: string, youtubeLabels?: YouTubeLabels, notebookId?: string, options?: NoteRenderOptions): string => renderNoteIn({ marked, parser, purify, origin, language }, content, notePath, tableLabel, youtubeLabels, notebookId, options),
  };
}

/** `notebookId` names the note's notebook, so an asset URL reaches the right repository when notebook roots repeat across repositories. */
export function renderNote(content: string, notePath: string, tableLabel?: string, youtubeLabels?: YouTubeLabels, notebookId?: string, options?: NoteRenderOptions): string {
  return renderNoteIn({ marked: md, parser: new DOMParser(), purify: DOMPurify, origin: typeof window !== 'undefined' ? window.location.origin : undefined }, content, notePath, tableLabel, youtubeLabels, notebookId, options);
}

function renderNoteIn({ marked, parser, purify, origin, language }: RenderContext, content: string, notePath: string, tableLabel = 'Horizontally scrollable table (Alt + wheel)', youtubeLabels: YouTubeLabels = DEFAULT_YOUTUBE_LABELS, notebookId?: string, { slides, structure }: NoteRenderOptions = {}): string {
  const isMdx = /\.mdx$/i.test(notePath);
  let preprocessed = content;
  if (isMdx) {
    preprocessed = stripMdxImports(preprocessed);
  }

  preprocessed = transformDirectives(preprocessed, source => marked.parse(source, { gfm: true, breaks: true }) as string, source => marked.parseInline(source, { gfm: true, breaks: true }) as string, language, html => parser.parseFromString(html, 'text/html').body.innerHTML, slides && { rendering: slides, structure, lineOf: index => index + 1 });

  if (isMdx || /<(?:YouTubeEmbed|YouTube|ProtectedContent|Card|Tag|Badge|[A-Z][a-zA-Z0-9_-]*)\b/.test(preprocessed)) {
    preprocessed = transformMdxComponents(preprocessed, language);
  }

  const rawHtml = marked.parse(preprocessed, { gfm: true, breaks: true }) as string;
  // Only a note with an annotation figure pays for the figure checks below.
  const annotated = rawHtml.includes('ann-figure');
  const parsed = parser.parseFromString(purify.sanitize(rawHtml, DOMPURIFY_DIRECTIVE_CONFIG), 'text/html');
  for (const table of parsed.querySelectorAll('table')) {
    // An infographic's data table is part of its figure.
    if (table.closest('.ig-figure')) continue;
    const scroller = parsed.createElement('div');
    scroller.className = 'markdown-table-scroll';
    scroller.tabIndex = 0;
    scroller.setAttribute('role', 'region');
    scroller.setAttribute('aria-label', tableLabel);
    table.replaceWith(scroller);
    scroller.append(table);
  }
  for (const image of parsed.querySelectorAll('img')) {
    const src = image.getAttribute('src') || '';
    const r2Key = parseR2Reference(src);
    // The image of an annotation figure keeps its place under the overlay and is no link: a click on it annotates.
    if (annotated && image.closest('.ann-stage')) {
      const url = annotationMediaUrl(src, notePath, notebookId);
      if (url !== undefined) image.setAttribute('src', url);
      else dropStageImage(image);
      continue;
    }
    if (r2Key !== null) {
      image.replaceWith(r2Preview(parsed, r2Key, notePath, image.getAttribute('alt') || ''));
      continue;
    }
    const target = resolveWorkspaceHref(src, notePath);
    if (target && target.kind !== 'external') {
      image.dataset.workspaceLink = src;
      image.dataset.sourcePath = notePath;
      image.tabIndex = 0;
      image.setAttribute('role', 'button');
    }
    if (target?.kind === 'path') image.setAttribute('src', `/raw-assets/${target.path.split('/').map(encodeURIComponent).join('/')}${notebookId ? `?notebook=${encodeURIComponent(notebookId)}` : ''}`);
    else if (!target && !/^data:image\//i.test(src)) image.remove();
  }
  for (const heading of parsed.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')) heading.dataset.headingSlug = headingSlug(heading.textContent || '');
  for (const p of parsed.querySelectorAll('p')) {
    if (p.children.length === 1 && p.children[0].tagName.toLowerCase() === 'a') {
      const anchor = p.children[0] as HTMLAnchorElement;
      const href = anchor.getAttribute('href') || '';
      const video = isOutlinePath(notePath) ? null : parseYouTubeUrl(href);
      if (video && (p.textContent || '').trim() === (anchor.textContent || '').trim()) {
        const embed = parsed.createElement('div');
        embed.className = 'note-youtube-embed';
        embed.dataset.videoId = video.videoId;
        embed.dataset.start = String(video.start);
        embed.dataset.youtubeSourceUrl = href;
        p.replaceWith(embed);
      }
    }
  }
  const youtubeEmbeds = [...parsed.querySelectorAll<HTMLElement>('div')].filter(element => element.className.split(/\s+/).includes('note-youtube-embed'));
  for (const [index, embed] of youtubeEmbeds.entries()) {
    embed.dataset.youtubeSession = `${notePath}:${index}:${embed.dataset.videoId}:${embed.dataset.start}`;
    embed.dataset.youtubeMode = 'thumbnail';
    const toolbar = parsed.createElement('div');
    toolbar.className = 'note-youtube-mode-control';
    toolbar.setAttribute('role', 'group');
    toolbar.setAttribute('aria-label', youtubeLabels.modes);
    for (const [mode, label] of [['thumbnail', youtubeLabels.thumbnail], ['medium', youtubeLabels.medium], ['theater', youtubeLabels.theater]] as [YouTubeDisplayMode, string][]) {
      const control = parsed.createElement('button');
      control.setAttribute('type', 'button');
      control.dataset.youtubeModeOption = mode;
      control.textContent = label;
      control.setAttribute('title', label);
      control.setAttribute('aria-label', label);
      control.setAttribute('aria-pressed', String(mode === 'thumbnail'));
      toolbar.append(control);
    }
    const copy = parsed.createElement('button');
    copy.setAttribute('type', 'button');
    copy.className = 'note-youtube-copy';
    copy.dataset.youtubeCopy = '';
    copy.dataset.copyLabel = youtubeLabels.copy;
    copy.dataset.copiedLabel = youtubeLabels.copied;
    copy.dataset.copyFailedLabel = youtubeLabels.copyFailed;
    copy.setAttribute('aria-label', youtubeLabels.copy);
    copy.setAttribute('title', youtubeLabels.copy);
    copy.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    toolbar.append(copy);
    const poster = parsed.createElement('button');
    poster.setAttribute('type', 'button');
    poster.className = 'note-youtube-poster';
    poster.setAttribute('aria-label', youtubeLabels.play);
    poster.dataset.youtubePlayerLabel = youtubeLabels.player;
    const image = parsed.createElement('img');
    image.setAttribute('src', `https://img.youtube.com/vi/${encodeURIComponent(embed.dataset.videoId || '')}/hqdefault.jpg`);
    image.setAttribute('alt', '');
    image.setAttribute('loading', 'lazy');
    const play = parsed.createElement('span');
    play.className = 'note-youtube-play-btn';
    play.setAttribute('aria-hidden', 'true');
    play.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>';
    poster.append(image);
    poster.append(play);
    embed.append(toolbar);
    embed.append(poster);
  }
  for (const link of parsed.querySelectorAll('a')) {
    // A marker or number of an annotation figure only jumps within the figure; the page-level listener handles the click.
    if (annotated && (link.matches('a.ann-marker, a.ann-ref, a.ann-page-ref'))) continue;
    // A PDF figure's link is the address the page viewer loads: resolved like its image would be, and no workspace link.
    if (annotated && link.matches('.ann-pdf a.ann-open')) {
      const url = annotationMediaUrl(link.getAttribute('href') || '', notePath, notebookId);
      if (url === undefined) link.removeAttribute('href');
      else {
        link.setAttribute('href', url);
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', newTabRel(url));
      }
      continue;
    }
    const href = link.getAttribute('href') || '';
    if (href.startsWith('/r2-assets/')) continue;
    const r2Key = parseR2Reference(href);
    if (r2Key !== null) {
      const r2Url = r2AssetUrl(r2Key, notePath);
      link.setAttribute('href', r2Url);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', newTabRel(r2Url));
      continue;
    }
    const target = resolveWorkspaceHref(href, notePath, undefined, origin);
    if (!target) {
      link.removeAttribute('href');
      continue;
    }
    link.dataset.workspaceLink = href;
    link.dataset.sourcePath = notePath;
    link.setAttribute('rel', 'noopener noreferrer');
    if (target.kind === 'external') link.setAttribute('target', '_blank');
  }
  if (slides === 'preview') labelSlidePreview(parsed.body, stringsFor(language), structure);
  return purify.sanitize(parsed.body.innerHTML, DOMPURIFY_DIRECTIVE_CONFIG);
}

/**
 * The address an annotation figure loads its image or PDF from, resolved like any note asset but without the link behaviour;
 * undefined when the source is not allowed. The image stage and the PDF viewer both read it, so the two cannot drift.
 */
export function annotationMediaUrl(src: string, notePath: string, notebookId: string | undefined): string | undefined {
  const r2Key = parseR2Reference(src);
  if (r2Key !== null) return r2AssetUrl(r2Key, notePath);
  const target = resolveWorkspaceHref(src, notePath);
  if (target?.kind === 'path') return `/raw-assets/${target.path.split('/').map(encodeURIComponent).join('/')}${notebookId ? `?notebook=${encodeURIComponent(notebookId)}` : ''}`;
  if (!target && !/^data:image\//i.test(src)) return undefined;
  return src;
}

function dropStageImage(image: Element): void {
  // Without its image the stage has nothing to lay the markers over.
  image.closest('.ann-stage')?.querySelector('.ann-overlay')?.remove();
  image.remove();
}

function r2Preview(doc: Document, key: string, notePath: string, label: string): HTMLElement {
  const url = r2AssetUrl(key, notePath);
  const { kind } = r2PreviewType(key);
  const name = label || key.split('/').pop() || key;
  const figure = doc.createElement('figure');
  figure.className = `note-r2-asset note-r2-${kind}`;
  if (kind === 'file') {
    const link = doc.createElement('a');
    link.className = 'note-r2-file-link';
    link.setAttribute('href', url);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', newTabRel(url));
    const icon = doc.createElement('span');
    icon.className = 'note-r2-file-icon';
    icon.textContent = '📎';
    const text = doc.createElement('span');
    text.className = 'note-r2-file-name';
    text.textContent = name;
    const badge = doc.createElement('span');
    badge.className = 'note-r2-file-badge';
    badge.textContent = 'R2';
    link.append(icon);
    link.append(text);
    link.append(badge);
    figure.append(link);
    return figure;
  }
  const media = doc.createElement(kind === 'pdf' ? 'iframe' : kind === 'image' ? 'img' : kind);
  media.setAttribute('src', url);
  if (kind === 'pdf') {
    media.setAttribute('title', name);
    media.setAttribute('loading', 'lazy');
  } else if (kind === 'image') {
    media.setAttribute('alt', label);
    media.setAttribute('loading', 'lazy');
  } else {
    media.setAttribute('controls', '');
    media.setAttribute('preload', 'metadata');
  }
  const caption = doc.createElement('figcaption');
  const open = doc.createElement('a');
  open.setAttribute('href', url);
  open.setAttribute('target', '_blank');
  open.setAttribute('rel', newTabRel(url));
  open.textContent = name;
  const extIcon = doc.createElement('span');
  extIcon.className = 'note-r2-ext-icon';
  extIcon.textContent = ' ↗';
  open.append(extIcon);
  caption.append(open);
  figure.append(media);
  figure.append(caption);
  return figure;
}
