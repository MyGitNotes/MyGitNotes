// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ASSISTANT_DOCK_STORAGE_KEY, assistantDock } from '../../lib/assistant-dock.js';
import { PiAgentContext, type PiAgentValue } from '../../lib/pi-agent/session.js';
import { emptyTranscript } from '../../lib/pi-agent/transcript.js';
import { Header } from '../Header.js';
import { NoteEditorToolbar } from '../note-editor/NoteEditorToolbar.js';
import { AssistantDock } from './AssistantDock.js';

const phoneQuery = '(max-width: 767px)';
let phone = false;

beforeEach(() => {
  localStorage.clear();
  assistantDock.reload();
  phone = false;
  window.innerWidth = 1440;
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === phoneQuery && phone, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  // jsdom has no pointer capture; the separator keeps the drag with itself through it.
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = () => true;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty('--assistant-dock-width');
});

function agent(overrides: Partial<PiAgentValue> = {}): PiAgentValue {
  return { available: true, session: null, target: null, notebooks: [], repositories: [], defaultRepository: 'local:home', workspaces: [], loadWorkspaces: vi.fn(async () => {}), connected: false, historyLoaded: false, transcript: emptyTranscript, modelState: { models: [], levels: [] }, error: '', starting: false, start: vi.fn(async () => {}), wake: vi.fn(), commands: [], loadCommands: vi.fn(), editorText: null, takeEditorText: vi.fn(), ...overrides } as unknown as PiAgentValue;
}

const withAgent = (children: ReactNode, value = agent()) => createElement(PiAgentContext.Provider, { value }, children);
const width = () => document.documentElement.style.getPropertyValue('--assistant-dock-width');
const separator = () => screen.getByRole('separator', { name: 'Resize agent' });
const header = () => createElement(Header, { workspaceTitle: 'Notes', activeTab: 'notes', setActiveTab: () => {}, selectedNotebookId: 'work', notebooks: [], onSelectNotebook: () => {}, onCreateNote: () => {}, onOpenCommands: () => {} });

const note = { id: 'a', path: 'notes/untitled.md', notebookId: 'a', title: 'Untitled', tags: [], metadata: {}, content: '# Untitled' };
const session = { title: 'Untitled', locked: false, isSaving: false, hasUnsavedChanges: false, content: note.content, copyState: 'idle', copyNote: vi.fn(), close: vi.fn() };
const toolbar = () => createElement(NoteEditorToolbar, { frame: 'zoom', note, session: session as never, docPanel: { notePanel: null, lastNotePanel: { current: 'find' } } as never, isMarkdown: false, autoSave: true, readOnly: false, editorMode: 'live', setEditorMode: vi.fn(), showLineNumbers: false, toggleLineNumbers: vi.fn(), showFormatToolbar: false, onClose: vi.fn() });

