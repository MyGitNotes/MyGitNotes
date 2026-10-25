// @vitest-environment jsdom
import { createElement, useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../lib/i18n/index.js';
import { PanelProvider, usePanelContext } from '../lib/panel-context.js';
import { PANEL_OPEN_STORAGE_KEY, PANEL_TOOL_STORAGE_KEY } from '../lib/panel-state.js';
import { RightPanel } from './RightPanel.js';

vi.mock('./CalendarTool.js', () => ({ CalendarTool: () => createElement('p', null, 'Calendar contents') }));
vi.mock('./TodoTool.js', () => ({ TodoTool: () => createElement('p', null, 'Todo contents') }));
vi.mock('./ChangesTool.js', () => ({ ChangesTool: () => createElement('p', null, 'Changes contents') }));

let phone = true;
beforeEach(() => {
  phone = true;
  window.matchMedia = ((query: string) => ({ matches: query.includes('max-width: 767px') ? phone : false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  window.localStorage.setItem('github-notes:language', 'en');
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
});
afterEach(() => {
  cleanup();
  document.getElementById('root')?.remove();
  window.localStorage.clear();
});

let panelApi: ReturnType<typeof usePanelContext>;
function Capture() {
  const api = usePanelContext();
  useEffect(() => {
    panelApi = api;
  });
  return null;
}
const panel = (phoneSheet: boolean) => render(createElement(I18nProvider, null, createElement(PanelProvider, null, createElement(Capture), createElement(RightPanel, { phoneSheet, notebooks: [], selectedNotebookId: 'a', onOpenNote: vi.fn(), onSaveNote: vi.fn() as never, onReadNote: vi.fn() as never, gitStatus: null, changeCount: 0, deletedNotes: [], onRestoreNote: vi.fn(), onOpenCommitModal: vi.fn(), writable: true }))));

it('draws no rail on a phone Notes page, and shows the open tool as a full-height sheet that closes the tool', () => {
  panel(true);
  expect(screen.queryByRole('tablist')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  act(() => panelApi.openTool('changes'));
  const sheet = screen.getByRole('dialog', { name: 'Changes' });
  expect(sheet.closest('[data-variant]')).toHaveAttribute('data-variant', 'full');
  expect(within(sheet).getByText('Changes contents')).toBeInTheDocument();
  fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(panelApi.isOpen).toBe(false);
});

it('closes the tool sheet with Escape', () => {
  panel(true);
  act(() => panelApi.openTool('calendar'));
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'Calendar' }), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

it("does not open a phone's tool sheet from what a larger screen left open, nor change that memory", () => {
  window.localStorage.setItem(PANEL_OPEN_STORAGE_KEY, 'true');
  window.localStorage.setItem(PANEL_TOOL_STORAGE_KEY, 'todo');
  panel(true);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(window.localStorage.getItem(PANEL_OPEN_STORAGE_KEY)).toBe('true');
  act(() => panelApi.openTool('calendar'));
  act(() => panelApi.close());
  expect(window.localStorage.getItem(PANEL_OPEN_STORAGE_KEY)).toBe('true');
  expect(window.localStorage.getItem(PANEL_TOOL_STORAGE_KEY)).toBe('todo');
});

it('keeps the rail beside the page on a larger screen', () => {
  phone = false;
  panel(false);
  expect(screen.getByRole('tablist', { name: 'Tools' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Calendar' }));
  expect(screen.getByText('Calendar contents')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
});
