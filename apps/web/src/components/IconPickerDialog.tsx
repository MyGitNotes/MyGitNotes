import { createElement, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../lib/i18n/index.js';
import { iconDirective, searchIconNames } from '../lib/icons/icon-search.js';
import { loadLucideIcons, lucideIcon, lucideIconNames, lucideIconsLoaded } from '../lib/icons/lucide-registry.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import './icon-picker.css';

/** How many icons the grid draws at once; a longer match list is narrowed by typing. */
export const ICON_GRID_LIMIT = 120;
/** The sizes offered, in pixels; none leaves the icon at the size of the text around it. */
const SIZES = ['', '16', '20', '24', '32', '48'] as const;

/** One icon drawn as an SVG from its Lucide shapes. */
function IconGlyph({ name }: { name: string; }) {
  const icon = lucideIcon(name);
  return <svg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>{icon?.children.map(([tag, attributes], index) => createElement(tag, { key: index, ...Object.fromEntries(Object.entries(attributes).filter(([key]) => key !== 'key')) }))}</svg>;
}

/**
 * A searchable grid of every Lucide icon. Picking one hands back the `:icon{name="…"}` directive, sized as chosen.
 * The search box and the grid are one tab stop each; the arrow keys move through the grid, Enter or Space picks.
 */
export function IconPickerDialog({ onPick, onClose }: { onPick: (directive: string) => void; onClose: () => void; }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>(lucideIconsLoaded() ? 'ready' : 'loading');
  const [query, setQuery] = useState('');
  const [size, setSize] = useState('');
  const [focused, setFocused] = useState(0);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
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
  const active = Math.min(focused, Math.max(result.names.length - 1, 0));

  const focusOption = (index: number) => {
    const next = Math.max(0, Math.min(index, result.names.length - 1));
    setFocused(next);
    options.current[next]?.focus();
  };
  /** How many icons share a row, read from where the browser laid the grid out. */
  const columns = () => {
    const top = options.current[0]?.offsetTop;
    const first = options.current.findIndex((option, index) => index > 0 && option?.offsetTop !== top);
    return first === -1 ? Math.max(result.names.length, 1) : first;
  };
  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    // The option holding the focus, which is where a key moves from.
    const held = options.current.indexOf(document.activeElement as HTMLButtonElement);
    const from = held === -1 ? active : held;
    const row = columns();
    if (event.key === 'Home') focusOption(0);
    else if (event.key === 'End') focusOption(result.names.length - 1);
    else if (event.key === 'ArrowRight') focusOption(from + 1);
    else if (event.key === 'ArrowLeft') focusOption(from - 1);
    else if (event.key === 'ArrowDown') focusOption(from + row);
    // Up from the first row goes back to the search box.
    else if (event.key === 'ArrowUp') {
      if (from < row) search.current?.focus();
      else focusOption(from - row);
    } else return;
    event.preventDefault();
  };

  return (
    <WorkspaceDialog title={t('icon.insert')} onClose={onClose} className='icon-picker-dialog'>
      <input
        ref={search}
        type='search'
        className='ui-control icon-picker-search'
        aria-label={t('icon.search')}
        placeholder={t('icon.searchPlaceholder')}
        value={query}
        onChange={event => {
          setQuery(event.target.value);
          setFocused(0);
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' && result.names.length > 0) {
            event.preventDefault();
            focusOption(active);
          } else if (event.key === 'Enter' && result.names.length > 0) {
            event.preventDefault();
            onPick(iconDirective(result.names[active], size));
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
      {result.names.length > 0 && (
        <div className='icon-picker-grid' role='listbox' aria-label={t('icon.list')} onKeyDown={onGridKey}>
          {result.names.map((name, index) => (
            <button
              key={name}
              ref={element => {
                options.current[index] = element;
              }}
              type='button'
              role='option'
              aria-selected={index === active}
              tabIndex={index === active ? 0 : -1}
              title={name}
              onFocus={() => setFocused(index)}
              onClick={() => onPick(iconDirective(name, size))}
            >
              <IconGlyph name={name} />
              <span>{name}</span>
            </button>
          ))}
        </div>
      )}
      {status === 'ready' && result.names.length > 0 && <p className='icon-picker-note' role='status'>{result.total > result.names.length ? t('icon.results', { shown: result.names.length, total: result.total }) : t('icon.count', { total: result.total })}</p>}
    </WorkspaceDialog>
  );
}
