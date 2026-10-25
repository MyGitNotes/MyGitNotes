// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../lib/i18n/index.js';
import { Header } from './Header.js';

beforeEach(() => window.localStorage.setItem('github-notes:language', 'en'));
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const header = (navOnly: boolean) => render(createElement(I18nProvider, null, createElement(Header, { workspaceTitle: 'Work', activeTab: 'notes', setActiveTab: vi.fn(), notebooks: [{ id: 'a', title: 'Alpha' }] as never, selectedNotebookId: 'a', onSelectNotebook: vi.fn(), onCreateNote: vi.fn(), onOpenCommands: vi.fn(), navOnly })));

it('keeps only the bottom navigation when a phone draws its own bars', () => {
  header(true);
  const nav = screen.getByRole('navigation', { name: 'Main navigation' });
  expect(nav.querySelectorAll('button')).toHaveLength(5);
  expect(screen.getByRole('button', { name: 'New Note' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Work' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Notebooks' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Quick open' })).toBeNull();
});

it('shows the brand, the notebook switcher and the utilities as before', () => {
  header(false);
  expect(screen.getByRole('heading', { name: 'Work' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Notebooks' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Quick open' })).toBeInTheDocument();
});
