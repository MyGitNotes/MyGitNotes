// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { WorkspaceLinks } from './WorkspaceLinks.js';

const navigate = vi.fn();
vi.mock('react-router-dom', async importOriginal => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => navigate }));

let client: QueryClient;
let windowOpen: ReturnType<typeof vi.fn>;
beforeEach(() => {
  navigate.mockClear();
  windowOpen = vi.fn();
  vi.stubGlobal('open', windowOpen);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client }, children);

const link = (href: string) => createElement('span', { tabIndex: 0, 'data-testid': 'link', 'data-workspace-link': href, 'data-source-path': 'notes/a.md' }, 'Link');

/* eslint-disable react/no-children-prop -- The component test passes children explicitly as part of the tested props contract. */
const workspace = (href: string) => createElement(WorkspaceLinks, { notebooks: [], folders: [], onOpenNote: () => {}, children: link(href) });
/* eslint-enable react/no-children-prop */

it('reads an equal-root target only from the source repository and rejects a foreign note route', async () => {
  const { setNoteQueryScope } = await import('../lib/use-note-queries.js');
  setNoteQueryScope({ sourceId: 'test:two-repos', revisions: {}, repositories: { one: 'repo-one', two: 'repo-two' }, drafts: {} });
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, json: async () => ({ revisions: {}, notes: [{ notebookId: 'one', path: 'notes/b.md', title: 'B', content: '# B' }] }) }));
  vi.stubGlobal('fetch', fetcher);
  const onOpenNote = vi.fn();
  const notebooks = [{ id: 'one', title: 'One', root: 'notes' }, { id: 'two', title: 'Two', root: 'notes' }];
  const view = render(
    <WorkspaceLinks notebooks={notebooks} folders={[]} onOpenNote={onOpenNote}>
      <div data-source-notebook='one'>{link('b.md')}</div>
    </WorkspaceLinks>,
    { wrapper },
  );
  await act(async () => fireEvent.click(view.getByTestId('link')));
  expect(JSON.parse(fetcher.mock.calls[0][1].body as string).notes).toEqual([{ notebookId: 'one', path: 'notes/b.md' }]);
  expect(onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ notebookId: 'one' }), '', view.getByTestId('link'));
  view.rerender(
    <WorkspaceLinks notebooks={notebooks} folders={[]} onOpenNote={onOpenNote}>
      <div data-source-notebook='one'>{link('/notebooks/two/notes/b.md')}</div>
    </WorkspaceLinks>,
  );
  await act(async () => fireEvent.click(view.getByTestId('link'), { ctrlKey: true }));
  expect(windowOpen).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('routes a same-origin absolute URL through the router instead of opening a new window', async () => {
  const { getByTestId } = render(workspace(`${window.location.origin}/notebooks/nb1/notes/a.md`), { wrapper });
  await act(async () => {
    fireEvent.click(getByTestId('link'));
  });
  expect(navigate).toHaveBeenCalledWith('/notebooks/nb1/notes/a.md');
  expect(windowOpen).not.toHaveBeenCalled();
});

it('still opens a cross-origin absolute URL in a new window', async () => {
  const { getByTestId } = render(workspace('https://elsewhere.example/notebooks/nb1/notes/a.md'), { wrapper });
  await act(async () => {
    fireEvent.click(getByTestId('link'));
  });
  expect(windowOpen).toHaveBeenCalledWith('https://elsewhere.example/notebooks/nb1/notes/a.md', '_blank', 'noopener,noreferrer');
  expect(navigate).not.toHaveBeenCalled();
});

it('leaves editable outline link text to the editor but opens its explicit affordance safely', async () => {
  const view = render(
    <WorkspaceLinks notebooks={[]} folders={[]} onOpenNote={() => {}}>
      <div contentEditable suppressContentEditableWarning>
        <span data-testid='source' data-workspace-link='https://example.com/' data-source-path='notes/plan.outline.md'>Editable link text</span>
        <button contentEditable={false} data-testid='open' data-workspace-link='https://example.com/' data-source-path='notes/plan.outline.md'>Open link</button>
      </div>
    </WorkspaceLinks>,
    { wrapper },
  );
  fireEvent.mouseDown(view.getByTestId('source'));
  fireEvent.click(view.getByTestId('source'));
  fireEvent.keyDown(view.getByTestId('source'), { key: 'Enter' });
  expect(windowOpen).not.toHaveBeenCalled();
  await act(async () => fireEvent.keyDown(view.getByTestId('open'), { key: 'Enter' }));
  expect(windowOpen).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
});

it('opens a same-origin absolute URL in a new tab on a modifier click', async () => {
  const { getByTestId } = render(workspace(`${window.location.origin}/notebooks/nb1/notes/a.md`), { wrapper });
  await act(async () => {
    fireEvent.click(getByTestId('link'), { ctrlKey: true });
  });
  expect(windowOpen).toHaveBeenCalledWith('/notebooks/nb1/notes/a.md', '_blank', 'noopener,noreferrer');
  expect(navigate).not.toHaveBeenCalled();
});

