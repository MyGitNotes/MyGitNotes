// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CreditCard } from 'lucide-react';
import { afterEach, expect, it, vi } from 'vitest';
import { SettingsModal } from './SettingsModal.js';
import { type FeatureSettingsSection, type SettingsGroup, type WebFeature, WebFeaturesProvider } from '../lib/web-features.js';

vi.mock('./CoreUpdates.js', () => ({ CoreUpdates: () => createElement('section', { id: 'settings-updates' }, 'Core updates body') }));
vi.mock('./ProductVersion.js', () => ({ ProductVersion: () => createElement('p', null, 'MyGitNotes v0') }));
vi.mock('./WorkspaceManifestEditor.js', () => ({ WorkspaceManifestEditor: () => null }));

const section = (id: string, group?: SettingsGroup): FeatureSettingsSection => ({ id, title: id, icon: CreditCard, element: createElement('p', null, `${id} body`), group });
const edition = (...sections: FeatureSettingsSection[]): WebFeature => ({ id: 'edition', settingsSections: sections });
// The shape Pro gives its Settings: every section tagged.
const tagged = edition(
  section('ai-providers', 'connections'),
  section('published', 'repositories'),
  section('plan', 'account'),
  section('hosted', 'repositories'),
  section('account', 'account'),
  section('storage', 'account'),
);

const communityIds = ['language', 'theme', 'versions', 'editor', 'access', 'updates', 'repositories', 'manifest'];

let root: Root | undefined;
let slot: HTMLElement | undefined;
let container: HTMLElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  slot?.remove();
  container?.remove();
  vi.restoreAllMocks();
});

async function render(features: WebFeature[], props: { coreUpdates?: boolean; repositoryChoice?: boolean; } = {}) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  slot = document.createElement('div');
  slot.id = 'workspace-sidebar-slot';
  container = document.createElement('div');
  document.body.append(slot, container);
  root = createRoot(container);
  const repositories = { repositories: [], onMembershipChanged: async () => {}, onOpenChanges: () => {} };
  await act(async () =>
    root!.render(
      createElement(
        WebFeaturesProvider,
        { features },
        createElement(SettingsModal, {
          manifest: { repositories: [], defaultRepository: '', initialRepository: '', onManifestRevision: () => {} },
          repositories,
          coreUpdates: props.coreUpdates,
          repositoryChoice: props.repositoryChoice ? createElement('section', null, 'Chosen repository') : undefined,
          accountSettings: createElement('section', null, 'MCP controls'),
          onRefreshWorkspace: async () => {},
          currentTheme: { familyId: 'flexoki', mode: 'light' },
          onSelectTheme: () => {},
        }),
      ),
    )
  );
  const items = [...slot.querySelectorAll('.settings-sidebar .workspace-sidebar-scroll > *')];
  return {
    // The sidebar as a flat list: a group label, then its links.
    sidebar: items.map(item => item.classList.contains('sidebar-section-label') ? `# ${item.textContent}` : item.getAttribute('href')!),
    headings: [...container.querySelectorAll('h2.settings-group-heading')].map(heading => heading.textContent),
    sections: [...container.querySelectorAll('[id^="settings-"]')].map(element => element.id),
    text: container.textContent ?? '',
  };
}

it('groups a tagged edition like the plan: account, repositories, AI & connections, preferences, advanced', async () => {
  const page = await render([tagged]);
  expect(page.headings).toEqual(['Account', 'Repositories', 'AI & connections', 'Preferences', 'Advanced']);
  expect(page.sidebar).toEqual([
    '# Account',
    '#settings-plan',
    '#settings-account',
    '#settings-storage',
    '# Repositories',
    '#settings-repositories',
    '#settings-published',
    '#settings-hosted',
    '# AI & connections',
    '#settings-access',
    '#settings-ai-providers',
    '# Preferences',
    '#settings-language',
    '#settings-theme',
    '#settings-versions',
    '#settings-editor',
    '# Advanced',
    '#settings-manifest',
    '#settings-updates',
  ]);
  // The page follows the sidebar.
  expect(page.sections).toEqual(page.sidebar.filter(entry => entry.startsWith('#settings-')).map(entry => entry.slice(1)));
});

