import { Monitor, Moon, Sun } from 'lucide-react';
import { EINK_FAMILY_ID, getFamily, listFamilies, resolveMode, ThemeChoice, ThemeMode } from '../lib/themes.js';
import type { PaletteFamily } from '../lib/palettes.js';
import { type TranslationKey, useTranslation } from '../lib/i18n/index.js';
import { useThemeView } from '../app/useTheme.js';
import { Button } from './Button.js';

const MODES: { mode: ThemeMode; icon: typeof Sun; }[] = [{ mode: 'light', icon: Sun }, { mode: 'dark', icon: Moon }, { mode: 'system', icon: Monitor }];

/** A family's name in the pickers; the built-in E-ink family is named in the app's language. */
export function familyLabel(family: PaletteFamily, t: (key: TranslationKey) => string): string {
  return family.id === EINK_FAMILY_ID ? t('theme.eink') : family.name;
}

export function ThemeSelector({ value, onChange }: { value: ThemeChoice; onChange: (choice: ThemeChoice) => void; }) {
  const { t } = useTranslation();
  // A detected e-reader shows E-ink for the untouched default choice; the picker marks the family the page wears.
  const { auto, familyId: shownFamily } = useThemeView();
  const shownId = auto ? shownFamily : value.familyId;
  const fixedMode = getFamily(shownId).fixedMode;
  const shown = fixedMode ?? resolveMode(value.mode);
  return (
    <div className='flex flex-col gap-2'>
      {auto && (
        <div role='status' className='flex flex-wrap items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-xs text-fg'>
          <span>{t('theme.einkAuto')}</span>
          <Button size='small' onClick={() => onChange(value)}>{t('theme.einkAutoBack')}</Button>
        </div>
      )}
      <div role='radiogroup' aria-label={t('theme.mode')} title={fixedMode ? t('theme.fixedMode') : undefined} className='inline-flex self-start rounded-md border border-line bg-sidebar p-0.5'>
        {MODES.map(({ mode, icon: Icon }) => (
          <button
            key={mode}
            type='button'
            role='radio'
            aria-checked={value.mode === mode}
            disabled={Boolean(fixedMode)}
            onClick={() => onChange({ ...value, mode })}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs ${value.mode === mode ? 'bg-surface text-fg font-semibold shadow-xs' : 'text-muted hover:text-fg'}`}
          >
            <Icon className='h-3.5 w-3.5' />
            {t(`theme.${mode}`)}
          </button>
        ))}
      </div>
      <div role='radiogroup' aria-label={t('settings.theme')} className='grid grid-cols-2 sm:grid-cols-3 gap-1'>
        {listFamilies().map(family => {
          const variant = family.variants[family.fixedMode ?? shown];
          const selected = family.id === shownId;
          return (
            <button key={family.id} type='button' role='radio' aria-checked={selected} onClick={() => onChange({ ...value, familyId: family.id })} className={`flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${selected ? 'bg-primary-soft text-fg font-semibold' : 'text-muted hover:bg-sidebar hover:text-fg'}`}>
              <span className='flex shrink-0 overflow-hidden rounded-sm border border-line' aria-hidden='true'>{[variant.background, variant.text, variant.primary, ...variant.accents.slice(0, 3)].map((color, index) => <span key={index} className='h-3.5 w-2' style={{ backgroundColor: color }} />)}</span>
              <span className='truncate'>{familyLabel(family, t)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
