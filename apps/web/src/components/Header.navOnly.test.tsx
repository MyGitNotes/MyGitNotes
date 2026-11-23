// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../lib/i18n/index.js';
import { Header } from './Header.js';

beforeEach(() => window.localStorage.setItem('github-notes:language', 'en'));
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const header = (navOnly: boolean, readOnly = false, notebooksToggle?: { open: boolean; controls: string; onToggle: () => void; }) => render(createElement(I18nProvider, null, createElement(Header, { workspaceTitle: 'Work', activeTab: 'notes', setActiveTab: vi.fn(), notebooks: [{ id: 'a', title: 'Alpha' }] as never, selectedNotebookId: 'a', onSelectNotebook: vi.fn(), onCreateNote: readOnly ? undefined : vi.fn(), onOpenCommands: vi.fn(), navOnly, notebooksToggle })));

it('keeps only the bottom navigation when a phone draws its own bars', () => {
  header(true);
  const nav = screen.getByRole('navigation', { name: 'Main navigation' });
  expect(nav.querySelectorAll('button')).toHaveLength(5);
  expect(screen.getByRole('button', { name: 'New Note' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Work' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Notebooks' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Quick open' })).toBeNull();
});

it('leaves the New Note button out of the bottom navigation when the notebook is read-only', () => {
  header(true, true);
  const nav = screen.getByRole('navigation', { name: 'Main navigation' });
  expect(screen.queryByRole('button', { name: 'New Note' })).toBeNull();
  expect(nav.querySelectorAll('button')).toHaveLength(4);
});

it('shows the brand and the utilities wider than a phone, the notebooks column holding the switcher on the Notes page', () => {
  header(false);
  expect(screen.getByRole('heading', { name: 'Work' })).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Notebooks' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Quick open' })).toBeInTheDocument();
});

// Boss (0.31.1 review): the notebooks column's toggle moves left of the logo, like a desktop app's sidebar button.
it("puts the notebooks column's toggle left of the logo on the Notes page", () => {
  const onToggle = vi.fn();
  const { rerender } = header(false, false, { open: true, controls: 'browse-notebooks', onToggle });
  const toggle = screen.getByRole('button', { name: 'Collapse notebooks' });
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(toggle).toHaveAttribute('aria-controls', 'browse-notebooks');
  expect(toggle.compareDocumentPosition(screen.getByRole('img', { name: 'MyGitNotes' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(toggle);
  expect(onToggle).toHaveBeenCalledOnce();
  rerender(createElement(I18nProvider, null, createElement(Header, { workspaceTitle: 'Work', activeTab: 'notes', setActiveTab: vi.fn(), notebooks: [] as never, selectedNotebookId: 'a', onSelectNotebook: vi.fn(), onOpenCommands: vi.fn(), notebooksToggle: { open: false, controls: 'browse-notebooks', onToggle } })));
  expect(screen.getByRole('button', { name: 'Expand notebooks' })).toHaveAttribute('aria-expanded', 'false');
});

it('shows no notebooks toggle where the page has no notebooks column', () => {
  header(false);
  expect(screen.queryByRole('button', { name: /notebooks$/ })).toBeNull();
});
