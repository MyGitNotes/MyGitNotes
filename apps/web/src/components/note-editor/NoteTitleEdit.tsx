import { useRef, useState } from 'react';
import { useTranslation } from '../../lib/i18n/index.js';
import { noteStem, renamedPath } from '../../lib/note-move.js';

interface NoteTitleEditProps {
  title: string;
  /** The note's path, for the file name its new title gives it. */
  path: string;
  /** No edit is accepted right now. */
  locked: boolean;
  /** Renames the note to the typed title, its file name following; absent where the note cannot be renamed, which shows the title as text. */
  onRename?: (title: string) => Promise<void> | void;
}

/** The note's title: a click edits it in place, Enter or leaving the field renames the note (title and file name together), Escape cancels. */
export function NoteTitleEdit({ title, path, locked, onRename }: NoteTitleEditProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  // The title being renamed to is shown until the rename lands and the editor reopens under the new path.
  const [pending, setPending] = useState<string | null>(null);
  const cancelled = useRef(false);
  const shown = pending ?? title;
  const label = shown || t('editor.untitled');
  if (!onRename) return <div className='note-title font-semibold text-fg text-sm truncate' title={path}>{label}</div>;
  if (draft === null) {
    return (
      <button
        type='button'
        className='note-title title-rename font-semibold text-fg text-sm'
        disabled={locked || pending !== null}
        title={`${t('files.rename')} · ${path}`}
        aria-label={t('editor.editTitle', { title: label })}
        onClick={() => {
          cancelled.current = false;
          setDraft(shown);
        }}
      >
        {label}
      </button>
    );
  }
  const next = draft.trim();
  const valid = Boolean(noteStem(next));
  const commit = (blurred: boolean) => {
    if (cancelled.current) return;
    if (next === shown || (blurred && !valid)) return setDraft(null);
    if (!valid) return;
    setDraft(null);
    setPending(next);
    void Promise.resolve(onRename(next)).finally(() => setPending(null));
  };
  return (
    <div className='note-title-edit'>
      <input
        className='note-title-input ui-control'
        data-escape-local=''
        aria-label={t('files.renameLabel')}
        value={draft}
        maxLength={100}
        autoFocus
        onFocus={event => event.target.select()}
        onChange={event => setDraft(event.target.value)}
        onBlur={() => commit(true)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            commit(false);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            cancelled.current = true;
            setDraft(null);
          }
        }}
      />
      <p className='note-title-hint' role='status' data-invalid={valid ? undefined : true}>{valid ? t('files.renameFile', { file: renamedPath(path, next).split('/').pop() ?? '' }) : t('files.renameInvalid')}</p>
    </div>
  );
}
