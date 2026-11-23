// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import YAML from 'yaml';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@mygitnotes/core/workspace-preferences';
import { ApiError } from '../lib/api.js';
import { I18nProvider } from '../lib/i18n/index.js';
import type { NotebookConfig, WorkspaceConfig } from '../lib/types.js';
import type { WorkspaceRepository } from '../lib/workspace-repositories.js';

const updateWorkspaceConfig = vi.hoisted(() => vi.fn(async (_repository: string, _yaml: string, _revision: string) => ({ success: true, configRevision: 'rev-2' })));
vi.mock('../lib/api.js', async importOriginal => ({ ...await importOriginal<typeof import('../lib/api.js')>(), updateWorkspaceConfig }));
const { useNotebookAppearance } = await import('./NotebookAppearance.js');

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});
beforeEach(() => {
  window.localStorage.setItem('github-notes:language', 'en');
  HTMLDialogElement.prototype.showModal = function(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});
afterEach(() => {
  cleanup();
  updateWorkspaceConfig.mockReset();
  updateWorkspaceConfig.mockImplementation(async () => ({ success: true, configRevision: 'rev-2' }));
});

const manifest: WorkspaceConfig = { schema_version: 4, workspace: { title: 'Games', default_notebook: 'sos' }, notebooks: [{ id: 'sos', title: 'SOS-02', root: 'notes/sos' }], preferences: DEFAULT_WORKSPACE_PREFERENCES };
const repository = (overrides: Partial<WorkspaceRepository> = {}): WorkspaceRepository => ({ id: 'github:me/games@main', alias: 'games', type: 'github', repository: 'me/games', branch: 'main', revision: 'a'.repeat(40), write: true, notebooks: ['games~sos'], title: 'Games', defaultNotebook: 'games~sos', preferences: DEFAULT_WORKSPACE_PREFERENCES, config: manifest, configRevision: 'rev-1', ...overrides });
const keyed: NotebookConfig[] = [{ id: 'games~sos', title: 'SOS-02', root: 'notes/sos' }];

function Harness({ repo, refresh, setRevision }: { repo: WorkspaceRepository; refresh: (fresh?: boolean) => Promise<void>; setRevision: (id: string, revision: string) => void; }) {
  const appearance = useNotebookAppearance({ notebooks: keyed, repositoryFor: () => repo, refreshWorkspace: refresh, setManifestRevision: setRevision });
  return (
    <>
      <button type='button' onContextMenu={event => appearance.onContextMenu(event, 'games~sos')}>SOS-02</button>
      {appearance.element}
    </>
  );
}

function setup(repo = repository()) {
  const refresh = vi.fn(async () => {});
  const setRevision = vi.fn();
  render(
    <I18nProvider>
      <Harness repo={repo} refresh={refresh} setRevision={setRevision} />
    </I18nProvider>,
  );
  return { refresh, setRevision, row: screen.getByRole('button', { name: 'SOS-02' }) };
}

it("opens 外觀… from the notebook's context menu and commits the colour to its manifest", async () => {
  const { refresh, setRevision, row } = setup();
  row.focus();
  expect(fireEvent.contextMenu(row, { clientX: 40, clientY: 60 })).toBe(false);
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Appearance…' }));
  const dialog = await screen.findByRole('dialog', { name: 'Notebook appearance' });
  fireEvent.click(within(within(dialog).getByRole('radiogroup')).getByRole('radio', { name: 'Purple' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(updateWorkspaceConfig).toHaveBeenCalledTimes(1));
  const [id, yaml, revision] = updateWorkspaceConfig.mock.calls[0];
  expect([id, revision]).toEqual(['github:me/games@main', 'rev-1']);
  expect(YAML.parse(yaml).notebooks[0]).toMatchObject({ id: 'sos', color: 'purple' });
  await waitFor(() => expect(setRevision).toHaveBeenCalledWith('github:me/games@main', 'rev-2'));
  expect(refresh).toHaveBeenCalledWith(true);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('closes after saving even if refreshing the workspace fails', async () => {
  const { refresh, row } = setup();
  refresh.mockRejectedValueOnce(new Error('offline'));
  row.focus();
  fireEvent.contextMenu(row, { clientX: 40, clientY: 60 });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Appearance…' }));
  const dialog = await screen.findByRole('dialog', { name: 'Notebook appearance' });
  fireEvent.click(within(within(dialog).getByRole('radiogroup')).getByRole('radio', { name: 'Purple' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(refresh).toHaveBeenCalledWith(true);
});

it('keeps the browser menu where the manifest cannot be written', () => {
  for (const repo of [repository({ write: false }), repository({ manifest: 'derived' }), repository({ branch: 'core' })]) {
    const { row } = setup(repo);
    expect(fireEvent.contextMenu(row)).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    cleanup();
  }
});

it('says the manifest moved and reloads it when the save meets a newer revision', async () => {
  updateWorkspaceConfig.mockRejectedValueOnce(new ApiError('conflict', 409));
  const { refresh, row } = setup();
  // A right press focuses the row first, as a browser does.
  row.focus();
  fireEvent.contextMenu(row, { clientX: 40, clientY: 60 });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Appearance…' }));
  const dialog = await screen.findByRole('dialog', { name: 'Notebook appearance' });
  fireEvent.click(within(within(dialog).getByRole('radiogroup')).getByRole('radio', { name: 'Teal' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('The manifest changed in the meantime');
  expect(refresh).toHaveBeenCalledWith(true);
});
