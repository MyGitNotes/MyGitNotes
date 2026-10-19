import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, FileText, FolderCog, FolderGit2, Maximize2, MessageSquarePlus, Minimize2, Power, Send, Square, SquareTerminal, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '../Button.js';
import { LoadingStatus } from '../LoadingStatus.js';
import { WorkspaceDialog } from '../WorkspaceDialog.js';
import { Select } from '../Select.js';
import { AgentDialogCard } from './AgentDialogCard.js';
import { InfoDrawer, InfoToggles, useInfoSection } from './AgentInfo.js';
import { AgentTranscript, type ChatLinks } from './AgentTranscript.js';
import { CommandMenu } from './CommandMenu.js';
import { BUILTIN_COMMANDS, matchCommands, parseComposerInput, type PiCommand, slashQuery } from '../../lib/pi-agent/commands.js';
import { type PiContextUsage, type PiEditorText, type PiLocation, type PiSessionInfo, usePiAgent } from '../../lib/pi-agent/session.js';
import { sameWorkspace, workspaceKey, workspaceName } from '../../lib/agent-workspaces.js';
import { useAgentInputFocusRequest } from '../../lib/pi-agent/input-focus.js';
import { type AgentFocus, focusLabel, selectionPosition } from '../../lib/pi-agent/transcript.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { FEATURE_IDS, useAgentModelSetup, useFeatureGate } from '../../lib/web-features.js';
import './pi-agent.css';

type ContextMode = 'line' | 'path' | 'none';
const CONTEXT_MODES: readonly ContextMode[] = ['line', 'path', 'none'];
const CONTEXT_KEY = 'mygitnotes.piAgent.context';
const noSelection = { from: 0, to: 0 };
const noCaret = { subscribe: () => () => {}, get: () => noSelection };

function savedContextMode(): ContextMode {
  try {
    const saved = localStorage.getItem(CONTEXT_KEY);
    return CONTEXT_MODES.includes(saved as ContextMode) ? saved as ContextMode : 'line';
  } catch {
    return 'line';
  }
}

