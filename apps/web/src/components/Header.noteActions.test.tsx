// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../lib/i18n/index.js';
import type { WorkspaceTab } from '../lib/routes.js';
import { Header } from './Header.js';

beforeEach(() => window.localStorage.setItem('github-notes:language', 'en'));
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

/** The header row's own controls; the phone navigation's New Note button, hidden on a desktop, stays in the navigation. */
const account = () => within(document.querySelector<HTMLElement>('.header-account')!);
const focusControls = createElement('button', { type: 'button' }, 'Focus switcher');
const header = (activeTab: WorkspaceTab, newNote: Parameters<typeof Header>[0]['newNote'] | null = { onNewNote: vi.fn(), onNewCompilation: vi.fn() }) =>
  render(createElement(I18nProvider, null, createElement(Header, { workspaceTitle: 'Work', activeTab, setActiveTab: vi.fn(), notebooks: [{ id: 'a', title: 'Alpha', root: 'notes/a' }], selectedNotebookId: 'a', onSelectNotebook: vi.fn(), onCreateNote: vi.fn(), onOpenCommands: vi.fn(), focusControls, newNote: newNote ?? undefined })));

it('holds the Focus controls left of the notebook switcher and New right of it on the Notes page, before the utilities', () => {
  header('notes');
  const group = screen.getByRole('group', { name: 'Focus' });
  expect(group).toContainElement(screen.getByRole('button', { name: 'Focus switcher' }));
  const order = [group, screen.getByRole('combobox', { name: 'Notebooks' }), account().getByRole('button', { name: 'New Note' }), screen.getByRole('button', { name: 'New menu' }), screen.getByRole('button', { name: 'Quick open' })];
  for (let index = 1; index < order.length; index++) expect(order[index - 1]!.compareDocumentPosition(order[index]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('creates a note from the header New button and lists the same menu items as before', async () => {
  const create = vi.fn(), outline = vi.fn();
  header('notes', { onNewNote: create, onNewCompilation: vi.fn(), onNewOutline: outline });
  fireEvent.click(account().getByRole('button', { name: 'New Note' }));
  expect(create).toHaveBeenCalledOnce();
  const trigger = screen.getByRole('button', { name: 'New menu' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'New outline' }));
  expect(outline).toHaveBeenCalledOnce();
});

it.each(['graph', 'assets', 'settings', 'agent'] as WorkspaceTab[])('shows neither the Focus controls nor New on %s', activeTab => {
  header(activeTab);
  expect(screen.queryByRole('group', { name: 'Focus' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Focus switcher' })).toBeNull();
  expect(account().queryByRole('button', { name: 'New Note' })).toBeNull();
  expect(screen.getByRole('combobox', { name: 'Notebooks' })).toBeInTheDocument();
});

it('keeps the Focus controls but shows no New button for a read-only notebook', () => {
  header('notes', null);
  expect(screen.getByRole('group', { name: 'Focus' })).toBeInTheDocument();
  expect(account().queryByRole('button', { name: 'New Note' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'New menu' })).toBeNull();
});
