import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { type CitationEntry, citationEntryLabel } from '@mygitnotes/core/citations';
import { citationKeyAt, citationLibrary } from './citations.js';

function matches(entry: CitationEntry, query: string): boolean {
  if (!query) return true;
  const starts = (text: string) => text.toLowerCase().startsWith(query);
  return starts(entry.key) || entry.authors.some(starts) || entry.title.split(/[\s\p{P}]+/u).some(starts);
}

/** Offers the keys of the project's bibliography inside citation brackets (`[@`, `[-@`, `; @`); nothing outside a project. */
export function citationCompletionSource(context: CompletionContext): CompletionResult | null {
  const library = context.state.facet(citationLibrary);
  if (!library || context.state.readOnly) return null;
  const line = context.state.doc.lineAt(context.pos);
  const typed = citationKeyAt(line.text.slice(0, context.pos - line.from));
  if (typed === null) return null;
  const query = typed.toLowerCase();
  // The bracket is closed already when a `]` comes before any other bracket on the rest of the line.
  const rest = line.text.slice(context.pos - line.from), next = rest.search(/[[\]]/);
  const close = next !== -1 && rest[next] === ']' ? '' : ']';
  return { from: context.pos - typed.length, to: context.pos, filter: false, options: library.entries.filter(entry => matches(entry, query)).map(entry => ({ label: entry.key, detail: `${citationEntryLabel(entry)} · ${entry.title}`, apply: `${entry.key}${close}` })) };
}
