import { useRef } from 'react';
import { useMermaidDiagrams } from '../lib/use-mermaid-diagrams.js';
import { usePdfFigures } from '../lib/use-pdf-figures.js';

/** Mounts `renderNote` HTML and draws its mermaid diagrams and turns its PDF annotation figures into page viewers; `notebookId` names the note's notebook for its links. */
export function NoteHtml({ html, className, notebookId }: { html: string; className: string; notebookId?: string; }) {
  const surface = useRef<HTMLDivElement>(null);
  useMermaidDiagrams(surface, html);
  usePdfFigures(surface, html);
  return <div ref={surface} className={className} data-markdown-view data-source-notebook={notebookId} dangerouslySetInnerHTML={{ __html: html }} />;
}