it('toggles the dock from the header, the one agent button there, naming its key, and says whether it is open', () => {
  render(withAgent(createElement('div', null, header(), createElement(AssistantDock))));
  const toggle = screen.getByRole('button', { name: 'Agent' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  // It names the dock it controls only while the dock is there.
  expect(toggle.hasAttribute('aria-controls')).toBe(false);
  expect(toggle.getAttribute('title')).toBe('Agent (Ctrl+`)');
  expect(toggle.getAttribute('aria-keyshortcuts')).toBe('Control+`');
  expect(screen.queryByRole('button', { name: 'Agent workspaces' })).toBeNull();
  expect(screen.queryByRole('separator', { name: 'Resize agent' })).toBeNull();
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBe(document.querySelector('.assistant-dock'));
  expect(separator()).toBeTruthy();
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(toggle.hasAttribute('aria-controls')).toBe(false);
  expect(screen.queryByRole('separator', { name: 'Resize agent' })).toBeNull();
});

it('gives focus back to where it was as the dock opened when closing the dock takes focus with it, or else to the toggle', () => {
  render(withAgent(createElement('div', null, header(), createElement('button', { type: 'button' }, 'Elsewhere'), createElement(AssistantDock))));
  const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
  elsewhere.focus();
  act(() => assistantDock.open());
  screen.getByRole('button', { name: 'Close agent' }).focus();
  fireEvent.click(screen.getByRole('button', { name: 'Close agent' }));
  expect(screen.queryByRole('button', { name: 'Close agent' })).toBeNull();
  expect(document.activeElement).toBe(elsewhere);

  // Opened with nothing focused, there is nowhere to return to, so focus goes to the toggle that opens the dock again.
  elsewhere.blur();
  act(() => assistantDock.open());
  screen.getByRole('button', { name: 'Close agent' }).focus();
  fireEvent.click(screen.getByRole('button', { name: 'Close agent' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Agent' }));

  // Closed from its toggle, focus is already on the toggle and stays there.
  const toggle = screen.getByRole('button', { name: 'Agent' });
  fireEvent.click(toggle);
  elsewhere.focus();
  toggle.focus();
  fireEvent.click(toggle);
  expect(document.activeElement).toBe(toggle);
});

it('toggles the same dock from the end of the editor toolbar, with aria-expanded', () => {
  render(withAgent(createElement('div', null, toolbar(), createElement(AssistantDock))));
  const toggle = screen.getByRole('button', { name: 'Agent' });
  const panelsToggle = screen.getByRole('button', { name: 'Document tools' });
  expect(panelsToggle.nextElementSibling).toBe(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(assistantDock.get().open).toBe(true);
  expect(screen.getByRole('region', { name: 'Pi agent' })).toBeTruthy();
});

it('opens the Agents page from the dock header, unless navigation is closed, in the gated dock too', () => {
  const onOpenAgents = vi.fn();
  assistantDock.open();
  const view = render(withAgent(createElement(AssistantDock, { onOpenAgents })));
  fireEvent.click(screen.getByRole('button', { name: 'Agent workspaces' }));
  expect(onOpenAgents).toHaveBeenCalledTimes(1);
  expect(assistantDock.get().open).toBe(true);
  view.rerender(withAgent(createElement(AssistantDock, { onOpenAgents, agentsDisabled: true })));
  expect(screen.getByRole('button', { name: 'Agent workspaces' })).toHaveProperty('disabled', true);
});

it('closes the phone sheet after opening the Agents page, which it would cover', () => {
  phone = true;
  const onOpenAgents = vi.fn();
  assistantDock.open();
  render(withAgent(createElement(AssistantDock, { onOpenAgents })));
  fireEvent.click(screen.getByRole('button', { name: 'Agent workspaces' }));
  expect(onOpenAgents).toHaveBeenCalledTimes(1);
  expect(assistantDock.get().open).toBe(false);
});

it('offers no toggle and no dock where the agent is not offered, keeping the Agents page in the header', () => {
  assistantDock.open();
  render(withAgent(createElement('div', null, header(), toolbar(), createElement(AssistantDock)), agent({ available: false })));
  expect(screen.queryByRole('button', { name: 'Agent' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Agent workspaces' })).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Pi agent' })).toBeNull();
  expect(width()).toBe('0px');
});

it('reserves its width for the zoom overlays while open, and none once closed', () => {
  render(withAgent(createElement(AssistantDock)));
  expect(width()).toBe('0px');
  act(() => assistantDock.open());
  expect(width()).toBe('380px');
  fireEvent.click(screen.getByRole('button', { name: 'Close agent' }));
  expect(width()).toBe('0px');
  expect(screen.queryByRole('region', { name: 'Pi agent' })).toBeNull();
});

it('remembers whether it is open and how wide, per browser', () => {
  render(withAgent(createElement(AssistantDock)));
  act(() => assistantDock.open());
  fireEvent.keyDown(separator(), { key: 'ArrowLeft' });
  expect(JSON.parse(localStorage.getItem(ASSISTANT_DOCK_STORAGE_KEY)!)).toEqual({ open: true, width: 396, expanded: false });
  cleanup();
  assistantDock.reload();
  render(withAgent(createElement(AssistantDock)));
  expect(width()).toBe('396px');
  expect(screen.getByRole('region', { name: 'Pi agent' })).toBeTruthy();
});

it('resizes with the arrow keys by 16px within 320px and half the window', () => {
  render(withAgent(createElement(AssistantDock)));
  act(() => assistantDock.open());
  const handle = separator();
  expect(handle.getAttribute('aria-valuenow')).toBe('380');
  expect(handle.getAttribute('aria-valuemin')).toBe('320');
  expect(handle.getAttribute('aria-valuemax')).toBe('720');
  expect(handle.tabIndex).toBe(0);
  fireEvent.keyDown(handle, { key: 'ArrowLeft' });
  expect(width()).toBe('396px');
  fireEvent.keyDown(handle, { key: 'ArrowRight' });
  fireEvent.keyDown(handle, { key: 'ArrowRight' });
  expect(width()).toBe('364px');
  for (let step = 0; step < 6; step++) fireEvent.keyDown(handle, { key: 'ArrowRight' });
  expect(width()).toBe('320px');
  for (let step = 0; step < 40; step++) fireEvent.keyDown(handle, { key: 'ArrowLeft' });
  expect(width()).toBe('720px');
});

it('resizes by dragging its left edge', () => {
  render(withAgent(createElement(AssistantDock)));
  act(() => assistantDock.open());
  const handle = separator();
  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 1060 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 940 });
  expect(width()).toBe('500px');
  // Dragged past either bound, it stops at the bound.
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100 });
  expect(width()).toBe('720px');
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 1430 });
  expect(width()).toBe('320px');
  fireEvent.pointerUp(handle, { pointerId: 1 });
});

it('expands to half the window, at most 760px, and back to the chosen width', () => {
  render(withAgent(createElement(AssistantDock), agent({ session: { id: 's', cwd: '/w', location: { repository: 'local:home', folder: '' }, status: 'ready', startedAt: '' }, connected: true, historyLoaded: true })));
  act(() => assistantDock.open());
  fireEvent.keyDown(separator(), { key: 'ArrowLeft' });
  fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
  expect(width()).toBe('720px');
  act(() => {
    window.innerWidth = 2000;
    window.dispatchEvent(new Event('resize'));
  });
  expect(width()).toBe('760px');
  fireEvent.click(screen.getByRole('button', { name: 'Shrink' }));
  expect(width()).toBe('396px');
});

it('is a full-screen sheet with a close button on a phone, and reserves no room beside the page', () => {
  phone = true;
  assistantDock.open();
  render(withAgent(createElement(AssistantDock)));
  expect(width()).toBe('0px');
  expect(screen.queryByRole('separator')).toBeNull();
  expect(document.querySelector<HTMLElement>('.assistant-dock')!.style.width).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Close agent' }));
  expect(assistantDock.get().open).toBe(false);
});

it('keeps the panel before the resize handle in the tab order, so focus runs header, conversation, message box', () => {
  assistantDock.open();
  render(withAgent(createElement(AssistantDock)));
  const dock = document.querySelector('.assistant-dock')!;
  expect(dock.firstElementChild).toBe(screen.getByRole('region', { name: 'Pi agent' }));
  expect(dock.lastElementChild).toBe(separator());
});
