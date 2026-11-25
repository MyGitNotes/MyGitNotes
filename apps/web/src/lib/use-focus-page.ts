import { type Focus, FOCUS_DOCUMENT, type FocusPage, FocusPageSchema } from '@mygitnotes/core/focus-page';
import { type DocumentRepository, useWorkspaceDocument, type WorkspaceDocumentClient, type WorkspaceDocumentController } from './use-workspace-document.js';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * This device's Focus layout with the named Focuses a draft of an earlier version changed from `base`, the page that
 * draft started from; undefined when the two changed the same Focus differently, or the result is no valid page. A
 * Focus one side left as it was in `base` takes the other side's change, its removal included.
 */
export function mergeFocusPages(device: FocusPage, draft: FocusPage, base: FocusPage): FocusPage | undefined {
  const byId = (page: FocusPage) => new Map(page.focuses.map(focus => [focus.id, focus]));
  const mine = byId(device), theirs = byId(draft), was = byId(base);
  const ids = [...new Set([...mine.keys(), ...theirs.keys()])];
  const focuses: Focus[] = [];
  for (const id of ids) {
    const kept = mine.get(id), drafted = theirs.get(id), original = was.get(id);
    if (same(kept, drafted)) {
      if (kept) focuses.push(kept);
    } else if (same(kept, original)) {
      if (drafted) focuses.push(drafted);
    } else if (same(drafted, original)) {
      if (kept) focuses.push(kept);
    } else return;
  }
  const merged = FocusPageSchema.safeParse({ ...device, focuses });
  return merged.success ? merged.data : undefined;
}

export const focusDocumentClient: WorkspaceDocumentClient<FocusPage> = { document: FOCUS_DOCUMENT, endpoint: '/api/focus-page', draftKey: 'focus-draft', deviceKey: 'focus-layout', mergeDevice: mergeFocusPages, messages: { load: 'focus.loadError', conflict: 'focus.conflict', limit: 'focus.limit', draft: 'focus.draftError', save: 'focus.saveError', loading: 'focus.loading' } };
export function useFocusPage(repository: DocumentRepository | undefined, onSaved: () => void, remote = false, enabled = true) {
  return useWorkspaceDocument(focusDocumentClient, repository, onSaved, remote, enabled);
}
export type FocusPageController = WorkspaceDocumentController<FocusPage>;
