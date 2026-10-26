// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DerivedManifestNotice, WorkspaceGate } from './WorkspaceSetup.js';
import type { WorkspaceConfig } from '../lib/types.js';
import { History, Sparkles } from 'lucide-react';
import { type SignInIntro, WebFeaturesProvider } from '../lib/web-features.js';

vi.mock('./AuthControls.js', () => ({ AuthControls: () => createElement('a', { href: '/api/auth/github' }, 'Sign in with GitHub'), ConnectionState: () => createElement('p', null, 'Opening workspace') }));
vi.mock('../lib/api.js', () => ({ updateWorkspaceConfig: vi.fn(async () => ({ success: true, configRevision: 'next' })) }));

let root: Root;
let container: HTMLElement;
let requests: { url: string; init?: RequestInit; }[];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const repositories = { repositories: [{ fullName: 'visitor/notes', defaultBranch: 'main', private: true, updatedAt: '2026-10-01T00:00:00Z' }, { fullName: 'team/handbook', defaultBranch: 'trunk', private: false, updatedAt: '2026-09-01T00:00:00Z' }], total: 2, githubApp: true, installUrl: 'https://github.com/apps/my-notes/installations/new', newRepositoryUrl: 'https://github.com/new?template_owner=MyGitNotes&template_name=mygitnotes-starter' };
let available = repositories;

function serve(session: unknown) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === '/api/auth/session') return json(session);
    if (url.startsWith('/api/repositories/available')) return json(available);
    if (url.startsWith('/api/workspace/members')) return json({ members: [], changeable: true, revision: 'r', sharedAssetKeys: false, adds: 'repository' });
    if (url === '/api/workspace/choice') return JSON.parse(String(init?.body)).repository === 'team/handbook' ? json({ error: 'Branch nope does not exist in team/handbook.' }, 404) : json({ choice: { repository: 'visitor/notes', branch: 'main' } });
    throw new Error(`Unexpected request ${url}`);
  });
}
/** Lets pending fetches and the state they set settle. */
const settle = () => act(async () => new Promise(resolve => setTimeout(resolve, 0)));
async function render(element: ReturnType<typeof createElement>) {
  await act(async () => root.render(element));
  await settle();
}
const button = (text: string) => [...container.querySelectorAll('button')].find(candidate => candidate.textContent?.includes(text)) as HTMLButtonElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; }).IS_REACT_ACT_ENVIRONMENT = true;
  // The setup screens apply the theme themselves, which follows the system colour scheme.
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  requests = [];
  available = repositories;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

it('renders the app once the session is known on a deployment with one repository', async () => {
  serve({ authenticated: false, provider: 'github' });
  await render(createElement(WorkspaceGate, null, createElement('p', null, 'workspace')));
  expect(container.textContent).toBe('workspace');
});

it('asks a signed-out visitor to sign in where visitors choose their repository', async () => {
  serve({ authenticated: false, repositoryChoice: true, workspace: null });
  await render(createElement(WorkspaceGate, null, createElement('p', null, 'workspace')));
  expect(container.textContent).not.toContain('workspace');
  expect(container.querySelector('a[href="/api/auth/github"]')).not.toBeNull();
  // Visitors cannot reach Settings yet, so the screen offers the language and says what the sign-in can reach.
  expect(container.querySelector('[aria-label="Language"]')).not.toBeNull();
  expect(container.textContent).toContain('your sign-in is stored encrypted on this server');
});

it('names GitHub in the sign-in line when it is the single option', async () => {
  serve({ authenticated: false, repositoryChoice: true, workspace: null, signInOptions: [{ id: 'github' }] });
  await render(createElement(WorkspaceGate, null, createElement('p', null, 'workspace')));
  expect(container.textContent).toContain('Sign in with GitHub, then choose the repository');
});

it('uses a neutral sign-in line when several options are offered', async () => {
  serve({ authenticated: false, repositoryChoice: true, workspace: null, signInOptions: [{ id: 'github' }, { id: 'google' }] });
  await render(createElement(WorkspaceGate, null, createElement('p', null, 'workspace')));
  expect(container.textContent).toContain('Sign in, then choose where your notes live.');
  expect(container.textContent).not.toContain('Sign in with GitHub, then choose');
});

