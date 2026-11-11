// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TypstCompileResult, TypstPreviewProjectAnswer } from '../../lib/api.js';
import type { PdfDocument } from '../../lib/pdf/pdf-document.js';
import { previewDock, TYPST_PREVIEW_DOCK_STORAGE_KEY } from '../../lib/typst-preview/dock-store.js';
import { notifyLocalSave } from '../../lib/typst-preview/local-save-events.js';
import { type PreviewNote, TypstPreviewProvider, usePublishPreviewTarget } from '../../lib/typst-preview/preview-target.js';
import { TypstPreviewDock } from './TypstPreviewDock.js';
import { TypstPreviewToggle } from './TypstPreviewToggle.js';

const api = vi.hoisted(() => ({ fetchTypstPreviewProject: vi.fn(), compileTypstPreview: vi.fn(), fetchTypstPreviewPdf: vi.fn() }));
vi.mock('../../lib/api.js', async original => ({ ...await original<typeof import('../../lib/api.js')>(), ...api }));

const phoneQuery = '(max-width: 767px)';
let phone = false;
/** The height jsdom reports for every page of the PDF on screen; it lays nothing out itself. */
let pageHeight = 1000;
const PAGE_GAP = 0;

const demo: TypstPreviewProjectAnswer = { project: { name: 'demo', directory: 'projects/demo', targets: ['main'], defaultTarget: 'main', bibliographyRevision: 'r1' }, toolkit: { ok: true, version: '0.1.6' } };
const body: PreviewNote = { notebookId: 'p', path: 'projects/demo/body.md' };
const outside: PreviewNote = { notebookId: 'a', path: 'notes/x.md' };

let documents: (PdfDocument & { bytes: Uint8Array; destroyed: boolean; })[] = [];
/** The page height from the next opened document on, when set. */
let heightOnOpen: number | undefined;
const openPdf = vi.fn(async (bytes: Uint8Array) => {
  if (heightOnOpen !== undefined) pageHeight = heightOnOpen;
  const document = {
    bytes,
    destroyed: false,
    pageCount: bytes[0]!,
    pageSize: async () => ({ width: 600, height: 800 }),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: () => {} })),
    text: async () => '',
    destroy: vi.fn(async () => {
      document.destroyed = true;
    }),
  };
  documents.push(document);
  return document;
});
/** A "PDF" of `pages` pages; the fake reader takes the count from its first byte. */
const pdf = (pages: number) => new Uint8Array([pages]);
const good = (revision: string): TypstCompileResult => ({ ok: true, revision, durationMs: 250, log: '' });

beforeEach(() => {
  localStorage.clear();
  previewDock.reload();
  phone = false;
  pageHeight = 1000;
  heightOnOpen = undefined;
  documents = [];
  window.innerWidth = 1440;
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === phoneQuery && phone, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.page ? pageHeight : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.page ? (Number(this.dataset.page) - 1) * (pageHeight + PAGE_GAP) : 0;
    },
  });
  api.fetchTypstPreviewProject.mockImplementation(async (path: string) => path.startsWith('projects/demo/') ? demo : { project: null });
  api.compileTypstPreview.mockResolvedValue(good('rev1'));
  api.fetchTypstPreviewPdf.mockResolvedValue(pdf(3));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete (HTMLElement.prototype as { offsetHeight?: unknown; }).offsetHeight;
  delete (HTMLElement.prototype as { offsetTop?: unknown; }).offsetTop;
  document.documentElement.style.removeProperty('--assistant-dock-width');
});

function Editor({ note }: { note: PreviewNote; }) {
  usePublishPreviewTarget(note, true);
  return createElement(TypstPreviewToggle, { note });
}
function page(note: PreviewNote | null, enabled = true): ReactNode {
  return createElement(QueryClientProvider, { client }, createElement(TypstPreviewProvider, { enabled }, note && createElement(Editor, { note }), createElement(TypstPreviewDock, { openPdf })));
}
let client: QueryClient;
function show(note: PreviewNote | null, enabled = true) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(page(note, enabled));
}
const pages = () => [...document.querySelectorAll<HTMLElement>('.typst-preview-page')];
const scroller = () => document.querySelector<HTMLElement>('.typst-preview-pages')!;
const shownPages = () => waitFor(() => expect(pages().length).toBeGreaterThan(0));

