import { escapeHtml } from '../directives.js';

/** A whole-figure error the blog fails its build on; the caller shows it in the figure's place. */
export class InfographicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InfographicError';
  }
}

export function fail(message: string): never {
  throw new InfographicError(message);
}

type AttrValue = string | number | boolean | string[] | undefined;

/** `<name attrs>children</name>`; an empty class list, `false` and `undefined` leave the attribute out, `true` writes it bare. */
export function tag(name: string, attrs: Record<string, AttrValue> = {}, children: string | string[] = ''): string {
  const parts = Object.entries(attrs).flatMap(([key, value]) => {
    if (value === undefined || value === false) return [];
    if (value === true) return [key];
    const text = Array.isArray(value) ? value.join(' ') : String(value);
    return Array.isArray(value) && !text ? [] : [`${key}="${escapeHtml(text)}"`];
  });
  const open = `<${name}${parts.length ? ` ${parts.join(' ')}` : ''}>`;
  if (name === 'input') return open;
  return `${open}${Array.isArray(children) ? children.join('') : children}</${name}>`;
}

export const highlightClass = (highlight: boolean): string[] => highlight ? ['is-highlight'] : [];

export function attrOf(attrs: Record<string, string>, key: string): string | undefined {
  return attrs[key]?.trim();
}

export interface InlineRenderer {
  inline: (field: string | undefined) => string;
}
