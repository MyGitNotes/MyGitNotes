// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { writeVimMode } from '../../lib/vim-mode.js';
import { FileSourceEditor } from '../FileSourceEditor.js';
import { MarkdownEditor } from '../MarkdownEditor.js';

beforeEach(() => {
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => {
  cleanup();
  writeVimMode(false);
  localStorage.clear();
});

const vimEditor = () => document.querySelector('.cm-editor')?.getAttribute('data-vim-mode') ?? null;

it('gives the file source editor Vim keys as Settings turns them on, and takes them away as it turns them off', () => {
  render(createElement(FileSourceEditor, { path: 'src/a.ts', content: 'const a = 1;\n', readOnly: false, label: 'Source', onChange: () => {} }));
  expect(vimEditor()).toBeNull();
  act(() => writeVimMode(true));
  expect(vimEditor()).toBe('normal');
  expect(document.querySelector('.cm-vim-panel')).not.toBeNull();
  act(() => writeVimMode(false));
  expect(vimEditor()).toBeNull();
});

it('opens live preview with Vim keys when they are on, and leaves the source mode a plain text box', async () => {
  writeVimMode(true);
  const mount = (mode: 'live' | 'raw') => render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, {}, createElement(MarkdownEditor, { content: '# Alpha\n', path: 'notes/a.md', mode, readOnly: false, onChange: () => {}, ariaLabel: 'Note content' }))));
  mount('live');
  await waitFor(() => expect(vimEditor()).toBe('normal'));
  cleanup();
  mount('raw');
  expect(screen.getByLabelText('Note content').tagName).toBe('TEXTAREA');
  expect(vimEditor()).toBeNull();
});
