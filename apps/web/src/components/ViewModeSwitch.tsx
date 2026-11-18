import { Folder, Kanban, List } from 'lucide-react';
import { Select } from './Select.js';
import type { ViewMode } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';

const views = [{ mode: 'flat', Icon: List }, { mode: 'list', Icon: Folder }, { mode: 'kanban', Icon: Kanban }] as const;

interface ViewModeProps {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

const viewOptions = (t: ReturnType<typeof useTranslation>['t']) => [{ value: 'flat', label: t('view.flat') }, { value: 'list', label: t('layout.list') }, { value: 'kanban', label: t('layout.kanban') }];

/** The notes toolbar's view switch: three buttons, and in their place a select once the toolbar is too narrow for them. */
export function ViewModeButtons({ viewMode, setViewMode }: ViewModeProps) {
  const { t } = useTranslation();
  return (
    <>
      <Select aria-label={t('filters.noteView')} value={viewMode} onValueChange={value => setViewMode(value as ViewMode)} options={viewOptions(t)} className='mobile-only note-view-select px-1' />
      <div className='desktop-views flex items-center bg-fg/5 p-1 rounded-lg gap-1 shrink-0'>
        {views.map(({ mode, Icon }) => (
          <button
            key={mode}
            type='button'
            onClick={() => setViewMode(mode)}
            title={t(`view.${mode}`)}
            aria-label={t(`view.${mode}`)}
            aria-pressed={viewMode === mode}
            style={viewMode === mode ? { backgroundColor: 'var(--color-surface)', color: 'var(--color-primary)' } : undefined}
            className={`p-1.5 rounded-md transition ${viewMode === mode ? 'shadow-xs hover:opacity-90' : 'text-muted hover:text-fg hover:bg-fg/5'}`}
          >
            <Icon className='w-4 h-4' />
          </button>
        ))}
      </div>
    </>
  );
}

/** The left dock's view switch: one menu showing the current view's icon, in the dock's path line beside its collapse toggle, since the dock has no room for three buttons. */
export function ViewModeMenu({ viewMode, setViewMode }: ViewModeProps) {
  const { t } = useTranslation();
  const options = viewOptions(t);
  const { Icon } = views.find(view => view.mode === viewMode) ?? views[0];
  const label = `${t('filters.noteView')}: ${options.find(option => option.value === viewMode)?.label ?? viewMode}`;
  return <Select className='note-toolbar-sort note-view-menu' aria-label={label} title={label} value={viewMode} onValueChange={value => setViewMode(value as ViewMode)} options={options} icon={<Icon size={16} aria-hidden='true' />} />;
}
