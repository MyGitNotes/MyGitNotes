// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { assistantDock } from '../../lib/assistant-dock.js';
import { PanelProvider } from '../../lib/panel-context.js';
import { PANEL_OPEN_STORAGE_KEY, PANEL_TOOL_STORAGE_KEY } from '../../lib/panel-state.js';
import { PiAgentContext, type PiAgentValue } from '../../lib/pi-agent/session.js';
import { NoteDocumentPanel, type NoteDocumentPanelProps } from '../note-editor/NoteDocumentPanel.js';
import { RightPanel } from '../RightPanel.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import { emptyTranscript } from '../../lib/pi-agent/transcript.js';
import { previewDock } from '../../lib/typst-preview/dock-store.js';
import { TypstPreviewProvider, usePublishPreviewTarget } from '../../lib/typst-preview/preview-target.js';
import { TypstPreviewDock } from '../typst-preview/TypstPreviewDock.js';
import { AssistantDock } from './AssistantDock.js';

const api = vi.hoisted(() => ({ fetchTypstPreviewProject: vi.fn(), compileTypstPreview: vi.fn(), fetchTypstPreviewPdf: vi.fn() }));
vi.mock('../../lib/api.js', async original => ({ ...await original<typeof import('../../lib/api.js')>(), ...api }));

beforeEach(() => {
  localStorage.clear();
  assistantDock.reload();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const offered = { available: true } as PiAgentValue;
const names = (role: string) => screen.getAllByRole(role).map(element => element.getAttribute('aria-label'));

function rail(extra: Record<string, unknown> = {}) {
  render(createElement(PiAgentContext.Provider, { value: offered }, createElement(PanelProvider, null, createElement(RightPanel, { notebooks: [], selectedNotebookId: '', onOpenNote: vi.fn(), onSaveNote: vi.fn(), onReadNote: vi.fn(), gitStatus: null, changeCount: 0, deletedNotes: [], onRestoreNote: vi.fn(), onOpenCommitModal: vi.fn(), writable: false, ...extra }))));
}

it('offers no Agent tab in the right rail, even where the agent is offered', () => {
  rail();
  expect(names('tab')).toEqual(['Calendar', 'Todo', 'Changes']);
});

it('offers only Metadata and Changes on the Files page, with the document tools of a Focus beside the tools', () => {
  rail({ fileMode: true });
  expect(names('tab')).toEqual(['Metadata', 'Changes']);
  cleanup();
  rail({ documentPanel: { enabled: true, onContainer: vi.fn() } });
  expect(names('tab')).toEqual(['Calendar', 'Todo', 'Changes', 'Outline', 'Find in note', 'Frontmatter', 'View settings', 'History']);
});

it('opens the dock, not an empty rail, for a right panel saved open on the agent', () => {
  localStorage.setItem(PANEL_TOOL_STORAGE_KEY, 'agent');
  localStorage.setItem(PANEL_OPEN_STORAGE_KEY, 'true');
  rail();
  expect(assistantDock.get().open).toBe(true);
  expect(document.querySelector('.right-panel')).toHaveProperty('dataset.open', 'false');
  expect(document.querySelector('.right-panel-content')).toBeNull();
});

it("offers no Agent tab in the editor's document tools", () => {
  const props = { includeTabs: true, isMarkdown: true, setNotePanel: vi.fn(), isFindOpen: false, isOutlineOpen: false, showFrontmatter: false, isViewPanelOpen: false, isHistoryOpen: false, history: {} as never, notePath: 'notes/a.md', content: '# A', metadata: {}, locked: false, readOnly: false, notebookId: 'a' } as unknown as NoteDocumentPanelProps;
  render(createElement(PiAgentContext.Provider, { value: offered }, createElement(NoteDocumentPanel, props)));
  expect(names('tab')).toEqual(['Find in note', 'Outline', 'Frontmatter', 'View settings', 'History']);
  expect(screen.queryByRole('tab', { name: 'Agent' })).toBeNull();
});

function Following() {
  usePublishPreviewTarget({ notebookId: 'p', path: 'projects/demo/body.md' }, true);
  return null;
}

it('ends the zoom overlays at the left edge of both docks when the preview and the assistant are open together', async () => {
  window.innerWidth = 1440;
  api.fetchTypstPreviewProject.mockResolvedValue({ project: { name: 'demo', directory: 'projects/demo', targets: ['main'], defaultTarget: 'main', bibliographyRevision: 'r' }, toolkit: { ok: true, version: '0.1.6' } });
  api.compileTypstPreview.mockResolvedValue({ ok: false, durationMs: 1, log: 'error: none' });
  const agent = { available: true, session: null, target: null, notebooks: [], repositories: [], defaultRepository: 'local:home', workspaces: [], loadWorkspaces: vi.fn(async () => {}), connected: false, historyLoaded: false, transcript: emptyTranscript, modelState: { models: [], levels: [] }, error: '', starting: false, start: vi.fn(async () => {}), wake: vi.fn(), commands: [], loadCommands: vi.fn(), editorText: null, takeEditorText: vi.fn() } as unknown as PiAgentValue;
  const edge = () => document.documentElement.style.getPropertyValue('--assistant-dock-width');
  previewDock.reload();
  previewDock.open();
  assistantDock.open();
  const view = render(createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, createElement(PiAgentContext.Provider, { value: agent }, createElement(TypstPreviewProvider, { enabled: true }, createElement(Following), createElement(TypstPreviewDock), createElement(AssistantDock)))));
  // The assistant's 380px, then the preview's 520px beside it.
  await waitFor(() => expect(edge()).toBe('900px'));
  expect([...document.querySelectorAll('.typst-preview-dock, .assistant-dock')].map(dock => dock.className)).toEqual(['typst-preview-dock', 'assistant-dock']);
  act(() => assistantDock.close());
  expect(edge()).toBe('520px');
  act(() => previewDock.close());
  expect(edge()).toBe('0px');
  view.unmount();
});
