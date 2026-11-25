import { Button } from './Button.js';
import React, { useEffect } from 'react';
import { BookOpen, Bot, Image as ImageIcon, Keyboard, PanelLeft, Plus, Presentation, Settings } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import type { WorkspaceTab } from '../lib/routes.js';
import type { NotebookConfig } from '../lib/types.js';
import { Select } from './Select.js';
import { Tooltip } from './Tooltip.js';
import { ariaKeyShortcuts, formatKeys } from '../lib/keyboard/keys.js';
import { bindingsFor, keymapEntry } from '../lib/keyboard/keymap.js';
import { keyEnvironment } from '../lib/keyboard/platform.js';
import { AssistantDockToggle } from './assistant/AssistantDockToggle.js';
import { usePiAgentOffer } from '../lib/pi-agent/session.js';
import { type NewNoteActions, NewNoteMenu } from './NewNoteMenu.js';
import { HeaderGitSync } from './HeaderGitSync.js';

interface HeaderProps {
  /** Notebooks whose repository cannot serve them; the switcher marks them. */
  unavailableNotebooks?: string[];
  workspaceTitle: string;
  /** With several repositories, the switcher lists notebooks under each repository's title. */
  notebookGroups?: { label: string; notebooks: string[]; }[];
  accountControls?: React.ReactNode;
  activeTab: WorkspaceTab;
  setActiveTab: (tab: WorkspaceTab) => void;
  notebooks: NotebookConfig[];
  selectedNotebookId: string;
  onSelectNotebook: (id: string) => void;
  notebookDisabled?: boolean;
  /** The phone navigation's New Note button; absent for a read-only notebook, which then shows none. */
  onCreateNote?: () => void;
  onOpenCommands: () => void;
  navigationDisabled?: boolean;
  /** A phone's Notes page draws its own bars at the top; the header then keeps only the bottom navigation. */
  navOnly?: boolean;
  /** The Focus switcher and Layout menu, shown on the Notes page left of New. */
  focusControls?: React.ReactNode;
  /** The New button's actions, shown on the Notes page right of the Focus controls; absent for a read-only notebook, which then shows none. */
  newNote?: NewNoteActions;
  /** The Notes page's notebooks column toggle, left of the logo: open, or folded to its rail. */
  notebooksToggle?: { open: boolean; controls: string; onToggle: () => void; };
}

/** The assistant dock's button, the command palette's, and the account controls: the header's right end, and a phone's Notes drawer where there is no header. */
export function HeaderUtilities({ activeTab, setActiveTab, navigationDisabled = false, onOpenCommands, accountControls, syncControl, className = 'header-utilities' }: Pick<HeaderProps, 'activeTab' | 'setActiveTab' | 'navigationDisabled' | 'onOpenCommands' | 'accountControls'> & { className?: string; syncControl?: React.ReactNode; }) {
  const { t } = useTranslation();
  const dockOffer = usePiAgentOffer();
  // The button opens quick open on note search, the same as its chord.
  const [paletteKeys] = bindingsFor(keymapEntry('palette.notes'), keyEnvironment);
  const paletteDetail = paletteKeys && formatKeys(paletteKeys, keyEnvironment).join(' ');
  return (
    <div className={className}>
      {syncControl}
      {/* Where the assistant dock is offered, the Agents page opens from the dock's header instead, so the header shows one agent button; while the server has not yet said, the dock's own button waits disabled in its place. */}
      {dockOffer === 'none' && (
        <Tooltip label={t('nav.agent')}>
          <button type='button' disabled={navigationDisabled} className='ui-icon-button header-agent' data-header-agent='' aria-label={t('nav.agent')} aria-current={activeTab === 'agent' ? 'page' : undefined} onClick={() => setActiveTab('agent')}>
            <Bot size={17} />
          </button>
        </Tooltip>
      )}
      <AssistantDockToggle className='header-assistant' />
      <Tooltip label={t('shortcuts.open')} detail={paletteDetail}>
        <button type='button' disabled={navigationDisabled} className='ui-icon-button header-command' data-header-command='' aria-label={t('shortcuts.open')} aria-keyshortcuts={paletteKeys && ariaKeyShortcuts(paletteKeys, keyEnvironment)} onClick={onOpenCommands}>
          <Keyboard size={17} />
        </button>
      </Tooltip>
      {accountControls}
    </div>
  );
}