it('uses the neutral sign-in line when the single option is not GitHub', async () => {
  serve({ authenticated: false, repositoryChoice: true, workspace: null, signInOptions: [{ id: 'google' }] });
  await render(createElement(WorkspaceGate, null, createElement('p', null, 'workspace')));
  expect(container.textContent).toContain('Sign in, then choose where your notes live.');
  expect(container.textContent).not.toContain('Sign in with GitHub, then choose');
});

it('says a lightweight sign-in stays in the browser', async () => {
  serve({ authenticated: false, storage: 'cookie', repositoryChoice: true, workspace: null });
  await render(createElement(WorkspaceGate, null, createElement('p', null, 'workspace')));
  expect(container.textContent).toContain('your sign-in is kept in this browser, not on our server');
});

it('lists repositories, opens the chosen one and shows why a choice failed', async () => {
  serve({ authenticated: true, login: 'visitor', repositoryChoice: true, workspace: null });
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  await render(createElement(WorkspaceGate, null, createElement('p', null, 'workspace')));
  expect([...container.querySelectorAll('li button')].map(row => row.textContent)).toEqual([expect.stringContaining('visitor/notes'), expect.stringContaining('team/handbook')]);
  expect(container.querySelector('a[href="https://github.com/apps/my-notes/installations/new"]')).not.toBeNull();
  expect(button('Open repository').disabled).toBe(true);
  await act(async () => button('team/handbook').click());
  expect(container.querySelector<HTMLInputElement>('input[placeholder="trunk"]')).not.toBeNull();
  await act(async () => button('Open repository').click());
  await settle();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Branch nope does not exist in team/handbook.');
  await act(async () => button('visitor/notes').click());
  await act(async () => button('Open repository').click());
  await settle();
  expect(JSON.parse(String(requests.filter(request => request.url === '/api/workspace/choice').at(-1)!.init!.body))).toEqual({ repository: 'visitor/notes' });
  expect(assign).toHaveBeenCalledWith('/');
  vi.unstubAllGlobals();
});

it('commits the derived manifest and reloads the workspace', async () => {
  const { updateWorkspaceConfig } = await import('../lib/api.js');
  const onCreated = vi.fn(async () => {});
  const config: WorkspaceConfig = { schema_version: 3, workspace: { title: 'notes', default_notebook: 'journal' }, notebooks: [{ id: 'journal', title: 'journal', root: 'journal' }] };
  await render(createElement(DerivedManifestNotice, { repository: 'github:visitor/notes@main', config, configRevision: 'abc', canWrite: true, onCreated }));
  await act(async () => button('Create manifest').click());
  await settle();
  expect(updateWorkspaceConfig).toHaveBeenCalledWith('github:visitor/notes@main', expect.stringContaining('default_notebook: journal'), 'abc');
  expect(onCreated).toHaveBeenCalled();
});

it('walks a visitor through creating a repository on GitHub and selects it when they return', async () => {
  serve({ authenticated: true, login: 'visitor', repositoryChoice: true, workspace: null });
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  await render(createElement(WorkspaceGate, null, createElement('p', null, 'workspace')));
  await act(async () => button('Create a new notes repository').click());
  await settle();
  expect(open).toHaveBeenCalledWith(repositories.newRepositoryUrl, '_blank', 'noopener');
  expect(container.textContent).toContain('Finish on GitHub');
  expect(container.querySelector('section a[href="https://github.com/apps/my-notes/installations/new"]')).not.toBeNull();
  // Back from GitHub before the repository exists: nothing new to select yet.
  await act(async () => window.dispatchEvent(new Event('focus')));
  await settle();
  expect(container.querySelector('[aria-pressed="true"]')).toBeNull();
  available = { ...repositories, repositories: [{ fullName: 'visitor/my-notes', defaultBranch: 'main', private: true, updatedAt: '2026-10-07T00:00:00Z' }, ...repositories.repositories], total: 3 };
  await act(async () => window.dispatchEvent(new Event('focus')));
  await settle();
  expect(button('visitor/my-notes').getAttribute('aria-pressed')).toBe('true');
  expect(container.textContent).not.toContain('Finish on GitHub');
});

