import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchTypstBibliography } from '../api.js';
import { type CitationLibrary, citationLibraryOf } from '../../components/live-markdown/citations.js';
import { usePreviewProject } from './use-preview-project.js';

/**
 * The bibliography a note cites from: that of its thesis-toolkit project, or null for any other note and in remote
 * mode. It is read once per project and bibliography revision, and again when the file changes.
 */
export function useCitationLibrary(notebookId: string | undefined, path: string): CitationLibrary | null {
  const project = usePreviewProject(notebookId, path)?.project;
  const revision = project && project.bibliographyRevision !== 'missing' ? project.bibliographyRevision : undefined;
  // While a changed bibliography loads, the previous one keeps the citations drawn.
  const { data } = useQuery({ queryKey: ['typst-preview', 'bibliography', notebookId ?? '', project?.name ?? '', revision ?? ''], queryFn: () => fetchTypstBibliography(path, notebookId), enabled: Boolean(revision), staleTime: Infinity, retry: false, placeholderData: keepPreviousData });
  const entries = revision ? data?.entries : undefined;
  return useMemo(() => entries ? citationLibraryOf(entries) : null, [entries]);
}
