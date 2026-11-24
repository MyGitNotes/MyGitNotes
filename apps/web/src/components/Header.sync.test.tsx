// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GitSyncError, syncGitWorkspace } from '../lib/api.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { PanelProvider, usePanelContext } from '../lib/panel-context.js';
import type { GitStatus } from '../lib/types.js';
import { type SyncTarget, WorkspaceGitSyncProvider } from '../lib/workspace-git-sync.js';
import { ChangesTool } from './ChangesTool.js';
import { Header } from './Header.js';

vi.mock('../lib/api.js', async original => ({ ...await original<typeof import('../lib/api.js')>(), fetchFileChanges: vi.fn(async () => []), syncGitWorkspace: vi.fn() }));

const target = (id: string, ahead = 2, behind = 3, upstream: string | null = 'origin/main', modified: string[] = []): SyncTarget => ({ id, label: id, gitStatus: { branch: 'main', upstream, ahead, behind, staged: [], modified, untracked: [], isClean: !modified.length } });
const refreshed = vi.fn();
const sync = vi.mocked(syncGitWorkspace);
const headerButton = () => screen.getByRole('button', { name: /^\d+ to push · \d+ to pull/ });
const queryHeaderButton = () => screen.queryByRole('button', { name: /^\d+ to push · \d+ to pull/ });

function Workspace({ remote, targets, phone }: { remote: boolean; targets: SyncTarget[]; phone: boolean; }) {
  const panel = usePanelContext();
  const [statuses, setStatuses] = useState<Record<string, GitStatus | null>>({});
  const current = targets.map(repo => Object.hasOwn(statuses, repo.id) ? { ...repo, gitStatus: statuses[repo.id] } : repo);
  const onSynced = async () => {
    refreshed();
    if (sync.mock.settledResults.at(-1)?.type === 'fulfilled') setStatuses(Object.fromEntries(targets.map(repo => [repo.id, target(repo.id, 0, 0).gitStatus])));
  };
  return (
    <WorkspaceGitSyncProvider enabled={!remote} targets={current} onSynced={onSynced}>
      <Header workspaceTitle='Notes' activeTab='settings' setActiveTab={() => {}} notebooks={[]} selectedNotebookId='' onSelectNotebook={() => {}} onOpenCommands={() => {}} navOnly={phone} />
      {panel.isOpen && panel.activeTool === 'changes' && <ChangesTool writable gitStatus={current[0]?.gitStatus ?? null} deletedNotes={[]} onRestoreNote={() => {}} onOpenCommitModal={() => {}} />}
    </WorkspaceGitSyncProvider>
  );
}

function mount(targets: SyncTarget[], remote = false, phone = false) {
  const view = (updated: SyncTarget[]) => (
    <I18nProvider>
      <PanelProvider>
        <Workspace targets={updated} remote={remote} phone={phone} />
      </PanelProvider>
    </I18nProvider>
  );
  const result = render(view(targets));
  return { update: (updated: SyncTarget[]) => result.rerender(view(updated)) };
}

beforeEach(() => localStorage.setItem('github-notes:language', 'en'));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.resetAllMocks();
});

it.each([[false, target('clean', 0, 0)], [false, target('untracked', 2, 3, null)], [true, target('hosted')]] as const)('hides when remote=%s or the branch is not out of date', (remote, repo) => {
  mount([repo], remote);
  expect(queryHeaderButton()).toBeNull();
});

it('shows current counts and runs one sync, then refreshes while retaining the result in Changes', async () => {
  let finish!: (result: Awaited<ReturnType<typeof syncGitWorkspace>>) => void;
  sync.mockImplementation(() => new Promise(resolve => finish = resolve));
  const { update } = mount([target('notes', 0, 0)]);
  expect(queryHeaderButton()).toBeNull();
  update([target('notes')]);
  const button = headerButton();
  expect(button).toHaveTextContent('↑ 2 ↓ 3');
  expect(button).toHaveAttribute('data-t1-trigger');
  fireEvent.click(button);
  expect(button).toBeDisabled();
  expect(button).toHaveTextContent('Syncing…');
  const panelButton = screen.getByRole('button', { name: 'Syncing…' });
  expect(panelButton).toBeDisabled();
  fireEvent.click(panelButton);
  fireEvent.click(button);
  expect(sync).toHaveBeenCalledExactlyOnceWith(undefined, 'notes');
  finish({ upstream: 'origin/main', pushed: 2, pulled: 3 });
  expect(await screen.findByText('Pulled 3 and pushed 2 commits.')).toBeVisible();
  expect(refreshed).toHaveBeenCalledOnce();
  expect(queryHeaderButton()).toBeNull();
});

it.each(['known', 'raced'])('shows the localized dirty message for %s changes', async kind => {
  if (kind === 'raced') sync.mockRejectedValue(new GitSyncError('server error', 'DIRTY', []));
  mount([target('notes', 2, 3, undefined, kind === 'known' ? ['notes/a.md'] : [])]);
  fireEvent.click(headerButton());
  expect(await screen.findByText('Commit or restore changes before syncing.')).toBeVisible();
  expect(sync).toHaveBeenCalledTimes(kind === 'known' ? 0 : 1);
});

it('sums repositories and opens per-repo sync sections without syncing any blindly', async () => {
  mount([target('notes'), target('work', 0, 1), target('untracked', 1, 0, null)]);
  expect(headerButton()).toHaveTextContent('↑ 2 ↓ 4');
  fireEvent.click(headerButton());
  fireEvent.click(headerButton());
  expect(await screen.findByRole('region', { name: 'Sync notes' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Sync work' })).toBeVisible();
  expect(sync).not.toHaveBeenCalled();
});

it('syncs only the out-of-date repository, including from the phone bar', async () => {
  sync.mockResolvedValue({ upstream: 'origin/main', pushed: 0, pulled: 0 });
  mount([target('clean', 0, 0), target('work')], false, true);
  const button = headerButton();
  expect(button.closest('nav')).not.toBeNull();
  fireEvent.click(button);
  expect(await screen.findByText('Already up to date.')).toBeVisible();
  expect(sync).toHaveBeenCalledExactlyOnceWith(undefined, 'work');
});

it('offers conflict strategies and then manual resolution for an unresolved conflict', async () => {
  sync.mockRejectedValueOnce(new GitSyncError('conflict', 'CONFLICT', ['notes/a.md']));
  sync.mockRejectedValueOnce(new GitSyncError('unresolved', 'UNRESOLVED', ['notes/a.md']));
  mount([target('notes')]);
  fireEvent.click(headerButton());
  expect(await screen.findByRole('button', { name: 'Use remote' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Use local (discard remote)' }));
  expect(await screen.findByText(/Git could not resolve these conflicts automatically/)).toBeVisible();
  expect(sync).toHaveBeenLastCalledWith('local', 'notes');
  expect(screen.queryByRole('button', { name: 'Use remote' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Resolve myself' }));
  await waitFor(() => expect(screen.getByText(/Run git pull --rebase/)).toBeVisible());
});

it('keeps the no-upstream outcome visible if the upstream disappeared since the last status read', async () => {
  sync.mockRejectedValueOnce(new GitSyncError('no upstream', 'NO_UPSTREAM', []));
  mount([target('notes')]);
  fireEvent.click(headerButton());
  expect(await screen.findByText(/main has no upstream branch/)).toBeVisible();
  expect(refreshed).toHaveBeenCalledOnce();
});