it('opens the add flow for a signed-in person whose account keeps no repository yet, never the repository choice', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === '/api/auth/session') return json({ authenticated: true, login: 'octo', repositoryChoice: true, accountMembers: true, workspace: null });
    if (url === '/api/workspace/members' && !init?.method) return json({ members: [], changeable: true, revision: 'r0', sharedAssetKeys: false, adds: 'repository', limit: { visible: 0, max: 2, plan: 'Free' } });
    if (url === '/api/workspace/members') return json({ revision: 'r1' });
    if (url.startsWith('/api/repositories/available')) return json(available);
    throw new Error(`Unexpected request ${url}`);
  });
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  await render(createElement(WorkspaceGate, null, createElement('p', null, 'workspace')));
  expect(container.textContent).toContain('Add your first repository');
  expect(container.querySelector('[data-members-limit]')?.textContent).toContain('0 of 2 visible repositories on Free');
  await act(async () => button('team/handbook').click());
  await act(async () => button('Add repository').click());
  await settle();
  expect(JSON.parse(String(requests.find(request => request.url === '/api/workspace/members' && request.init?.method === 'POST')!.init!.body))).toEqual({ repository: 'team/handbook', revision: 'r0' });
  expect(assign).toHaveBeenCalledWith('/');
  expect(requests.some(request => request.url.startsWith('/api/workspace/choice'))).toBe(false);
  vi.unstubAllGlobals();
});

it("offers a person with no platform credential only the edition's options and notice on the first-run screen", async () => {
  const requested: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input);
    requested.push(url);
    if (url === '/api/auth/session') return json({ authenticated: true, login: 'octo', platformAccess: false, repositoryChoice: true, accountMembers: true, workspace: null });
    if (url === '/api/workspace/members') return json({ members: [], changeable: true, revision: 'r0', sharedAssetKeys: false, adds: 'repository' });
    throw new Error(`Unexpected request ${url}`);
  });
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  const features = [{ id: 'edition', repositoryAdd: { options: ({ revision, onAdded }: { revision: string; onAdded: () => void; }) => createElement('button', { type: 'button', 'data-revision': revision, onClick: onAdded }, 'Start a hosted repository'), noPlatformNotice: () => createElement('p', null, 'This account signs in without GitHub.') } }];
  await render(createElement(WebFeaturesProvider, { features }, createElement(WorkspaceGate, null, createElement('p', null, 'workspace'))));
  expect(container.textContent).toContain('Add your first repository');
  expect(container.textContent).toContain('This account signs in without GitHub.');
  expect(button('Start a hosted repository').dataset.revision).toBe('r0');
  expect(container.querySelector('input')).toBeNull();
  expect(container.textContent).not.toContain('Add repository');
  expect(requested.some(url => url.startsWith('/api/repositories/available'))).toBe(false);
  await act(async () => button('Start a hosted repository').click());
  expect(assign).toHaveBeenCalledWith('/');
  vi.unstubAllGlobals();
});

it('describes the first repository neutrally for a person without a platform account', async () => {
  serve({ authenticated: true, login: 'visitor', repositoryChoice: true, workspace: null, accountMembers: true, platformAccess: false });
  await render(createElement(WorkspaceGate, null, createElement('p', null, 'workspace')));
  expect(container.textContent).toContain('Add a repository to get started.');
  expect(container.textContent).not.toContain('Pick a repository you can push to');
});

it('keeps the push-access description for a person with a platform account', async () => {
  serve({ authenticated: true, login: 'visitor', repositoryChoice: true, workspace: null, accountMembers: true });
  await render(createElement(WorkspaceGate, null, createElement('p', null, 'workspace')));
  expect(container.textContent).toContain('Pick a repository you can push to');
});

it('forgets which repositories the session opened when a visitor signs out of the repository choice', async () => {
  localStorage.setItem('gh_notes_opened_scopes', JSON.stringify(['visitor/notes:main']));
  const reload = vi.fn();
  vi.stubGlobal('location', { reload, assign: vi.fn() });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === '/api/auth/session') return json({ authenticated: true, login: 'visitor', repositoryChoice: true, workspace: null });
    if (url.startsWith('/api/repositories/available')) return json(available);
    if (url === '/api/auth/logout') return json({});
    throw new Error(`Unexpected request ${url}`);
  });
  await render(createElement(WebFeaturesProvider, { features: [] }, createElement(WorkspaceGate, null, createElement('p', null, 'app'))));
  await act(async () => button('Sign out')?.click());
  await settle();
  expect(requests.some(request => request.url === '/api/auth/logout')).toBe(true);
  expect(localStorage.getItem('gh_notes_opened_scopes')).toBeNull();
  expect(reload).toHaveBeenCalled();
  vi.unstubAllGlobals();
});

