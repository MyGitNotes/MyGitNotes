import { iconKey } from './lucide-registry.js';

export interface IconSearchResult {
  /** The best `limit` matching names. */
  names: string[];
  /** How many names matched in all. */
  total: number;
}

/**
 * The icon names a picker shows for `query`: every word of the query must occur in the name, ignoring case and
 * separators (`file-text`, `file text` and `FileText` agree). An exact name comes first, then names that start with the
 * query, then the rest, each group in name order; no query lists them all in name order.
 */
export function searchIconNames(names: readonly string[], query: string, limit: number): IconSearchResult {
  const words = query.split(/[\s,]+/).map(iconKey).filter(Boolean);
  const whole = iconKey(query);
  const rank = (name: string) => {
    const key = iconKey(name);
    return key === whole ? 0 : key.startsWith(whole) ? 1 : 2;
  };
  const matched = names.filter(name => {
    const key = iconKey(name);
    return words.every(word => key.includes(word));
  });
  const ordered = matched.map(name => ({ name, rank: words.length === 0 ? 0 : rank(name) })).sort((a, b) => a.rank - b.rank || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map(entry => entry.name);
  return { names: ordered.slice(0, limit), total: ordered.length };
}

/** The directive that puts an icon in a note; `size` is a number of pixels or a CSS length, and none leaves it at the text's size. */
export function iconDirective(name: string, size?: string): string {
  return size ? `:icon{name="${name}" size="${size}"}` : `:icon{name="${name}"}`;
}