it('offers the toggle for a note of a project and compiles once when the dock opens', async () => {
  show(body);
  const toggle = await screen.findByRole('button', { name: 'Typst preview' });
  expect(document.querySelector('.typst-preview-dock')).toBeNull();
  expect(api.compileTypstPreview).not.toHaveBeenCalled();
  fireEvent.click(toggle);
  await shownPages();
  expect(api.compileTypstPreview).toHaveBeenCalledTimes(1);
  expect(api.compileTypstPreview).toHaveBeenCalledWith('projects/demo/body.md', 'p', 'main');
  expect(api.fetchTypstPreviewPdf).toHaveBeenCalledWith('projects/demo/body.md', 'p', 'main', 'rev1');
  expect(pages()).toHaveLength(3);
  expect(document.querySelector('.typst-preview-dock-title')!.textContent).toBe('demo / main');
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(JSON.parse(localStorage.getItem(TYPST_PREVIEW_DOCK_STORAGE_KEY)!)).toMatchObject({ open: true, width: 520 });
  expect(document.documentElement.style.getPropertyValue('--assistant-dock-width')).toBe('520px');
});

it('offers no toggle and shows no dock for a note outside a project', async () => {
  previewDock.open();
  show(outside);
  await waitFor(() => expect(api.fetchTypstPreviewProject).toHaveBeenCalled());
  await act(async () => {});
  expect(screen.queryByRole('button', { name: 'Typst preview' })).toBeNull();
  expect(document.querySelector('.typst-preview-dock')).toBeNull();
  expect(api.compileTypstPreview).not.toHaveBeenCalled();
});

it('compiles again after a local save of a note in the project, and not after one outside it', async () => {
  previewDock.open();
  show(body);
  await shownPages();
  api.compileTypstPreview.mockResolvedValue(good('rev2'));
  api.fetchTypstPreviewPdf.mockResolvedValue(pdf(4));
  act(() => notifyLocalSave({ notebookId: 'a', path: 'notes/x.md' }));
  act(() => notifyLocalSave({ notebookId: 'p', path: 'projects/demolition/body.md' }));
  await act(async () => {});
  expect(api.compileTypstPreview).toHaveBeenCalledTimes(1);
  act(() => notifyLocalSave({ notebookId: 'p', path: 'projects/demo/abstract.md' }));
  await waitFor(() => expect(pages()).toHaveLength(4));
  expect(api.compileTypstPreview).toHaveBeenCalledTimes(2);
  // The document that left the screen is closed.
  await waitFor(() => expect(documents[0]!.destroyed).toBe(true));
  expect(documents[1]!.destroyed).toBe(false);
});

it('compiles again from the button, and loads no PDF when the revision is the one on screen', async () => {
  previewDock.open();
  show(body);
  await shownPages();
  fireEvent.click(screen.getByRole('button', { name: 'Recompile' }));
  await waitFor(() => expect(api.compileTypstPreview).toHaveBeenCalledTimes(2));
  await act(async () => {});
  expect(api.fetchTypstPreviewPdf).toHaveBeenCalledTimes(1);
  expect(openPdf).toHaveBeenCalledTimes(1);
});

it('keeps the last good pages under an error, shows its first error line and the log, and clears it on the next good compile', async () => {
  previewDock.open();
  show(body);
  await shownPages();
  const log = 'compiling demo main\nerror: label <missing> does not exist in the document\n  ┌─ body.md';
  api.compileTypstPreview.mockResolvedValue({ ok: false, durationMs: 90, log });
  act(() => notifyLocalSave(body));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('error: label <missing> does not exist in the document');
  expect(alert.querySelector('pre')!.textContent).toBe(log);
  expect(pages()).toHaveLength(3);
  expect(scroller().dataset.stale).toBe('true');
  expect(documents[0]!.destroyed).toBe(false);

  api.compileTypstPreview.mockResolvedValue(good('rev2'));
  api.fetchTypstPreviewPdf.mockResolvedValue(pdf(2));
  act(() => notifyLocalSave(body));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  await waitFor(() => expect(pages()).toHaveLength(2));
  expect(scroller().dataset.stale).toBeUndefined();
});

it('shows a failure of the very first compile without pages', async () => {
  api.compileTypstPreview.mockRejectedValue(new Error('The toolkit could not be started'));
  previewDock.open();
  show(body);
  expect((await screen.findByRole('alert')).textContent).toContain('The toolkit could not be started');
  expect(pages()).toHaveLength(0);
});

it('stays on the same page, the same fraction of the way down it, when a new revision replaces the pages', async () => {
  previewDock.open();
  show(body);
  await shownPages();
  // Half way down page 2 of pages 1000px tall.
  scroller().scrollTop = 1500;
  heightOnOpen = 1200;
  api.compileTypstPreview.mockResolvedValue(good('rev2'));
  api.fetchTypstPreviewPdf.mockResolvedValue(pdf(5));
  act(() => notifyLocalSave(body));
  await waitFor(() => expect(pages()).toHaveLength(5));
  expect(scroller().scrollTop).toBe(1800);
  // The pages in view were drawn before the swap, so they do not flash blank.
  expect((documents[1]!.render as ReturnType<typeof vi.fn>).mock.calls.map(call => call[0])).toEqual(expect.arrayContaining([2, 3]));
  expect(pages()[1]!.querySelector('canvas')).not.toBeNull();
});

