import { useRef } from 'react';
import { useMermaidDiagrams } from '../lib/use-mermaid-diagrams.js';
import { usePdfFigures } from '../lib/use-pdf-figures.js';

/** A surface nothing is drawn on. */
const UNDRAWN = { current: null };

/**
 * Mounts `renderNote` HTML and draws its mermaid diagrams and turns its PDF annotation figures into page viewers;
 * `notebookId` names the note's notebook for its links. `untrusted` HTML (a chat reply) gets neither, since both load
 * what the HTML names and a class written in it could ask for them.
 */
export function NoteHtml({ html, className, notebookId, untrusted = false }: { html: string; className: string; notebookId?: string; untrusted?: boolean; }) {
  const surface = useRef<HTMLDivElement>(null);
  useMermaidDiagrams(untrusted ? UNDRAWN : surface, html);
  usePdfFigures(untrusted ? UNDRAWN : surface, html);
  return <div ref={surface} className={className} data-markdown-view data-source-notebook={notebookId} dangerouslySetInnerHTML={{ __html: html }} />;
}
