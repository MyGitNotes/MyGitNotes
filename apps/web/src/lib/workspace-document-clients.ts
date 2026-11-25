import type { WorkspaceDocumentClient } from './use-workspace-document.js';
import { focusDocumentClient } from './use-focus-page.js';

/** The workspace documents a remote draft can hold, one file per notebook repository. */
export const WORKSPACE_DOCUMENT_CLIENTS = [focusDocumentClient] as WorkspaceDocumentClient<unknown>[];
/** The workspace documents whose online drafts wait in Changes for a commit: every one but this device's own arrangements (`deviceKey`). */
export const CHANGES_DOCUMENT_CLIENTS = WORKSPACE_DOCUMENT_CLIENTS.filter(client => !client.deviceKey);
export const documentClientOf = (file: string) => WORKSPACE_DOCUMENT_CLIENTS.find(client => client.document.file === file);