it('hides a group without sections, so a community-only deployment shows no Account group', async () => {
  const page = await render([]);
  expect(page.headings).toEqual(['Repositories', 'AI & connections', 'Preferences', 'Advanced']);
  expect(page.sidebar.filter(entry => entry.startsWith('# '))).toEqual(['# Repositories', '# AI & connections', '# Preferences', '# Advanced']);
});

it('hides Core updates with its group entry when the deployment has none to update', async () => {
  const page = await render([], { coreUpdates: false });
  expect(page.sidebar).not.toContain('#settings-updates');
  expect(page.text).not.toContain('Core updates body');
  expect(page.sidebar).toContain('#settings-manifest');
});

it('keeps every existing section id, a link for each', async () => {
  const page = await render([]);
  for (const id of communityIds) {
    expect(page.sections).toContain(`settings-${id}`);
    expect(page.sidebar).toContain(`#settings-${id}`);
  }
});

it('renders sections without a group after every group, with no heading of their own', async () => {
  const page = await render([edition(section('plain'), section('advanced-tool', 'advanced'))]);
  expect(page.headings).toEqual(['Repositories', 'AI & connections', 'Preferences', 'Advanced']);
  expect(page.sidebar.slice(-2)).toEqual(['#settings-advanced-tool', '#settings-plain']);
  expect(page.sections.at(-1)).toBe('settings-plain');
  // A tagged section follows the community sections of its group.
  expect(page.sections.indexOf('settings-advanced-tool')).toBe(page.sections.indexOf('settings-updates') + 1);
});

it('treats a group name it does not know as no group', async () => {
  const page = await render([edition(section('odd', 'elsewhere' as SettingsGroup))]);
  expect(page.headings).toEqual(['Repositories', 'AI & connections', 'Preferences', 'Advanced']);
  expect(page.sections.at(-1)).toBe('settings-odd');
});

it("keeps a replaced community section in its own group, whatever group the edition's section names", async () => {
  const page = await render([edition({ ...section('repositories', 'account'), element: createElement('p', null, 'Edition members') })]);
  expect(page.headings).not.toContain('Account');
  expect(page.sidebar.slice(0, 2)).toEqual(['# Repositories', '#settings-repositories']);
  expect(page.text).toContain('Edition members');
});

it('puts the chosen repository above the repository list, and the product version at the end of Advanced', async () => {
  await render([], { repositoryChoice: true });
  const choice = container!.querySelector('.settings-repository-choice')!;
  expect(choice.textContent).toBe('Chosen repository');
  expect(choice.compareDocumentPosition(container!.querySelector('#settings-repositories')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(choice.parentElement?.getAttribute('aria-labelledby')).toBe('group-heading-repositories');
  const advanced = container!.querySelector('[aria-labelledby="group-heading-advanced"]')!;
  expect(advanced.lastElementChild?.textContent).toBe('Product versionMyGitNotes v0');
});

it('scrolls to every anchor an edition and its links rely on, and closes the drawer', async () => {
  const scrolled: string[] = [];
  Element.prototype.scrollIntoView = function(this: Element) {
    scrolled.push(this.id);
  };
  const page = await render([tagged]);
  for (const id of ['account', 'plan', 'repositories', 'published']) expect(page.sections).toContain(`settings-${id}`);
  for (const link of slot!.querySelectorAll<HTMLAnchorElement>('a.sidebar-link')) {
    await act(async () => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  }
  expect(scrolled).toEqual(page.sidebar.filter(entry => entry.startsWith('#settings-')).map(entry => entry.slice(1)));
});
