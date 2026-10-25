import { CoreUpdates } from './CoreUpdates.js';
import { ProductVersion } from './ProductVersion.js';
import { useWorkspaceSidebarDrawer, WorkspaceSidebar, WorkspaceSidebarPortal, WorkspaceSidebarToggle } from './WorkspaceChrome.js';
import React from 'react';
import { AlertCircle, Check, FolderGit2, Globe, History, Info, Keyboard, type LucideIcon, Palette, RefreshCw, Save, Shield } from 'lucide-react';
import { Select } from './Select.js';
import { useVersionNumbering, type VersionNumbering, writeVersionNumbering } from '../lib/version-display.js';
import { useVimMode, writeVimMode } from '../lib/vim-mode.js';
import { formatKeys } from '../lib/keyboard/keys.js';
import { bindingsFor, keymapEntry } from '../lib/keyboard/keymap.js';
import { keyEnvironment } from '../lib/keyboard/platform.js';
import { ThemeChoice } from '../lib/themes.js';
import { ThemeSelector } from './ThemeSelector.js';
import { ManifestSettings, type ManifestSettingsProps } from './ManifestSettings.js';
import { RepositoriesSettings, type RepositoriesSettingsProps } from './RepositoriesSettings.js';
import { type TranslationKey, useTranslation } from '../lib/i18n/index.js';
import { useDemo } from '../lib/demo.js';
import { type FeatureSettingsSection, SETTINGS_GROUPS, type SettingsGroup, useSettingsSections } from '../lib/web-features.js';

interface SettingsModalProps {
  local?: boolean;
  /** Each repository's manifest, the editor opening on the current notebook's repository. */
  manifest: Omit<ManifestSettingsProps, 'onRefreshWorkspace'>;
  /** Settings → Repositories: the workspace's members. */
  repositories?: RepositoriesSettingsProps;
  /** No repository shows notes: every one is hidden or unavailable, so Settings is where the person recovers (decision C8). */
  recovery?: boolean;
  /** Settings → MCP access: the controls for the deployment's agent grants. */
  accountSettings?: React.ReactNode;
  /** Settings → Repositories, above the list: the repository a visitor chose and the way back to the picker. */
  repositoryChoice?: React.ReactNode;
  /** Core updates concern a deployment's own repository; a repository a visitor imported has none to update. */
  coreUpdates?: boolean;
  onRefreshWorkspace: () => Promise<void>;
  currentTheme: ThemeChoice;
  onSelectTheme: (theme: ThemeChoice) => void;
}

/** One Settings section as the page and its sidebar show it. */
interface SettingsEntry {
  id: string;
  group: SettingsGroup;
  title: React.ReactNode;
  icon: LucideIcon;
  element: React.ReactNode;
}

const groupTitleKeys = { account: 'settings.groupAccount', repositories: 'settings.groupRepositories', connections: 'settings.groupConnections', preferences: 'settings.groupPreferences', advanced: 'settings.groupAdvanced' } as const satisfies Record<SettingsGroup, TranslationKey>;