/* eslint-disable react/no-children-prop -- Required children are explicit in createElement component props. */
it('keeps the source in place until a cold note body arrives, then reuses that body cache', async () => {
  const { setNoteQueryScope, noteLookupOptions } = await import('../lib/use-note-queries.js');
  const scope = { sourceId: 'test:links', revisions: {}, repositories: {}, drafts: {} };
  setNoteQueryScope(scope);
  let release!: () => void;
  const fetcher = vi.fn((_url: string, _init: RequestInit) =>
    new Promise(resolve => {
      release = () => resolve({ ok: true, json: async () => ({ revision: '', notes: [{ path: 'notes/b.md', notebookId: 'n', title: 'Target', content: '# Body' }] }) });
    })
  );
  vi.stubGlobal('fetch', fetcher);
  const onOpenNote = vi.fn();
  const { getByTestId } = render(createElement(WorkspaceLinks, { notebooks: [{ id: 'n', title: 'Notes', root: 'notes' }], folders: [], onOpenNote, children: link('b.md#heading') }), { wrapper });
  await act(async () => {
    fireEvent.click(getByTestId('link'));
  });
  expect(onOpenNote).not.toHaveBeenCalled();
  expect(JSON.parse(fetcher.mock.calls[0][1].body as string)).toMatchObject({ notes: [{ notebookId: 'n', path: 'notes/b.md' }], content: true });
  await act(async () => release());
  expect(onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/b.md', content: undefined }), 'heading', getByTestId('link'));
  expect(client.getQueryData(noteLookupOptions(scope, [{ notebookId: 'n', path: 'notes/b.md' }], true).queryKey)).toMatchObject({ notes: [{ content: '# Body' }] });
});

it('opens a preloaded link without another read and leaves draft selection to the destination', async () => {
  const { setNoteQueryScope, noteLookupOptions } = await import('../lib/use-note-queries.js');
  const scope = { sourceId: 'test:cached', revisions: {}, repositories: {}, drafts: {} };
  setNoteQueryScope(scope);
  client.setDefaultOptions({ queries: { staleTime: Infinity, retry: false } });
  client.setQueryData(noteLookupOptions(scope, [{ notebookId: 'n', path: 'notes/b.md' }], true).queryKey, { revisions: {}, repositories: {}, notes: [{ path: 'notes/b.md', content: '# Committed' }] });
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const onOpenNote = vi.fn();
  const { getByTestId } = render(createElement(WorkspaceLinks, { notebooks: [{ id: 'n', title: 'Notes', root: 'notes' }], folders: [], onOpenNote, children: link('b.md') }), { wrapper });
  await act(async () => {
    fireEvent.click(getByTestId('link'));
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/b.md', content: undefined }), '', getByTestId('link'));
});

/* eslint-enable react/no-children-prop */

/** Opens the preview of an asset whose original is at `rawUrl`, as a click on a link to it does, and answers the preview's "Open original" link. */
async function originalLink(rawUrl: string) {
  // The preview is a native dialog, which jsdom does not open.
  HTMLDialogElement.prototype.showModal = function(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  const { setNoteQueryScope } = await import('../lib/use-note-queries.js');
  setNoteQueryScope({ sourceId: 'test:asset-preview', revisions: {}, repositories: {}, drafts: {} });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => String(url).includes('/assets') ? { assets: [{ name: 'pic.png', path: 'notes/assets/pic.png', rawUrl, hash: 'h' }] } : { revisions: {}, notes: [] } })));
  const view = render(<WorkspaceLinks notebooks={[{ id: 'n', title: 'Notes', root: 'notes' }]} folders={[]} onOpenNote={vi.fn()}>{link('assets/pic.png')}</WorkspaceLinks>, { wrapper });
  await act(async () => {
    fireEvent.click(view.getByTestId('link'));
  });
  return await view.findByText('Open original');
}

it('opens the original of an asset of this site with the page as its Referer, so a demo page’s asset is asked for as the demo, and keeps noopener', async () => {
  const original = await originalLink('/raw-assets/by-hash/' + 'a'.repeat(40));
  expect(original.getAttribute('target')).toBe('_blank');
  expect(original.getAttribute('rel')).toBe('noopener');
});

it('opens the original of an asset of this site named by an absolute URL the same way', async () => {
  const original = await originalLink(`${window.location.origin}/raw-assets/notes/assets/pic.png?notebook=n`);
  expect(original.getAttribute('rel')).toBe('noopener');
});

it('still sends no Referer to an original that lives on another site', async () => {
  const original = await originalLink('https://cdn.example/pic.png');
  expect(original.getAttribute('rel')).toBe('noopener noreferrer');
});
