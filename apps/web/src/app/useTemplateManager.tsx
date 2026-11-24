import { useState } from 'react';
import { ManageTemplatesDialog } from '../components/ManageTemplatesDialog.js';
import { builtinNoteTemplates } from '../lib/builtin-templates.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import type { NotebookConfig } from '../lib/types.js';
import type { useNotebookTemplates } from '../lib/use-note-queries.js';
import type { useTemplateActions } from './useTemplateActions.js';

interface Params {
  selectedNotebook: NotebookConfig | undefined;
  notebookTemplates: ReturnType<typeof useNotebookTemplates>;
  templateActions: ReturnType<typeof useTemplateActions>;
  canWrite: boolean;
  canWriteFiles: boolean;
  t: I18nContextValue['t'];
}

/** The selected notebook's Manage templates dialog, opened from the New menu. */
export function useTemplateManager({ selectedNotebook, notebookTemplates, templateActions, canWrite, canWriteFiles, t }: Params) {
  const [manageTemplatesOpen, setManageTemplatesOpen] = useState(false);
  const dialog = manageTemplatesOpen && selectedNotebook && <ManageTemplatesDialog notebookTitle={selectedNotebook.title} templates={notebookTemplates.templates} builtin={builtinNoteTemplates(t)} loading={notebookTemplates.loading} error={notebookTemplates.error} readOnly={!canWrite} fileActions={canWriteFiles} onCreate={name => templateActions.createTemplate(selectedNotebook.id, name)} onEdit={templateActions.editTemplate} onRename={templateActions.renameTemplate} onDelete={templateActions.deleteTemplate} onClose={() => setManageTemplatesOpen(false)} />;
  return { openTemplateManager: () => setManageTemplatesOpen(true), dialog };
}
