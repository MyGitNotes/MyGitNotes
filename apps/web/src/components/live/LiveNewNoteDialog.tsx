import { useState } from 'react';
import { useTranslation } from '../../lib/i18n/index.js';
import type { LivePathPrompt } from '../../lib/new-note.js';
import { Button } from '../Button.js';
import { WorkspaceDialog } from '../WorkspaceDialog.js';

/**
 * Asks for the values a template's path needs before a live note is created (spec §8, Q1), prefilled with their
 * defaults. The note's first check-in files it by them; `title`, `date` and `time` come from the note itself.
 */
export function LiveNewNoteDialog({ template, prompts, onConfirm, onCancel }: { template: string; prompts: LivePathPrompt[]; onConfirm: (values: Record<string, string>) => void; onCancel: () => void; }) {
  const { t } = useTranslation();
  const [values, setValues] = useState(() => Object.fromEntries(prompts.map(prompt => [prompt.name, prompt.default])));
  const complete = prompts.every(prompt => values[prompt.name]?.trim());
  return (
    <WorkspaceDialog title={`${t('live.newTitle')} · ${template}`} onClose={onCancel}>
      <form
        className='screen-form'
        onSubmit={event => {
          event.preventDefault();
          if (complete) onConfirm(Object.fromEntries(Object.entries(values).map(([name, value]) => [name, value.trim()])));
        }}
      >
        <p className='text-xs text-muted'>{t('live.newHint')}</p>
        {prompts.map((prompt, index) => (
          <label key={prompt.name}>
            {prompt.description ?? prompt.name}
            <input
              className='ui-control'
              aria-label={prompt.description ?? prompt.name}
              value={values[prompt.name] ?? ''}
              maxLength={200}
              data-autofocus={index === 0 || undefined}
              onFocus={event => {
                // A prefilled default is selected, so typing replaces it instead of adding to it.
                if (event.currentTarget.value === prompt.default) event.currentTarget.select();
              }}
              onChange={event => setValues(current => ({ ...current, [prompt.name]: event.target.value }))}
            />
          </label>
        ))}
        <div className='workspace-dialog-actions'>
          <Button type='button' onClick={onCancel}>{t('common.cancel')}</Button>
          <Button type='submit' variant='primary' disabled={!complete}>{t('live.create')}</Button>
        </div>
      </form>
    </WorkspaceDialog>
  );
}
