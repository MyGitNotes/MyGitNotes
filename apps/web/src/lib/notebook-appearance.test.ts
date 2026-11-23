import { describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { parseWorkspaceConfig } from '@mygitnotes/core';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@mygitnotes/core/workspace-preferences';
import type { WorkspaceConfig } from './types.js';
import type { WorkspaceRepository } from './workspace-repositories.js';

const updateWorkspaceConfig = vi.hoisted(() => vi.fn(async (_repository: string, _yaml: string, _revision: string) => ({ success: true, configRevision: 'next' })));
vi.mock('./api.js', async importOriginal => ({ ...await importOriginal<typeof import('./api.js')>(), updateWorkspaceConfig }));
const { appearanceEditable, manifestYaml, saveNotebookAppearance, withNotebookAppearance } = await import('./notebook-appearance.js');

const config: WorkspaceConfig = { schema_version: 4, workspace: { title: 'Games', default_notebook: 'sos' }, notebooks: [{ id: 'sos', title: 'SOS-02', root: 'notes/sos', default_view: 'list', exclude: ['x/**'], excluded: ['x/**'] }, { id: 'coc', title: 'CoC 7', root: 'notes/coc', icon: 'book', color: 'blue' }], preferences: DEFAULT_WORKSPACE_PREFERENCES };
const repository = (overrides: Partial<WorkspaceRepository> = {}): WorkspaceRepository => ({ id: 'github:me/games@main', alias: 'games', type: 'github', repository: 'me/games', branch: 'main', revision: 'a'.repeat(40), write: true, notebooks: ['games~sos', 'games~coc'], title: 'Games', defaultNotebook: 'games~sos', preferences: DEFAULT_WORKSPACE_PREFERENCES, config, configRevision: 'rev-1', ...overrides });

describe('withNotebookAppearance', () => {
  it("sets one notebook's icon and colour and leaves the rest of the manifest as it was", () => {
    const next = withNotebookAppearance(config, 'sos', { icon: 'dice-5', color: 'red' });
    expect(next.notebooks[0]).toMatchObject({ id: 'sos', icon: 'dice-5', color: 'red', exclude: ['x/**'] });
    expect(next.notebooks[1]).toEqual(config.notebooks[1]);
    expect(config.notebooks[0]).not.toHaveProperty('icon');
  });

  it('removes what the appearance leaves out, so clearing goes back to the initial', () => {
    const next = withNotebookAppearance(config, 'coc', {});
    expect(next.notebooks[1]).not.toHaveProperty('icon');
    expect(next.notebooks[1]).not.toHaveProperty('color');
    expect(withNotebookAppearance(config, 'coc', { color: 'green' }).notebooks[1]).toMatchObject({ color: 'green' });
    expect(withNotebookAppearance(config, 'coc', { color: 'green' }).notebooks[1]).not.toHaveProperty('icon');
  });

  it('refuses a notebook the manifest does not have', () => {
    expect(() => withNotebookAppearance(config, 'nope', {})).toThrow(/nope/);
  });
});

it('writes the manifest the way Settings does: without the derived excluded list, valid for the server to parse back', () => {
  const text = manifestYaml(withNotebookAppearance(config, 'sos', { icon: 'dice-5', color: 'red' }));
  expect(text).not.toContain('excluded');
  expect(YAML.parse(text).notebooks[0]).toMatchObject({ icon: 'dice-5', color: 'red' });
  expect(parseWorkspaceConfig(text).notebooks[0]).toMatchObject({ icon: 'dice-5', color: 'red' });
});

it('commits the changed manifest to the notebook’s repository with the revision it was read at', async () => {
  const revision = await saveNotebookAppearance(repository(), 'games~sos', { icon: 'dice-5', color: 'red' });
  expect(revision).toBe('next');
  const [id, yaml, sent] = updateWorkspaceConfig.mock.calls[0];
  expect(id).toBe('github:me/games@main');
  expect(sent).toBe('rev-1');
  expect(YAML.parse(yaml).notebooks.map((nb: { id: string; icon?: string; color?: string; }) => [nb.id, nb.icon, nb.color])).toEqual([['sos', 'dice-5', 'red'], ['coc', 'book', 'blue']]);
});

it('offers the appearance only where the manifest can be written: a writable, available repository that keeps its own manifest, off core', () => {
  expect(appearanceEditable(repository())).toBe(true);
  expect(appearanceEditable(undefined)).toBe(false);
  expect(appearanceEditable(repository({ write: false }))).toBe(false);
  expect(appearanceEditable(repository({ write: false, demo: true }))).toBe(false);
  expect(appearanceEditable(repository({ branch: 'core' }))).toBe(false);
  expect(appearanceEditable(repository({ manifest: 'derived' }))).toBe(false);
  expect(appearanceEditable(repository({ config: null }))).toBe(false);
  expect(appearanceEditable(repository({ configRevision: '' }))).toBe(false);
  expect(appearanceEditable(repository({ unavailable: { reason: 'invalid-manifest', message: 'bad' } }))).toBe(false);
});
