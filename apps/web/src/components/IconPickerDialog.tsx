import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../lib/i18n/index.js';
import { iconDirective, searchIconNames } from '../lib/icons/icon-search.js';
import { loadLucideIcons, lucideIconNames, lucideIconsLoaded } from '../lib/icons/lucide-registry.js';
import { IconGrid, type IconGridHandle } from './IconGrid.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import './icon-picker.css';

/** How many icons the grid draws at once; a longer match list is narrowed by typing. */
export const ICON_GRID_LIMIT = 120;
/** The sizes offered, in pixels; none leaves the icon at the size of the text around it. */
const SIZES = ['', '16', '20', '24', '32', '48'] as const;

/**
 * A searchable grid of every Lucide icon. Picking one hands back the `:icon{name="…"}` directive, sized as chosen.
 * The search box and the grid are one tab stop each; the arrow keys move through the grid, Enter or Space picks.
 */
export function IconPickerDialog({ onPick, onClose }: { onPick: (directive: string) => void; onClose: () => void; }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>(lucideIconsLoaded() ? 'ready' : 'loading');
  const [query, setQuery] = useState('');
  const [size, setSize] = useState('');
  const grid = useRef<IconGridHandle>(null);
  const search = useRef<HTMLInputElement>(null);

  // The dialog opens after this mount and puts the focus on its first control, the Close button; the search box takes it.
  useEffect(() => {
    const frame = requestAnimationFrame(() => search.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    let current = true;
    loadLucideIcons().then(() => current && setStatus('ready'), () => current && setStatus('failed'));
    return () => {
      current = false;
    };
  }, []);

  const names = useMemo(() => status === 'ready' ? lucideIconNames() : [], [status]);
  const result = useMemo(() => searchIconNames(names, query, ICON_GRID_LIMIT), [names, query]);

  return (
    <WorkspaceDialog title={t('icon.insert')} onClose={onClose} className='icon-picker-dialog'>
      <input
        ref={search}
        type='search'
        className='ui-control icon-picker-search'
        aria-label={t('icon.search')}
        placeholder={t('icon.searchPlaceholder')}
        value={query}
        onChange={event => setQuery(event.target.value)}
        onKeyDown={event => {
          const active = grid.current?.activeName();
          if (event.key === 'ArrowDown' && active) {
            event.preventDefault();
            grid.current?.focusActive();
          } else if (event.key === 'Enter' && active) {
            event.preventDefault();
            onPick(iconDirective(active, size));
          }
        }}
      />
      <fieldset className='icon-picker-sizes'>
        <legend>{t('icon.size')}</legend>
        {SIZES.map(value => (
          <label key={value || 'default'}>
            <input type='radio' name='icon-size' value={value} checked={size === value} onChange={() => setSize(value)} />
            <span>{value ? `${value} px` : t('icon.size.default')}</span>
          </label>
        ))}
      </fieldset>
      {status === 'loading' && <p className='icon-picker-note' role='status'>{t('icon.loading')}</p>}
      {status === 'failed' && <p className='icon-picker-note' role='alert'>{t('icon.loadFailed')}</p>}
      {status === 'ready' && result.names.length === 0 && <p className='icon-picker-note' role='status'>{t('icon.noMatch', { query })}</p>}
      {/* Keyed by the query, so a new search starts again at its first icon. */}
      <IconGrid key={query} ref={grid} names={result.names} label={t('icon.list')} onPick={name => onPick(iconDirective(name, size))} onLeaveUp={() => search.current?.focus()} />
      {status === 'ready' && result.names.length > 0 && <p className='icon-picker-note' role='status'>{result.total > result.names.length ? t('icon.results', { shown: result.names.length, total: result.total }) : t('icon.count', { total: result.total })}</p>}
    </WorkspaceDialog>
  );
}