const intro: SignInIntro = { tagline: 'Notes with a memory', description: 'The first time you sign in, you get a notebook of your own.', points: [{ icon: History, text: 'Every version you commit is kept.' }, { icon: Sparkles, text: 'Connect the AI assistant you already use.' }], signInDescription: 'Sign in with Google or GitHub. Nothing else to set up.', privacy: 'Your sign-in is stored encrypted on our server.' };

it("shows the community's own words on the sign-in screen when no feature supplies an intro", async () => {
  serve({ authenticated: false, repositoryChoice: true, workspace: null, signInOptions: [{ id: 'github' }, { id: 'google' }] });
  await render(createElement(WebFeaturesProvider, { features: [{ id: 'plain' }] }, createElement(WorkspaceGate, null, createElement('p', null, 'workspace'))));
  expect(container.textContent).toContain('Git-Native Workspace');
  expect(container.textContent).toContain('Markdown notes, outlines and flashcards that live in your own GitHub repository');
  expect(container.textContent).toContain('Your repository stays the only copy');
  expect(container.textContent).toContain('Sign in, then choose where your notes live.');
  expect(container.textContent).toContain('MyGitNotes only reaches the repositories you grant to its GitHub App');
});

it("replaces the left panel's tagline, description and points, and the right panel's two lines, with a feature's intro", async () => {
  serve({ authenticated: false, repositoryChoice: true, workspace: null, signInOptions: [{ id: 'github' }, { id: 'google' }] });
  await render(createElement(WebFeaturesProvider, { features: [{ id: 'pro', signInIntro: () => intro }] }, createElement(WorkspaceGate, null, createElement('p', null, 'workspace'))));
  expect(container.querySelector('h1 + p')?.textContent).toBe('Notes with a memory');
  expect(container.textContent).toContain('The first time you sign in, you get a notebook of your own.');
  expect([...container.querySelectorAll('section ul li')].map(item => item.textContent)).toEqual(['Every version you commit is kept.', 'Connect the AI assistant you already use.']);
  expect(container.querySelectorAll('section ul li svg')).toHaveLength(2);
  expect(container.textContent).toContain('Sign in with Google or GitHub. Nothing else to set up.');
  expect(container.textContent).toContain('Your sign-in is stored encrypted on our server.');
  for (const replaced of ['Git-Native Workspace', 'Markdown notes, outlines', 'Your repository stays the only copy', 'Sign in, then choose where', 'only reaches the repositories you grant']) expect(container.textContent).not.toContain(replaced);
});

it('keeps the community lines for the right panel when the intro words only the left', async () => {
  serve({ authenticated: false, storage: 'cookie', repositoryChoice: true, workspace: null, signInOptions: [{ id: 'github' }] });
  const { signInDescription: _description, privacy: _privacy, ...leftOnly } = intro;
  await render(createElement(WebFeaturesProvider, { features: [{ id: 'pro', signInIntro: () => leftOnly }] }, createElement(WorkspaceGate, null, createElement('p', null, 'workspace'))));
  expect(container.textContent).toContain('Notes with a memory');
  expect(container.textContent).toContain('Sign in with GitHub, then choose the repository that holds your notes.');
  expect(container.textContent).toContain('your sign-in is kept in this browser, not on our server');
});

it('lets the last feature that sets an intro win, and shows it on the other setup screens too', async () => {
  serve({ authenticated: true, login: 'visitor', repositoryChoice: true, workspace: null });
  const other: SignInIntro = { ...intro, tagline: 'Another tagline' };
  await render(createElement(WebFeaturesProvider, { features: [{ id: 'a', signInIntro: () => intro }, { id: 'b', signInIntro: () => other }, { id: 'c' }] }, createElement(WorkspaceGate, null, createElement('p', null, 'workspace'))));
  expect(container.textContent).toContain('Choose a repository');
  expect(container.textContent).toContain('Another tagline');
  expect(container.textContent).not.toContain('Notes with a memory');
});