export function Header({ workspaceTitle, notebookGroups, unavailableNotebooks = [], accountControls, activeTab, setActiveTab, notebooks, selectedNotebookId, onSelectNotebook, notebookDisabled, onCreateNote, onOpenCommands, navigationDisabled = false, navOnly = false, focusControls, newNote, notebooksToggle }: HeaderProps) {
  const { t } = useTranslation();
  useEffect(() => {
    document.title = `${t(`nav.${activeTab}`)} · MyGitNotes`;
  }, [activeTab, t]);
  const items = [{ id: 'notes', label: t('nav.notes'), icon: BookOpen }, { id: 'boards', label: t('nav.boards'), icon: Presentation }, { id: 'assets', label: t('nav.assets'), icon: ImageIcon }, { id: 'settings', label: t('nav.settings'), icon: Settings }] as const;
  const nav = (
    <nav aria-label='Main navigation' className='header-nav'>
      {items.map(({ id, label, icon: Icon, ...item }, index) => (
        <React.Fragment key={id}>
          {index === 2 && onCreateNote && (
            <Button variant='primary' type='button' className='mobile-nav-create' aria-label={t('header.newNote')} disabled={navigationDisabled} onClick={onCreateNote}>
              <Plus aria-hidden='true' />
              <span>{t('header.newNote')}</span>
            </Button>
          )}
          <Tooltip label={label}>
            <button
              type='button'
              disabled={navigationDisabled}
              onClick={() => setActiveTab(id)}
              aria-label={label}
              className={'desktopOnly' in item && item.desktopOnly ? 'desktop-only' : undefined}
              aria-current={activeTab === id ? 'page' : undefined}
            >
              <Icon aria-hidden='true' />
              <span>{label}</span>
            </button>
          </Tooltip>
        </React.Fragment>
      ))}
      {navOnly && <HeaderGitSync disabled={navigationDisabled} />}
    </nav>
  );
  // The Notes page's own actions; every other page shows only the notebook switcher and the utilities here.
  const notes = activeTab === 'notes';
  const notebooksLabel = t(notebooksToggle?.open ? 'browse.collapseNotebooks' : 'browse.expandNotebooks');
  const [notebooksKeys] = bindingsFor(keymapEntry('browse.toggleNotebooks'), keyEnvironment);
  if (navOnly) return <header className='workspace-header' data-nav-only=''>{nav}</header>;
  return (
    <header className='workspace-header'>
      <div className='header-layout'>
        <div className='header-brand'>
          {notebooksToggle && (
            <Tooltip label={notebooksLabel} detail={notebooksKeys && formatKeys(notebooksKeys, keyEnvironment).join(' ')}>
              <button type='button' className='ui-icon-button header-notebooks-toggle' aria-label={notebooksLabel} aria-keyshortcuts={notebooksKeys && ariaKeyShortcuts(notebooksKeys, keyEnvironment)} aria-expanded={notebooksToggle.open} aria-controls={notebooksToggle.controls} onClick={notebooksToggle.onToggle}>
                <PanelLeft size={17} aria-hidden='true' />
              </button>
            </Tooltip>
          )}
          <img src={`${import.meta.env.BASE_URL}brand/github-notes-64.png`} width='32' height='32' alt='MyGitNotes' className='workspace-brand-icon' />
          <div className='min-w-0'>
            <h1>{workspaceTitle || 'MyGitNotes'}</h1>
            <p>{t('header.gitWorkspace')}</p>
          </div>
          <span id='workspace-sidebar-toggle-slot' className='sidebar-toggle-slot' />
        </div>
        {nav}
        <div className='header-account'>
          {notes && focusControls && <div className='note-focus-controls header-focus-controls' role='group' aria-label={t('focus.title')}>{focusControls}</div>}
          <div className='header-notebook'>
            <span id='workspace-sidebar-toggle-slot-mobile' className='sidebar-toggle-slot' />
            {/* The Notes page switches notebooks from its notebooks column; the other pages keep the switcher here. */}
            {!notes && notebooks.length > 0 && (
              <>
                <BookOpen aria-hidden='true' />
                <Select aria-label={t('sidebar.notebooks')} value={selectedNotebookId} tooltip={notebooks.find(nb => nb.id === selectedNotebookId)?.title} disabled={notebookDisabled || navigationDisabled} onValueChange={onSelectNotebook} groups={notebookGroups?.map(group => ({ label: group.label, values: group.notebooks }))} options={notebooks.map(nb => ({ value: nb.id, label: unavailableNotebooks.includes(nb.id) ? `${nb.title} · ${t('notebook.unavailable')}` : nb.title }))} />
              </>
            )}
          </div>
          {notes && newNote && <NewNoteMenu {...newNote} />}
          <HeaderUtilities syncControl={<HeaderGitSync disabled={navigationDisabled} />} activeTab={activeTab} setActiveTab={setActiveTab} navigationDisabled={navigationDisabled} onOpenCommands={onOpenCommands} accountControls={accountControls} />
        </div>
      </div>
    </header>
  );
}
