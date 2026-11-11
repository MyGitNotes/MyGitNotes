import { useQuery } from '@tanstack/react-query';
import { fetchTypstPreviewProject, type TypstPreviewProjectAnswer } from '../api.js';
import { useTypstPreviewEnabled } from './preview-target.js';

/** How long a project answer is trusted; it is a few file reads on this machine, and the bibliography revision rides on it. */
const PROJECT_STALE_MS = 5000;

/**
 * The thesis-toolkit project of a note, asked only in a workspace that offers the preview (never in remote mode).
 * Read again when the window regains focus, since the project and its bibliography change outside the app.
 */
export function usePreviewProject(notebookId: string | undefined, path: string | undefined): TypstPreviewProjectAnswer | undefined {
  const enabled = useTypstPreviewEnabled();
  return useQuery({ queryKey: ['typst-preview', 'project', notebookId ?? '', path ?? ''], queryFn: () => fetchTypstPreviewProject(path!, notebookId), enabled: enabled && Boolean(path), staleTime: PROJECT_STALE_MS, refetchOnWindowFocus: true, retry: false }).data;
}