export const SettingsModal: React.FC<SettingsModalProps> = ({ manifest, repositories, recovery = false, local = true, accountSettings, repositoryChoice, coreUpdates = true, onRefreshWorkspace, currentTheme, onSelectTheme }) => {
  const { t, language, setLanguage } = useTranslation();
  const sidebar = useWorkspaceSidebarDrawer();
  const demo = useDemo();
  const editionSections = useSettingsSections();
  // A demo visitor has nothing to configure but how the app looks and edits.
  const featureSections = demo ? [] : editionSections;
  const versionNumbering = useVersionNumbering();
  const vimMode = useVimMode();
  const helpKeys = bindingsFor(keymapEntry('help.open'), keyEnvironment).map(keys => formatKeys(keys, keyEnvironment).join(' ')).join(' / ');
  const entry = (id: string, group: SettingsGroup, title: React.ReactNode, icon: LucideIcon, element: React.ReactNode): SettingsEntry => ({ id, group, title, icon, element });
  const communityEntries: SettingsEntry[] = [
    ...(repositories ? [entry('repositories', 'repositories', t('repositories.title'), FolderGit2, <RepositoriesSettings {...repositories} repositoryChoice={repositoryChoice} />)] : []),
    entry('access', 'connections', t('layout.access'), Shield, <div id='settings-access'>{accountSettings}</div>),
    entry(
      'language',
      'preferences',
      t('settings.language'),
      Globe,
      <div id='settings-language' className='flex flex-col gap-3'>
        <div>
          <h3 className='text-xs font-semibold text-fg uppercase tracking-wider flex items-center gap-1.5'>
            <Globe className='w-4 h-4 text-primary' />
            {t('settings.language')}
          </h3>
          <p className='text-xs text-muted mt-0.5'>{t('settings.languageDescription')}</p>
        </div>
        <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
          <button type='button' onClick={() => setLanguage('en')} aria-pressed={language === 'en'} className={`flex items-center justify-between p-4 rounded-xl border text-left transition-all ${language === 'en' ? 'border-primary bg-primary-soft/40 shadow-xs' : 'border-line-strong hover:border-muted bg-surface'}`}>
            <div className='flex items-center gap-3'>
              <span className='text-2xl' role='img' aria-label={t('settings.english')}>🇺🇸</span>
              <div>
                <div className='font-semibold text-sm text-fg'>English</div>
                <div className='text-xs text-muted'>{t('settings.defaultLanguage')}</div>
              </div>
            </div>
            {language === 'en' && (
              <span className='w-5 h-5 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-xs'>
                <Check className='w-3 h-3' />
              </span>
            )}
          </button>
          <button type='button' onClick={() => setLanguage('zh-TW')} aria-pressed={language === 'zh-TW'} className={`flex items-center justify-between p-4 rounded-xl border text-left transition-all ${language === 'zh-TW' ? 'border-primary bg-primary-soft/40 shadow-xs' : 'border-line-strong hover:border-muted bg-surface'}`}>
            <div className='flex items-center gap-3'>
              <span className='text-2xl' role='img' aria-label={t('settings.traditionalChinese')}>🇹🇼</span>
              <div>
                <div className='font-semibold text-sm text-fg'>繁體中文</div>
                <div className='text-xs text-muted'>{t('settings.traditionalChinese')}</div>
              </div>
            </div>
            {language === 'zh-TW' && (
              <span className='w-5 h-5 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-xs'>
                <Check className='w-3 h-3' />
              </span>
            )}
          </button>
        </div>
      </div>,
    ),
    entry(
      'theme',
      'preferences',
      t('settings.theme'),
      Palette,
      <div id='settings-theme' className='flex flex-col gap-3'>
        <div className='flex items-center justify-between'>
          <div>
            <h3 className='text-xs font-semibold text-fg uppercase tracking-wider flex items-center gap-1.5'>
              <Palette className='w-4 h-4 text-primary' />
              {t('settings.theme')}
            </h3>
            <p className='text-xs text-muted mt-0.5'>{t('settings.themeDescription')}</p>
          </div>
        </div>
        <ThemeSelector value={currentTheme} onChange={onSelectTheme} />
      </div>,
    ),
    entry(
      'versions',
      'preferences',
      t('settings.versionNumbers'),
      History,
      <div id='settings-versions' className='flex flex-col gap-3'>
        <div>
          <h3 className='text-xs font-semibold text-fg uppercase tracking-wider flex items-center gap-1.5'>
            <History className='w-4 h-4 text-primary' />
            {t('settings.versionNumbers')}
          </h3>
          <p className='text-xs text-muted mt-0.5'>{t('settings.versionNumbersDescription')}</p>
        </div>
        <Select aria-label={t('settings.versionNumbers')} value={versionNumbering} onValueChange={value => writeVersionNumbering(value as VersionNumbering)} options={[{ value: 'sequence', label: t('settings.versionBySequence') }, { value: 'date', label: t('settings.versionByDate') }]} />
      </div>,
    ),
    entry(
      'editor',
      'preferences',
      t('settings.editor'),
      Keyboard,
      <div id='settings-editor' className='flex flex-col gap-3'>
        <div>
          <h3 className='text-xs font-semibold text-fg uppercase tracking-wider flex items-center gap-1.5'>
            <Keyboard className='w-4 h-4 text-primary' />
            {t('settings.editor')}
          </h3>
          <p className='text-xs text-muted mt-0.5'>{t('settings.editorDescription')}</p>
        </div>
        <label className='flex items-start gap-2 text-xs'>
          <input type='checkbox' checked={vimMode} onChange={event => writeVimMode(event.target.checked)} />
          <span>
            <span className='font-semibold text-fg'>{t('settings.vimMode')}</span>
            <span className='block text-muted mt-0.5'>{t('settings.vimModeDescription', { keys: helpKeys })}</span>
          </span>
        </label>
      </div>,
    ),
    entry('manifest', 'advanced', t('layout.manifest'), Save, <ManifestSettings {...manifest} onRefreshWorkspace={onRefreshWorkspace} />),
    ...(coreUpdates ? [entry('updates', 'advanced', t('settings.coreUpdates'), RefreshCw, <CoreUpdates local={local} />)] : []),
  ];
  // An edition section whose id matches a shown community section takes that section's place and group; the rest follow the community sections of their group, and those without a group follow every group under a neutral Settings heading.
  const communityIds = new Set(communityEntries.map(section => section.id));
  const replacements = new Map(featureSections.filter(section => communityIds.has(section.id)).map(section => [section.id, section]));
  const added = featureSections.filter(section => !communityIds.has(section.id));
  const groups: Array<{ id: string; title: React.ReactNode; sections: SettingsEntry[]; }> = SETTINGS_GROUPS.map(group => {
    const community = communityEntries.filter(section => section.group === group).map(section => {
      const replacement = replacements.get(section.id);
      return replacement ? entry(section.id, group, replacement.title, replacement.icon, <FeatureSection section={replacement} />) : section;
    });
    const edition = added.filter(section => section.group === group).map(section => entry(section.id, group, section.title, section.icon, <FeatureSection section={section} />));
    return { id: group, title: t(groupTitleKeys[group]), sections: [...community, ...edition] };
  }).filter(({ sections }) => sections.length > 0);
  const ungrouped = added.filter(section => !SETTINGS_GROUPS.some(group => group === section.group)).map(section => entry(section.id, 'advanced', section.title, section.icon, <FeatureSection section={section} />));
  if (ungrouped.length > 0) groups.push({ id: 'other', title: t('nav.settings'), sections: ungrouped });
  if (demo) groups.splice(0, groups.length, ...groups.filter(group => group.id === 'preferences'));
  const link = (id: string, label: React.ReactNode, Icon: LucideIcon) => (
    <a
      key={id}
      href={`#settings-${id}`}
      className='sidebar-link'
      onClick={event => {
        event.preventDefault();
        sidebar.setOpen(false);
        document.getElementById(`settings-${id}`)?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      }}
    >
      <Icon aria-hidden='true' className='w-4 h-4' />
      <span>{label}</span>
    </a>
  );
  return (
    <>
      <WorkspaceSidebarPortal>
        <WorkspaceSidebar label={t('settings.title')} className='settings-sidebar'>
          {groups.map(({ id, title, sections }) => (
            <React.Fragment key={id}>
              <div className='sidebar-section-label'>{title}</div>
              {sections.map(section => link(section.id, section.title, section.icon))}
            </React.Fragment>
          ))}
        </WorkspaceSidebar>
      </WorkspaceSidebarPortal>
      <WorkspaceSidebarToggle label={t('settings.title')} open={sidebar.open} onClick={() => sidebar.setOpen(open => !open)} />
      <div className='workspace-content'>
        <div className='workspace-scroll'>
          <div className='settings-panel'>
            {recovery && (
              <p role='alert' className='p-3 rounded-lg text-xs flex items-start gap-2 bg-warning-soft text-warning border border-warning/40'>
                <AlertCircle className='w-4 h-4 shrink-0' />
                <span>{t('repositories.recovery')}</span>
              </p>
            )}
            {groups.map(({ id, title, sections }) => (
              <div key={id} role='group' aria-labelledby={`group-heading-${id}`} className='settings-group'>
                <h2 id={`group-heading-${id}`} className='settings-group-heading'>{title}</h2>
                {sections.map(section => <React.Fragment key={section.id}>{section.element}</React.Fragment>)}
                {id === 'advanced' && (
                  <div className='flex flex-col gap-3'>
                    <h3 className='text-xs font-semibold text-fg uppercase tracking-wider flex items-center gap-1.5'>
                      <Info className='w-4 h-4 text-primary' />
                      {t('settings.productVersion')}
                    </h3>
                    <ProductVersion />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

const FeatureSection: React.FC<{ section: FeatureSettingsSection; }> = ({ section }) => (
  <div id={`settings-${section.id}`} className='flex flex-col gap-3'>
    <h3 className='text-xs font-semibold text-fg uppercase tracking-wider flex items-center gap-1.5'>
      <section.icon className='w-4 h-4 text-primary' />
      {section.title}
    </h3>
    {section.element}
  </div>
);
