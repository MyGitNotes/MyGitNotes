import './notebook-mark.css';
import { lucideIcon } from '../lib/icons/lucide-registry.js';
import type { NotebookConfig } from '../lib/types.js';
import { LucideGlyph, useLucideIcons } from './LucideGlyph.js';

/** What a mark is drawn from: the notebook's title, and the icon and colour its manifest gives it. */
export type MarkedNotebook = Pick<NotebookConfig, 'title' | 'icon' | 'color'>;

/**
 * Where a mark sits: `rail` the folded column's tile, `row` a notebooks column row, `inline` beside the notebook's name
 * in the list header or a switcher, `tab` a Focus tab.
 */
export type NotebookMarkSize = 'rail' | 'row' | 'inline' | 'tab';

/** Whether the notebook has a mark of its own; one without keeps the look it had before marks (its initial on the rail, a book elsewhere). */
export const hasNotebookMark = (notebook: MarkedNotebook): boolean => Boolean(notebook.icon || notebook.color);

/** A notebook's initial: its first character, upper-cased. */
export const notebookInitial = (title: string): string => Array.from(title.trim())[0]?.toUpperCase() ?? '?';

/** The kebab-case name a manifest stores for a Lucide icon exported as `name` (`Dice5` → `dice-5`). */
export const iconFileName = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])(?=[A-Z])/g, '$1-').replace(/(?<=[A-Za-z]{2})(?=\d)/g, '-').toLowerCase();

const GLYPH_SIZE: Record<NotebookMarkSize, number> = { rail: 18, row: 12, inline: 13, tab: 10 };

/**
 * A notebook's mark (design C): a tile tinted with its colour, holding its Lucide icon stroked in that colour, or its
 * initial where it has a colour and no icon (or an icon Lucide lacks). An icon without a colour sits on a muted tile.
 * The colours are the theme's status tokens (`notebook-mark.css`), so light, dark and every theme family follow. A
 * notebook with neither draws nothing. The mark is decoration: whatever holds it names the notebook.
 */
export function NotebookMark({ notebook, size, selected = false, className = '' }: { notebook: MarkedNotebook; size: NotebookMarkSize; selected?: boolean; className?: string; }) {
  const loaded = useLucideIcons(Boolean(notebook.icon));
  if (!hasNotebookMark(notebook)) return null;
  const icon = notebook.icon && loaded ? lucideIcon(notebook.icon) : undefined;
  // Until the set arrives the tile stays empty, so a notebook with an icon never flashes its initial.
  const state = icon ? 'icon' : notebook.icon && !loaded ? 'pending' : 'initial';
  return <span className={`notebook-mark ${notebook.color ? `notebook-color-${notebook.color}` : ''} ${className}`} data-size={size} data-color={notebook.color} data-state={state} data-selected={selected ? '' : undefined} aria-hidden='true'>{state === 'icon' ? <LucideGlyph icon={icon} size={GLYPH_SIZE[size]} strokeWidth={size === 'rail' ? 2 : 2.2} /> : state === 'initial' ? notebookInitial(notebook.title) : null}</span>;
}