it('goes to the last page when the new revision is shorter than where the reader was', async () => {
  previewDock.open();
  show(body);
  await shownPages();
  scroller().scrollTop = 2500;
  api.compileTypstPreview.mockResolvedValue(good('rev2'));
  api.fetchTypstPreviewPdf.mockResolvedValue(pdf(1));
  act(() => notifyLocalSave(body));
  await waitFor(() => expect(pages()).toHaveLength(1));
  expect(scroller().scrollTop).toBe(500);
});

it('keeps showing the project when the note followed leaves it', async () => {
  previewDock.open();
  const view = show(body);
  await shownPages();
  view.rerender(page(outside));
  await waitFor(() => expect(api.fetchTypstPreviewProject).toHaveBeenCalledWith('notes/x.md', 'a'));
  await act(async () => {});
  expect(document.querySelector('.typst-preview-dock-title')!.textContent).toBe('demo / main');
  expect(pages()).toHaveLength(3);
  expect(screen.queryByRole('button', { name: 'Typst preview' })).toBeNull();
  // A save in the project still refreshes it.
  act(() => notifyLocalSave(body));
  await waitFor(() => expect(api.compileTypstPreview).toHaveBeenCalledTimes(2));
});

it('offers the targets when the project has several, and remembers the choice for the project', async () => {
  api.fetchTypstPreviewProject.mockResolvedValue({ ...demo, project: { ...demo.project!, targets: ['anon', 'main'] } });
  previewDock.open();
  const view = show(body);
  await shownPages();
  const select = screen.getByRole('combobox', { name: 'Target' }) as HTMLSelectElement;
  expect(select.value).toBe('main');
  api.compileTypstPreview.mockResolvedValue(good('anon1'));
  fireEvent.change(select, { target: { value: 'anon' } });
  await waitFor(() => expect(api.compileTypstPreview).toHaveBeenLastCalledWith('projects/demo/body.md', 'p', 'anon'));
  expect(document.querySelector('.typst-preview-dock-title')!.textContent).toBe('demo / anon');
  view.unmount();
  previewDock.reload();
  api.compileTypstPreview.mockClear();
  show(body);
  await waitFor(() => expect(api.compileTypstPreview).toHaveBeenCalledWith('projects/demo/body.md', 'p', 'anon'));
});

it('shows how to set the toolkit up instead of compiling when it is missing or too old', async () => {
  api.fetchTypstPreviewProject.mockResolvedValue({ ...demo, toolkit: { ok: false, code: 'too-old', version: '0.1.3' } });
  previewDock.open();
  show(body);
  const notice = await screen.findByRole('status');
  expect(notice.textContent).toContain('0.1.3');
  expect(notice.querySelector('code')!.textContent).toBe('npm install thesis-toolkit@latest');
  expect(api.compileTypstPreview).not.toHaveBeenCalled();
});

it('renders nothing and asks the server nothing in a remote workspace', async () => {
  previewDock.open();
  const view = show(body, false);
  await act(async () => {});
  expect(view.container.innerHTML).toBe('');
  expect(api.fetchTypstPreviewProject).not.toHaveBeenCalled();
  expect(api.compileTypstPreview).not.toHaveBeenCalled();
  expect(document.documentElement.style.getPropertyValue('--assistant-dock-width')).not.toBe('520px');
});

it('renders nothing on a phone', async () => {
  phone = true;
  previewDock.open();
  const view = show(body);
  await waitFor(() => expect(api.fetchTypstPreviewProject).toHaveBeenCalled());
  await act(async () => {});
  expect(view.container.innerHTML).toBe('');
  expect(api.compileTypstPreview).not.toHaveBeenCalled();
});

it('closes from its own button and resizes from its edge with the arrow keys', async () => {
  previewDock.open();
  show(body);
  await shownPages();
  const separator = screen.getByRole('separator', { name: 'Resize preview' });
  fireEvent.keyDown(separator, { key: 'ArrowLeft' });
  expect(previewDock.get().width).toBe(536);
  expect(document.documentElement.style.getPropertyValue('--assistant-dock-width')).toBe('536px');
  fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
  expect(document.querySelector('.typst-preview-dock')).toBeNull();
  expect(previewDock.get().open).toBe(false);
  expect(document.documentElement.style.getPropertyValue('--assistant-dock-width')).toBe('0px');
});
