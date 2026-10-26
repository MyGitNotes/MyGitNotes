// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../lib/i18n/index.js';
import { syncGitWorkspace } from '../lib/api.js';
import { ChangesTool } from './ChangesTool.js';
import type { GitStatus } from '../lib/types.js';
vi.mock('../lib/api.js', () => ({ fetchFileChanges: vi.fn(async () => []), fetchFileDiff: vi.fn(), syncGitWorkspace: vi.fn(), GitSyncError: class extends Error {} }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const tracking: GitStatus = { branch: 'main', isClean: false, staged: [], modified: ['notes/a.md'], untracked: [], upstream: 'origin/main', ahead: 0, behind: 1 };
const mount = (onSynced?: () => void, gitStatus: GitStatus | null = tracking) =>
  render(
    <I18nProvider>
      <ChangesTool writable gitStatus={gitStatus} deletedNotes={[]} onRestoreNote={() => {}} onOpenCommitModal={() => {}} onSynced={onSynced} repoRoot='/repo' />
    </I18nProvider>,
  );
describe('Pulling from the Changes rail', () => {
  it('pulls main without pushing, even with uncommitted changes, and refreshes when commits arrived', async () => {
    vi.mocked(syncGitWorkspace).mockResolvedValue({ pulled: 2, pushed: 0 } as never);
    const onSynced = vi.fn();
    mount(onSynced);
    fireEvent.click(screen.getByRole('button', { name: 'Pull main from its upstream' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Pulled 2 commits.');
    expect(syncGitWorkspace).toHaveBeenCalledWith(undefined, undefined, true);
    expect(onSynced).toHaveBeenCalledOnce();
  });
  it('is offered only where the workspace syncs with Git, while the credit link always shows', () => {
    mount();
    expect(screen.queryByRole('button', { name: 'Pull main from its upstream' })).toBeNull();
    expect(screen.getByRole('link', { name: /powered by MyGitNotes/ })).toHaveAttribute('href', 'https://github.com/MyGitNotes/MyGitNotes');
  });
  it('waits for an upstream branch, as syncing does', () => {
    mount(vi.fn(), null);
    expect(screen.getByRole('button', { name: 'Pull main from its upstream' })).toBeDisabled();
  });
});
