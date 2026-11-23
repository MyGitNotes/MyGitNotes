import './notebook-appearance.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { STATUS_COLOR_NAMES } from '@mygitnotes/core/note-status';
import { useTranslation } from '../lib/i18n/index.js';
import { searchIconNames } from '../lib/icons/icon-search.js';
import { iconKey, lucideIcon, lucideIconNames } from '../lib/icons/lucide-registry.js';
import type { NotebookAppearance } from '../lib/notebook-appearance.js';
import type { StatusColorName } from '../lib/types.js';
import { Button } from './Button.js';
import { IconGrid, type IconGridHandle } from './IconGrid.js';
import { useLucideIcons } from './LucideGlyph.js';
import { hasNotebookMark, iconFileName, type MarkedNotebook, notebookInitial, NotebookMark } from './NotebookMark.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import './icon-picker.css';

/** How many icons the grid holds; the search narrows a longer list. */
const GRID_LIMIT = 160;
/** The icons offered first, before any search: kinds of notebooks people keep. */
const SUGGESTED = ['globe', 'inbox', 'graduation-cap', 'pen-line', 'library', 'leaf', 'dice-5', 'book-open', 'star', 'heart', 'folder', 'flask-conical', 'music', 'camera', 'briefcase', 'code', 'notebook', 'lightbulb', 'calendar', 'users', 'map', 'gamepad-2', 'coffee', 'sparkles', 'brain', 'scroll', 'feather', 'newspaper'];

/** The grid's icons: with no search the notebook's own icon, the suggestions, then every icon by name; else the matches. */
function gridNames(all: readonly string[], query: string, current: string | undefined): string[] {
  if (query.trim()) return searchIconNames(all, query, GRID_LIMIT).names;
  const first = [current, ...SUGGESTED].map(name => name && lucideIcon(name)?.name).filter((name): name is string => Boolean(name));
  const seen = new Set(first.map(iconKey));
  return [...new Set(first), ...all.filter(name => !seen.has(iconKey(name)))].slice(0, GRID_LIMIT);
}

const sameIcon = (a: string | undefined, b: string | undefined) => (a ? iconKey(a) : '') === (b ? iconKey(b) : '');

export interface NotebookAppearanceDialogProps {
  notebook: MarkedNotebook;
  /** Saves the appearance chosen; a rejection keeps the dialog open with its message. */
  onSave: (appearance: NotebookAppearance) => Promise<void>;
  onClose: () => void;
}

/**
 * 「外觀…」: picks a notebook's Lucide icon (searched by its English name) and one of the eight palette colours, with
 * a live preview of its mark. Clear goes back to the initial; Done saves what is chosen and closes, and closing any
 * other way keeps the notebook as it was.
 */
export function NotebookAppearanceDialog({ notebook, onSave, onClose }: NotebookAppearanceDialogProps) {
  const { t } = useTranslation();
  const loaded = useLucideIcons();
  const [icon, setIcon] = useState(notebook.icon);
  const [color, setColor] = useState<StatusColorName | undefined>(notebook.color);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const grid = useRef<IconGridHandle>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => search.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  const names = useMemo(() => loaded ? gridNames(lucideIconNames(), query, notebook.icon) : [], [loaded, query, notebook.icon]);

  const draft: MarkedNotebook = { title: notebook.title, ...(icon ? { icon } : {}), ...(color ? { color } : {}) };
  const stored = [icon && `icon: ${icon}`, color && `color: ${color}`].filter(Boolean).join(' · ');
  const pick = (name: string) => setIcon(current => sameIcon(current, name) ? undefined : iconFileName(name));
  const done = async () => {
    if (sameIcon(icon, notebook.icon) && color === notebook.color) {
      onClose();
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({ ...(icon ? { icon } : {}), ...(color ? { color } : {}) });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSaving(false);
    }
  };

  return (
    <WorkspaceDialog title={t('notebookAppearance.title')} onClose={onClose} className='notebook-appearance-dialog'>
      <div className='notebook-appearance-preview' aria-label={t('notebookAppearance.preview')} role='img'>
        {hasNotebookMark(draft) ? <NotebookMark notebook={draft} size='rail' /> : <span className='notebook-appearance-plain'>{notebookInitial(notebook.title)}</span>}
        <span className='notebook-appearance-name'>{notebook.title}</span>
      </div>
      <input
        ref={search}
        type='search'
        className='ui-control icon-picker-search'
        aria-label={t('icon.search')}
        placeholder={t('notebookAppearance.searchPlaceholder')}
        value={query}
        onChange={event => setQuery(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' && names.length > 0) {
            event.preventDefault();
            grid.current?.focusActive();
          }
        }}
      />
      <section className='notebook-appearance-section' aria-labelledby='notebook-appearance-icons'>
        <h3 id='notebook-appearance-icons'>{t('notebookAppearance.icons')}</h3>
        {!loaded && <p className='icon-picker-note' role='status'>{t('icon.loading')}</p>}
        {loaded && names.length === 0 && <p className='icon-picker-note' role='status'>{t('icon.noMatch', { query })}</p>}
        <IconGrid key={query} ref={grid} className={`notebook-appearance-grid ${color ? `notebook-color-${color}` : ''}`} names={names} label={t('icon.list')} selected={icon ?? ''} showNames={false} onPick={pick} onLeaveUp={() => search.current?.focus()} />
        {loaded && !query.trim() && names.length > 0 && <p className='icon-picker-note'>{t('notebookAppearance.moreIcons')}</p>}
      </section>
      <section className='notebook-appearance-section'>
        <h3 id='notebook-appearance-color'>{t('notebookAppearance.color')}</h3>
        <div className='notebook-appearance-swatches' role='radiogroup' aria-labelledby='notebook-appearance-color'>
          {[undefined, ...STATUS_COLOR_NAMES].map(name => (
            <label key={name ?? 'none'} className={`notebook-swatch ${name ? `notebook-color-${name}` : ''}`} data-color={name}>
              <input
                type='radio'
                name='notebook-color'
                checked={color === name}
                onChange={() => setColor(name)}
              />
              <span className='notebook-swatch-dot' aria-hidden='true' />
              <span className='notebook-swatch-label'>{t(name ? `notebookAppearance.color.${name}` : 'notebookAppearance.noColor')}</span>
            </label>
          ))}
        </div>
      </section>
      <footer className='notebook-appearance-footer'>
        <p className='icon-picker-note'>{stored ? t('notebookAppearance.savedAs', { yaml: stored }) : t('notebookAppearance.savedAsNone')}</p>
        {error && <p role='alert' className='notebook-appearance-error'>{error}</p>}
        <div className='notebook-appearance-actions'>
          <Button
            disabled={saving}
            onClick={() => {
              setIcon(undefined);
              setColor(undefined);
            }}
          >
            {t('notebookAppearance.clear')}
          </Button>
          <Button variant='primary' disabled={saving} onClick={() => void done()}>{saving ? t('notebookAppearance.saving') : t('notebookAppearance.done')}</Button>
        </div>
      </footer>
    </WorkspaceDialog>
  );
}