/** Restarts Pi in another agent workspace after the user confirms that the conversation ends with it. */
function SwitchWorkspace({ onDone }: { onDone: () => void; }) {
  const { t } = useTranslation();
  const agent = usePiAgent();
  const { loadWorkspaces } = agent;
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<PiLocation>(agent.session?.location ?? { repository: agent.defaultRepository, folder: '' });
  // The list is read when the dialog opens, so a workspace added on the Agents page shows up.
  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);
  const name = useWorkspaceName();
  const repositories = [...new Set(agent.workspaces.map(workspace => workspace.repository))];
  const submit = async () => {
    setBusy(true);
    try {
      await agent.switchWorkspace(pick);
      onDone();
    } catch {
      /* The provider shows the error. */
    } finally {
      setBusy(false);
    }
  };
  return (
    <WorkspaceDialog title={t('piAgent.switchWorkspace')} onClose={onDone}>
      <ul className='pi-agent-workspace-list' aria-label={t('piAgent.switchWorkspace')}>
        {repositories.map(repository => (
          <li key={repository}>
            {repositories.length > 1 && <div className='pi-agent-workspace-group'>{name({ repository, folder: '' })}</div>}
            <ul className='pi-agent-workspace-list'>
              {agent.workspaces.filter(workspace => workspace.repository === repository).map(workspace => (
                <li key={workspaceKey(workspace)}>
                  <button
                    type='button'
                    className='pi-agent-workspace-option'
                    aria-pressed={sameWorkspace(workspace, pick)}
                    disabled={busy}
                    onClick={() => setPick({ repository: workspace.repository, folder: workspace.folder })}
                  >
                    <FolderGit2 aria-hidden='true' />
                    <span>{name(workspace)}</span>
                    {workspace.folder && <small title={workspace.folder}>{workspace.folder}</small>}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <p className='pi-agent-hint'>{t('piAgent.switchWarning')}</p>
      <div className='workspace-dialog-actions'>
        <Button type='button' onClick={onDone} disabled={busy}>{t('common.cancel')}</Button>
        <Button type='button' variant='danger' disabled={busy || sameWorkspace(pick, agent.session?.location)} onClick={() => void submit()}>{t('piAgent.switchConfirm')}</Button>
      </div>
    </WorkspaceDialog>
  );
}

/** How a workspace reads in the panel: the workspace title for the home root, the repository for another root, else the folder's name. */
function useWorkspaceName() {
  const agent = usePiAgent();
  return (workspace: PiLocation) => workspaceName(workspace, agent.repositories);
}

/**
 * Where links in Pi's replies resolve: the session folder in repository terms, and the repository on disk,
 * read off the session's absolute folder by dropping that relative folder from its end. Links are scoped to the
 * workspace's repository through one of its notebooks, the one holding the folder when there is one.
 */
function chatLinks(session: PiSessionInfo | null, notebooks: { id: string; root: string; }[], repositories: { id: string; notebooks: string[]; }[]): ChatLinks | undefined {
  if (!session) return undefined;
  const { folder, repository } = session.location;
  const owned = repositories.find(candidate => candidate.id === repository)?.notebooks ?? [];
  const candidates = notebooks.filter(notebook => owned.includes(notebook.id));
  const notebook = candidates.find(candidate => folder === candidate.root || folder.startsWith(`${candidate.root}/`)) ?? candidates[0];
  if (!notebook) return undefined;
  const cwd = session.cwd.replace(/\/+$/, '');
  const repositoryRoot = folder ? cwd.endsWith(`/${folder}`) ? cwd.slice(0, -folder.length - 1) : undefined : cwd;
  return repositoryRoot === undefined ? undefined : { notebookId: notebook.id, base: { folder, repositoryRoot } };
}

/** Token counts as the usage badge's tooltip reads them: 1.2k, 200k. */
const tokenCount = (tokens: number) => tokens < 1000 ? String(tokens) : `${Math.round(tokens / 100) / 10}k`.replace('.0k', 'k');

/** How full the context window is, beside the info toggles; it turns to a warning as compaction nears. */
function ContextUsage({ usage }: { usage: PiContextUsage; }) {
  const { t } = useTranslation();
  const label = t('piAgent.contextUsage', { tokens: usage.tokens === null ? '?' : tokenCount(usage.tokens), window: tokenCount(usage.contextWindow) });
  return <span className='pi-agent-badge pi-agent-usage' data-tone={usage.percent !== null && usage.percent >= 80 ? 'warning' : undefined} title={label} aria-label={label}>{usage.percent === null ? '–' : `${Math.round(usage.percent)}%`}</span>;
}

/** A file as Pi should read it: relative to the folder Pi runs in when it lies inside, absolute otherwise. */
function fromCwd(absolute: string, cwd: string | undefined): string {
  const base = cwd?.replace(/\/+$/, '');
  return base && absolute.startsWith(`${base}/`) ? absolute.slice(base.length + 1) : absolute;
}

/** The agent panel, or the reason an edition's gate gives for withholding it (an upgrade prompt, say). */
const PI_PROVIDERS_URL = 'https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md';

/** Takes the message box's place while Pi has no model it can call: the edition's guidance, else Pi's own setup. */
function ModelSetup({ onCheck }: { onCheck: () => void; }) {
  const { t } = useTranslation();
  const edition = useAgentModelSetup();
  return (
    <div className='pi-agent-idle pi-agent-model-setup' role='status'>
      {edition ?? (
        <>
          <p>{t('piAgent.noModel')}</p>
          <p>{t('piAgent.noModel.hint')}</p>
          <a href={PI_PROVIDERS_URL} target='_blank' rel='noreferrer'>{t('piAgent.noModel.docs')}</a>
        </>
      )}
      <Button onClick={onCheck}>{t('piAgent.noModel.check')}</Button>
    </div>
  );
}

/** What the assistant dock adds to the panel's header: widening the dock, the Agents page, and closing it. */
export interface AgentDockControls {
  expanded: boolean;
  /** Absent where the dock cannot widen, as on a phone, whose dock already fills the screen. */
  onToggleExpanded?: () => void;
  onClose: () => void;
  /** Opens the Agents page, whose header button the dock replaces while it is offered. */
  onOpenAgents?: () => void;
  /** The Agents page cannot be opened now, as the header's navigation cannot while a note is zoomed. */
  agentsDisabled?: boolean;
}

/** The dock's own buttons at the end of its header, shown whatever state the conversation is in. */
function DockActions({ dock }: { dock: AgentDockControls; }) {
  const { t } = useTranslation();
  return (
    <>
      {dock.onOpenAgents && (
        <Button size='icon' title={t('nav.agent')} aria-label={t('nav.agent')} disabled={dock.agentsDisabled} onClick={dock.onOpenAgents}>
          <FolderCog aria-hidden='true' />
        </Button>
      )}
      <Button size='icon' title={t('piAgent.dock.close')} aria-label={t('piAgent.dock.close')} onClick={dock.onClose}>
        <X aria-hidden='true' />
      </Button>
    </>
  );
}

export function AgentPanel({ dock }: { dock?: AgentDockControls; }) {
  const { t } = useTranslation();
  const gate = useFeatureGate(FEATURE_IDS.agent);
  if (gate.allowed) return <AgentConversation dock={dock} />;
  const reason = gate.reason ?? t('feature.unavailable');
  if (!dock) return <section className='pi-agent-panel pi-agent-gate' role='status' aria-label={t('piAgent.title')}>{reason}</section>;
  // In the dock the gate keeps a header, so the dock can still be closed and the Agents page reached.
  return (
    <section className='pi-agent-panel' aria-label={t('piAgent.title')}>
      <header className='pi-agent-header'>
        <span className='pi-agent-session-name'>{t('piAgent.title')}</span>
        <DockActions dock={dock} />
      </header>
      <div className='pi-agent-gate' role='status'>{reason}</div>
    </section>
  );
}

/** A conversation with the workspace's Pi process, naming the file in focus (see AgentTarget) with each message. */
function AgentConversation({ dock }: { dock?: AgentDockControls; }) {
  const { t } = useTranslation();
  const agent = usePiAgent();
  const target = agent.target;
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState(savedContextMode);
  const [switching, setSwitching] = useState(false);
  const [infoSection, setInfoSection] = useInfoSection();
  const [highlight, setHighlight] = useState(0);
  /** The draft the user closed the command menu on with Esc; the menu stays closed until the draft changes. */
  const [dismissed, setDismissed] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLElement>(null);
  useAgentInputFocusRequest(input);
  const menuId = useId();
  const [file, setFile] = useState<{ path: string; notebookId?: string; absolute?: string; error?: string; } | null>(null);
  const caret = target?.caret ?? noCaret;
  const selection = useSyncExternalStore(caret.subscribe, caret.get);
  const position = target?.caret && target.content ? selectionPosition(target.content(), selection, target.lineNumberOffset) : undefined;
  const { locate, loadCommands, editorText, takeEditorText, noteTools } = agent;

  // An extension (such as robot_hand) placed text in the message box for the user to review and send.
  const [shownEditorText, setShownEditorText] = useState<PiEditorText | null>(null);
  if (editorText && editorText !== shownEditorText) {
    setShownEditorText(editorText);
    setDraft(editorText.text);
  }
  useEffect(() => {
    if (!editorText) return;
    input.current?.focus();
    takeEditorText(editorText);
  }, [editorText, takeEditorText]);

  const targetPath = target?.path, targetNotebook = target?.notebookId;
  useEffect(() => {
    // Pi's note tools take the repository-relative path and notebook as they are, so there is no file to locate.
    if (targetPath === undefined || targetNotebook === undefined || noteTools) return;
    let current = true;
    // One request per note: a refusal is shown, not asked again, until another note is in focus.
    locate(targetPath, targetNotebook).then(absolute => current && setFile({ path: targetPath, notebookId: targetNotebook, absolute }), (reason: Error) => current && setFile({ path: targetPath, notebookId: targetNotebook, error: reason.message }));
    return () => {
      current = false;
    };
  }, [locate, noteTools, targetPath, targetNotebook]);

  const chooseMode = (next: ContextMode) => {
    setMode(next);
    try {
      localStorage.setItem(CONTEXT_KEY, next);
    } catch { /* The choice still applies until the panel closes. */ }
  };

  const session = agent.session;
  const model = agent.modelState;
  const currentModel = model.models.find(option => option.value === model.model);
  const links = useMemo(() => chatLinks(session, agent.notebooks, agent.repositories), [session, agent.notebooks, agent.repositories]);
  const name = useWorkspaceName();
  const live = Boolean(session && session.status !== 'exited');
  // Until a start answers there is no session, but nothing for the person to do either.
  const starting = !live && agent.starting;
  const ready = live && agent.connected;
  // The conversation and its controls appear once the session's history has; a reconnect to the same session keeps them.
  const initialized = live && agent.historyLoaded;
  // Starting Pi, or joining one that runs, shows only that it is under way: nothing yet to end, renew or write to.
  const loading = starting || (live && !initialized);
  // No session and none ended on its own: the start button wakes Pi, so this is a resting state, not a problem.
  const resting = !live && !starting && session?.status !== 'exited';
  const ended = !live && !starting && !resting;
  // Pi answered with no model at all: no key, no login and no model the edition provides.
  const noModel = ready && model.loaded === true && model.models.length === 0;
  const fileIsTarget = Boolean(target && file?.path === target.path && file.notebookId === target.notebookId);
  const absolute = fileIsTarget ? file?.absolute : undefined;
  const located = noteTools ? target?.path : absolute && fromCwd(absolute, session?.cwd);
  const noteFile = noteTools && target ? { file: located!, notebookId: target.notebookId } : { file: located! };
  // Without a caret (a compilation pane), a line request sends the path alone, and the switch says so.
  const effectiveMode: ContextMode = mode === 'line' && !position ? 'path' : mode;
  const focus: AgentFocus | undefined = !located || effectiveMode === 'none' ? undefined : effectiveMode === 'line' && position ? { ...noteFile, ...position } : noteFile;
  const builtins = useMemo<PiCommand[]>(() => BUILTIN_COMMANDS.map(name => ({ name, source: 'builtin', description: t(`piAgent.command.${name}` as const), ...(name === 'name' ? { usage: ` <${t('piAgent.command.nameArgument')}>` } : name === 'compact' ? { usage: ` [${t('piAgent.command.compactArgument')}]` } : {}) })), [t]);
  const query = ready && dismissed !== draft ? slashQuery(draft) : undefined;
  const menuOpen = query !== undefined;
  // The panel runs its built-ins itself, so a Pi command of the same name could never be reached.
  const matches = useMemo(() => query === undefined ? [] : matchCommands([...builtins, ...agent.commands.filter(command => !(BUILTIN_COMMANDS as readonly string[]).includes(command.name))], query), [query, builtins, agent.commands]);
  // Pi's commands change with /reload and installs, so the list is read afresh each time the menu opens.
  useEffect(() => {
    if (menuOpen) loadCommands();
  }, [menuOpen, loadCommands]);
  const active = Math.min(highlight, Math.max(matches.length - 1, 0));
  const shell = parseComposerInput(draft).kind === 'shell';

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    if (agent.send(text, focus)) setDraft('');
    // A built-in that is not ready to send, /name without a name, waits for its argument.
    else if (parseComposerInput(text).kind === 'builtin') setDraft(`${text} `);
  };
  // The message box grows with what is typed, from two rows to two fifths of the panel's height.
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = 'auto';
    const limit = (panel.current?.clientHeight ?? 0) * 0.4;
    element.style.height = `${limit > 0 ? Math.min(element.scrollHeight, limit) : element.scrollHeight}px`;
  }, [draft, initialized, noModel]);
  const pick = (command: PiCommand) => {
    setDraft(`/${command.name} `);
    setHighlight(0);
    input.current?.focus();
  };

  const statusLabel = t(initialized ? `piAgent.status.${session!.status}` as const : loading ? 'piAgent.status.starting' : 'piAgent.status.none');
  const chipText = focus ? focusLabel(focus) : effectiveMode === 'none' ? t('piAgent.context.noFile') : target ? target.path.slice(target.path.lastIndexOf('/') + 1) : '';

  return (
    <section ref={panel} className='pi-agent-panel' aria-label={t('piAgent.title')}>
      <header className='pi-agent-header'>
        {/* The dot's colour says the session's status; its label is the tooltip and the accessible name. */}
        <span className='pi-agent-status' role='img' aria-label={statusLabel} title={statusLabel} data-status={initialized ? session!.status : loading ? 'starting' : 'none'} />
        {/* The workspace name opens the workspace picker; its tooltip names the absolute folder Pi runs in. */}
        <button type='button' className='pi-agent-cwd' title={session?.cwd ? `${t('piAgent.switchWorkspace')}\n${session.cwd}` : t('piAgent.switchWorkspace')} aria-haspopup='dialog' aria-expanded={switching} onClick={() => setSwitching(open => !open)}>
          <span>{session ? name(session.location) : t('piAgent.switchWorkspace')}</span>
          <ChevronDown aria-hidden='true' />
        </button>
        {/* The conversation's name, which /name sets, else the title an extension gave it. */}
        <span className='pi-agent-session-name' title={initialized ? agent.transcript.name ?? agent.transcript.title : undefined}>{initialized ? agent.transcript.name ?? agent.transcript.title : undefined}</span>
        {initialized && (
          <>
            <Button size='icon' title={t('piAgent.newConversation')} aria-label={t('piAgent.newConversation')} disabled={!ready} onClick={agent.newConversation}>
              <MessageSquarePlus aria-hidden='true' />
            </Button>
            <Button size='icon' title={t('piAgent.end')} aria-label={t('piAgent.end')} onClick={() => void agent.end()}>
              <Power aria-hidden='true' />
            </Button>
            {dock?.onToggleExpanded && <Button size='icon' title={t(dock.expanded ? 'piAgent.dock.shrink' : 'piAgent.dock.expand')} aria-label={t(dock.expanded ? 'piAgent.dock.shrink' : 'piAgent.dock.expand')} onClick={dock.onToggleExpanded}>{dock.expanded ? <Minimize2 aria-hidden='true' /> : <Maximize2 aria-hidden='true' />}</Button>}
          </>
        )}
        {dock && <DockActions dock={dock} />}
      </header>
      {switching && <SwitchWorkspace onDone={() => setSwitching(false)} />}
      {agent.error && <p role='alert' className='pi-agent-error'>{agent.error}</p>}
      {loading && <LoadingStatus className='pi-agent-idle'>{t(starting ? 'piAgent.startingSession' : 'piAgent.connecting')}</LoadingStatus>}
      {(resting || ended) && (
        <div className='pi-agent-idle'>
          {/* Hiding a repository ends its session on purpose: a notice of what happened, not a failure to show output for. */}
          {resting ? <p>{t('piAgent.notStarted')}</p> : session?.endedBecause === 'repository-hidden' ? <p>{t('piAgent.endedHidden')}</p> : (
            <>
              <p>{t('piAgent.exited')}</p>
              {session?.exit?.stderr && <pre className='pi-agent-pre'>{session.exit.stderr}</pre>}
            </>
          )}
          <Button variant='primary' onClick={() => void agent.start()}>{t('piAgent.start')}</Button>
        </div>
      )}
      {/* Pi's questions scroll with the conversation, so a tall one never pushes the composer out of the panel. */}
      {initialized && <AgentTranscript transcript={agent.transcript} links={links}>{agent.transcript.dialogs.map(dialog => <AgentDialogCard key={dialog.id} dialog={dialog} onAnswer={answer => agent.answer(dialog, answer)} />)}</AgentTranscript>}
      {!initialized ? null : noModel ? <ModelSetup onCheck={agent.checkModels} /> : (
        <form
          className='pi-agent-composer'
          onSubmit={event => {
            event.preventDefault();
            send();
          }}
        >
          <div className='pi-agent-composer-card'>
            {
              /* The card's top row says what goes with each message and how Pi stands: the context chip, then Pi's trust, MCP and
                extension status with the context usage, so the bottom row keeps its room for the model and Send. */
            }
            <div className='pi-agent-context'>
              {target && (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger className='pi-agent-context-chip' aria-label={`${t('piAgent.context')}: ${chipText}`} title={absolute ?? (fileIsTarget ? file?.error : undefined)}>
                    <FileText aria-hidden='true' />
                    <span>{chipText}</span>
                    <ChevronDown aria-hidden='true' />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content className='focus-menu assistant-dock-menu' side='top' align='start' sideOffset={4} collisionPadding={8} aria-label={t('piAgent.context')} onEscapeKeyDown={event => event.stopPropagation()}>
                      <DropdownMenu.RadioGroup
                        value={effectiveMode}
                        onValueChange={value => {
                          const next = CONTEXT_MODES.find(mode => mode === value);
                          if (next) chooseMode(next);
                        }}
                      >
                        {CONTEXT_MODES.map(option => (
                          <DropdownMenu.RadioItem key={option} value={option} disabled={option === 'line' && !target.caret}>
                            <span>{t(`piAgent.context.${option}` as const)}</span>
                            <DropdownMenu.ItemIndicator className='pi-agent-context-check'>
                              <Check aria-hidden='true' />
                            </DropdownMenu.ItemIndicator>
                          </DropdownMenu.RadioItem>
                        ))}
                      </DropdownMenu.RadioGroup>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              )}
              <div className='pi-agent-indicators'>
                <InfoToggles section={infoSection} onToggle={setInfoSection} />
                {live && agent.contextUsage && <ContextUsage usage={agent.contextUsage} />}
              </div>
            </div>
            <InfoDrawer section={infoSection} onClose={() => setInfoSection(null)} />
            {(agent.transcript.queued.length > 0 || agent.held) && (
              <ul className='pi-agent-queue' aria-label={t('piAgent.queue')}>
                {agent.held && (
                  <li>
                    <span className='pi-agent-badge' title={t('piAgent.queue.heldHint')}>{t('piAgent.queue.held')}</span>
                    <span className='pi-agent-queue-text' title={agent.held}>{agent.held}</span>
                  </li>
                )}
                {agent.transcript.queued.map((message, index) => (
                  <li key={index}>
                    <span className='pi-agent-badge' title={t(message.kind === 'steer' ? 'piAgent.queue.steerHint' : 'piAgent.queue.followUpHint')}>{t(message.kind === 'steer' ? 'piAgent.queue.steer' : 'piAgent.queue.followUp')}</span>
                    <span className='pi-agent-queue-text' title={message.text}>{message.text}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className='pi-agent-input'>
              {menuOpen && <CommandMenu id={menuId} commands={matches} highlight={active} onPick={pick} />}
              <textarea
                ref={input}
                rows={2}
                value={draft}
                placeholder={t(ready ? 'piAgent.placeholder' : 'piAgent.connecting')}
                aria-label={t('piAgent.message')}
                aria-controls={menuOpen ? menuId : undefined}
                aria-activedescendant={menuOpen && matches.length ? `${menuId}-${active}` : undefined}
                aria-autocomplete='list'
                onChange={event => {
                  setDraft(event.target.value);
                  setHighlight(0);
                }}
                onKeyDown={event => {
                  if (event.nativeEvent.isComposing) return;
                  if (menuOpen && matches.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                    event.preventDefault();
                    setHighlight((active + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
                    return;
                  }
                  if (menuOpen && event.key === 'Escape') {
                    event.preventDefault();
                    setDismissed(draft);
                    return;
                  }
                  // Tab completes the highlighted command; Enter does too, unless the name is already typed out in full.
                  const chosen = menuOpen ? matches[active] : undefined;
                  if (chosen && (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && chosen.name !== query))) {
                    event.preventDefault();
                    pick(chosen);
                    return;
                  }
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
              />
            </div>
            <div className='pi-agent-dialog-actions pi-agent-composer-bar'>
              {ready && model.models.length > 0 && (
                <div className='pi-agent-model-row'>
                  {/* The button names the model alone, since a provider suffix pushes the part that tells models apart out of view; the menu and tooltip keep it. */}
                  <Select className='pi-agent-model' aria-label={t('piAgent.model')} title={currentModel ? `${t('piAgent.model')}: ${currentModel.label}` : t('piAgent.model')} icon={currentModel?.name} value={model.model ?? ''} onValueChange={agent.setModel} options={model.model && !model.models.some(option => option.value === model.model) ? [{ value: model.model, label: model.model }, ...model.models] : model.models} />
                  {model.levels.length > 1 && <Select className='pi-agent-thinking' aria-label={t('piAgent.thinkingLevel')} title={t('piAgent.thinkingLevel')} value={model.thinking ?? ''} onValueChange={agent.setThinking} options={model.levels.map(level => ({ value: level, label: level }))} />}
                </div>
              )}
              {agent.transcript.running && (
                <Button
                  size='small'
                  onClick={async () => {
                    const restored = await agent.abort();
                    if (restored) {
                      setDraft(current => current.trim() ? `${restored}\n\n${current}` : restored);
                    }
                  }}
                  title={t(agent.transcript.queued.length ? 'piAgent.abortQueued' : 'piAgent.abort')}
                >
                  <Square aria-hidden='true' />
                  {t('piAgent.abort')}
                </Button>
              )}
              <Button type='submit' variant='primary' size='small' disabled={!draft.trim()}>{shell ? <SquareTerminal aria-hidden='true' /> : <Send aria-hidden='true' />}{t(shell ? 'piAgent.run' : agent.transcript.running ? 'piAgent.steer' : 'piAgent.send')}</Button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}
