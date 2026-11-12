/**
 * The Lucide icons a note can name, loaded on first use. The icon data is one lazy chunk (`import('lucide')`), so the
 * app's main chunk carries none of it; until it arrives, `inline-icon.ts` draws a placeholder and fills it in. A server
 * renders synchronously, so it awaits `loadLucideIcons()` once before it renders.
 */

/** One shape inside an icon: its element name and attributes, as Lucide writes them. */
export type IconShape = readonly [tag: string, attributes: Readonly<Record<string, string | number>>];

export interface LucideIcon {
  /** The PascalCase name Lucide exports the icon under. */
  name: string;
  children: readonly IconShape[];
}

/** Whether two spellings of one icon name agree: case and every separator are ignored (`FileText`, `file-text`, `file text`). */
export function iconKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

let byKey: ReadonlyMap<string, LucideIcon> | null = null;
let sortedNames: readonly string[] = [];
let loading: Promise<void> | null = null;

/** Loads the icon set once; every caller gets the same promise, and a failed load can be tried again. */
export function loadLucideIcons(): Promise<void> {
  loading ??= import('lucide').then(({ icons }) => {
    const index = new Map<string, LucideIcon>();
    for (const [name, node] of Object.entries(icons)) index.set(iconKey(name), { name, children: node[2] ?? [] });
    byKey = index;
    sortedNames = Object.keys(icons).sort();
  }, (error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

export function lucideIconsLoaded(): boolean {
  return byKey !== null;
}

/** The icon `name` stands for, or undefined for a name Lucide does not have or before the set has loaded. */
export function lucideIcon(name: string): LucideIcon | undefined {
  return byKey?.get(iconKey(name));
}

/** Every name Lucide exports, aliases included, in order; empty until the set has loaded. */
export function lucideIconNames(): readonly string[] {
  return sortedNames;
}
