import { Tooltip } from '../Tooltip.js';
import { NOTE_CONTENT_WIDTHS, NOTE_FONT_SIZES, type NoteContentWidth, useNoteViewPreferences, writeNoteViewPreferences } from '../../lib/editor-preferences.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { getFamily, listFamilies, setThemeChoice, type ThemeMode } from '../../lib/themes.js';
import { useThemeView } from '../../app/useTheme.js';
import { Select } from '../Select.js';
import { familyLabel } from '../ThemeSelector.js';

const WIDTH_LABELS = { standard: 'editor.widthStandard', wide: 'editor.widthWide', full: 'editor.widthFull' } as const;
const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system'];

/** The document panel's view section: theme and body text size everywhere, page width on desktop only. */
export function NoteViewPanel() {
  const { t } = useTranslation();
  const { fontSize, contentWidth } = useNoteViewPreferences();
  const { choice: theme, familyId: shownFamily, auto } = useThemeView();
  const fixedMode = getFamily(shownFamily).fixedMode;
  return (
    <section className='note-view-panel note-panel-scroll' aria-label={t('editor.viewSettings')}>
      <fieldset className='note-view-group'>
        <legend>{t('editor.theme')}</legend>
        <div className='note-view-theme'>
          <Select aria-label={t('settings.theme')} value={auto ? shownFamily : theme.familyId} onValueChange={familyId => setThemeChoice({ ...theme, familyId })} options={listFamilies().map(family => ({ value: family.id, label: familyLabel(family, t) }))} />
          <Select aria-label={t('theme.mode')} disabled={Boolean(fixedMode)} tooltip={fixedMode ? t('theme.fixedMode') : undefined} value={theme.mode} onValueChange={mode => setThemeChoice({ ...theme, mode: mode as ThemeMode })} options={THEME_MODES.map(mode => ({ value: mode, label: t(`theme.${mode}`) }))} />
        </div>
      </fieldset>
      <fieldset className='note-view-group'>
        <legend>{t('editor.fontSize')}</legend>
        <div className='note-view-options'>
          {NOTE_FONT_SIZES.map(size => (
            <Tooltip key={size} label={`${size}px`}>
              <button
                type='button'
                aria-pressed={fontSize === size}
                onClick={() => writeNoteViewPreferences({ fontSize: size })}
              >
                {t(`editor.fontSize${size}`)}
              </button>
            </Tooltip>
          ))}
        </div>
      </fieldset>
      <fieldset className='note-view-group note-view-width'>
        <legend>{t('editor.pageWidth')}</legend>
        <div className='note-view-options'>{(Object.keys(NOTE_CONTENT_WIDTHS) as NoteContentWidth[]).map(width => <button key={width} type='button' aria-pressed={contentWidth === width} onClick={() => writeNoteViewPreferences({ contentWidth: width })}>{t(WIDTH_LABELS[width])}</button>)}</div>
      </fieldset>
      <p className='note-view-hint'>{t('editor.viewHint')}</p>
    </section>
  );
}
