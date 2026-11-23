import { Tooltip } from './Tooltip.js';
import { useState } from 'react';
import { Pencil, Plus, TextCursorInput, Trash2 } from 'lucide-react';
import { safeFileName } from '@mygitnotes/core/note-template';
import { Button } from './Button.js';
import { LoadingStatus } from './LoadingStatus.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import { useTranslation } from '../lib/i18n/index.js';
import type { NoteTemplateInfo } from '../lib/note-templates.js';
import './manage-templates.css';

interface ManageTemplatesDialogProps {
  /** The notebook whose templates are managed, as the dialog's title names it. */
  notebookTitle: string;
  templates: NoteTemplateInfo[];
  /** The templates the app ships, listed read-only after the notebook's own. */
  builtin: { id: string; title: string; }[];
  loading: boolean;
  error: string;
  /** A read-only notebook lists its templates without actions. */
  readOnly: boolean;
  /** Whether a template file may be renamed or deleted; a demo notebook edits in this browser but changes no file. */
  fileActions?: boolean;
  /** Each action throws the reason it was refused, which the dialog shows; opening a template closes the dialog, since the template opens in zoom. */
  onCreate: (name: string) => Promise<void>;
  onEdit: (template: NoteTemplateInfo) => Promise<void>;
  onRename: (template: NoteTemplateInfo, name: string) => Promise<void>;
  onDelete: (template: NoteTemplateInfo) => Promise<void>;
  onClose: () => void;
}

type Pending = { kind: 'create'; } | { kind: 'rename' | 'delete'; template: NoteTemplateInfo; };

/** The file name a template named `name` is kept in, or an empty text when the name leaves none. */
const fileNameOf = (name: string) => safeFileName(name) && `${safeFileName(name)}.md`;

/**
 * A notebook's note templates: each with its name, description and file. A template found in `.templates/` is edited (in
 * zoom, as a note), renamed and deleted here; one the manifest registers is only edited, since `.mygitnotes.yaml` names its file.
 */
export function ManageTemplatesDialog({ notebookTitle, templates, builtin, loading, error, readOnly, fileActions = true, onCreate, onEdit, onRename, onDelete, onClose }: ManageTemplatesDialogProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Pending | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const run = async (action: () => Promise<void>, closes = false) => {
    if (busy) return;
    setBusy(true);
    setFailure('');
    try {
      await action();
      setPending(null);
      if (closes) onClose();
    } catch (reason) {
      setFailure((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const start = (next: Pending, initial = '') => {
    setFailure('');
    setName(initial);
    setPending(next);
  };
  const cancel = () => {
    setFailure('');
    setPending(null);
  };
  const naming = pending?.kind === 'create' || pending?.kind === 'rename';
  const submitName = () => {
    if (!fileNameOf(name) || !pending) return;
    if (pending.kind === 'create') void run(() => onCreate(name), true);
    else if (pending.kind === 'rename') void run(() => onRename(pending.template, name));
  };
  return (
    <WorkspaceDialog title={t('templates.title', { notebook: notebookTitle })} onClose={onClose} className='manage-templates'>
      {(failure || error) && <p role='alert' className='text-sm text-danger'>{failure || error}</p>}
      {loading ? <LoadingStatus className='text-sm'>{t('templates.loading')}</LoadingStatus> : (
        <ul className='manage-templates-list' aria-label={t('templates.list')}>
          {templates.map(template => (
            <li key={template.id} className='manage-templates-item' data-source={template.source}>
              <div className='manage-templates-text'>
                <span className='manage-templates-name'>{template.name}</span>
                {template.description && <span className='manage-templates-description'>{template.description}</span>}
                <span className='manage-templates-file'>{template.file}</span>
                {template.source === 'manifest' && <span className='manage-templates-hint'>{t('templates.manifestHint')}</span>}
              </div>
              {!readOnly && (
                <div className='manage-templates-actions'>
                  <Tooltip label={t('templates.edit', { name: template.name })}>
                    <button
                      type='button'
                      className='ui-icon-button'
                      aria-label={t('templates.edit', { name: template.name })}
                      disabled={busy}
                      onClick={() => void run(() => onEdit(template), true)}
                    >
                      <Pencil aria-hidden='true' />
                    </button>
                  </Tooltip>
                  {template.source === 'file' && fileActions && (
                    <>
                      <Tooltip label={t('templates.rename', { name: template.name })}>
                        <button
                          type='button'
                          className='ui-icon-button'
                          aria-label={t('templates.rename', { name: template.name })}
                          disabled={busy}
                          onClick={() => start({ kind: 'rename', template }, template.id)}
                        >
                          <TextCursorInput aria-hidden='true' />
                        </button>
                      </Tooltip>
                      <Tooltip label={t('templates.delete', { name: template.name })}>
                        <button
                          type='button'
                          className='ui-icon-button'
                          aria-label={t('templates.delete', { name: template.name })}
                          disabled={busy}
                          onClick={() => start({ kind: 'delete', template })}
                        >
                          <Trash2 aria-hidden='true' />
                        </button>
                      </Tooltip>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
          {builtin.map(template => (
            <li key={template.id} className='manage-templates-item' data-source='builtin'>
              <div className='manage-templates-text'>
                <span className='manage-templates-name'>{template.title}</span>
                <span className='manage-templates-hint'>{t('templates.builtinHint')}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {!loading && templates.length === 0 && <p className='text-sm text-muted'>{t('templates.empty')}</p>}
      {naming && (
        <form
          className='screen-form'
          onSubmit={event => {
            event.preventDefault();
            submitName();
          }}
        >
          <label>
            {t(pending.kind === 'create' ? 'templates.newLabel' : 'templates.renameLabel')}
            <input
              className='ui-control'
              aria-label={t(pending.kind === 'create' ? 'templates.newLabel' : 'templates.renameLabel')}
              value={name}
              maxLength={100}
              onChange={event => setName(event.target.value)}
              autoFocus
            />
          </label>
          <p className='text-xs text-muted font-mono break-all'>{fileNameOf(name) ? t('templates.file', { file: `.templates/${fileNameOf(name)}` }) : t('templates.nameInvalid')}</p>
          <div className='workspace-dialog-actions'>
            <Button type='button' onClick={cancel} disabled={busy}>{t('common.cancel')}</Button>
            <Button type='submit' variant='primary' disabled={busy || !fileNameOf(name)}>{t(pending.kind === 'create' ? 'templates.create' : 'files.rename')}</Button>
          </div>
        </form>
      )}
      {pending?.kind === 'delete' && (
        <div className='screen-form' role='alertdialog' aria-label={t('templates.deleteConfirm', { name: pending.template.name })}>
          <p className='text-sm'>{t('templates.deleteConfirm', { name: pending.template.name })}</p>
          <div className='workspace-dialog-actions'>
            <Button type='button' onClick={cancel} disabled={busy}>{t('common.cancel')}</Button>
            <Button type='button' variant='danger' disabled={busy} onClick={() => void run(() => onDelete(pending.template))}>{t('common.delete')}</Button>
          </div>
        </div>
      )}
      {!readOnly && !pending && !loading && (
        <div className='workspace-dialog-actions'>
          <Button type='button' variant='primary' onClick={() => start({ kind: 'create' })}>
            <Plus size={14} aria-hidden='true' />
            <span>{t('templates.new')}</span>
          </Button>
        </div>
      )}
    </WorkspaceDialog>
  );
}
