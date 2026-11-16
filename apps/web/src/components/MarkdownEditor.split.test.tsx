// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../lib/i18n/index.js';
import { MarkdownEditor } from './MarkdownEditor.js';

beforeEach(() => sessionStorage.clear());
afterEach(cleanup);

function Editor({ initial }: { initial: string; }) {
  const [content, setContent] = useState(initial);
  return createElement(MarkdownEditor, { content, path: 'notes/a.md', mode: 'split', readOnly: false, onChange: setContent, ariaLabel: 'Note content' });
}
const open = (initial: string) => render(createElement(I18nProvider, null, createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, {}, createElement(Editor, { initial })))));

describe('split view', () => {
  it('shows the source editor beside the note rendered by the app pipeline, which follows the typing', async () => {
    const { container } = open('# Title\n\n:::info\nInside\n:::\n');
    const source = screen.getByLabelText<HTMLTextAreaElement>('Note content');
    expect(source.tagName).toBe('TEXTAREA');
    const preview = container.querySelector<HTMLElement>('[data-split-preview]')!;
    expect(preview).not.toBeNull();
    await waitFor(() => expect(preview.querySelector('h1')?.textContent).toBe('Title'));
    expect(preview.querySelector('.custom-directive.info-directive')).not.toBeNull();
    expect(preview.querySelector('h1')).toHaveAttribute('data-source-line', '1');
    // The source comes first, the preview second, with the divider between them.
    const panes = [...container.querySelector('[data-split-view]')!.children].map(child => child.getAttribute('data-split-part'));
    expect(panes).toEqual(['source', 'divider', 'preview']);

    fireEvent.change(source, { target: { value: '# Renamed\n\nBody' } });
    await waitFor(() => expect(preview.querySelector('h1')?.textContent).toBe('Renamed'));
    expect(preview.querySelector('p')).toHaveAttribute('data-source-line', '3');
  });

  it('turns scroll sync on and off from a button on the divider, linked by default and kept for the session', () => {
    const { container, unmount } = open('# Title\n');
    const divider = container.querySelector('[data-split-part="divider"]')!;
    const sync = screen.getByRole('button', { name: 'Sync scrolling' });
    expect(divider.contains(sync)).toBe(true);
    expect(sync).toHaveAttribute('aria-pressed', 'true');
    expect(sync).toHaveAttribute('title', 'Scrolling is linked: click to unlink');
    act(() => fireEvent.click(sync));
    expect(sync).toHaveAttribute('aria-pressed', 'false');
    expect(sync).toHaveAttribute('title', 'Scrolling is unlinked: click to link');
    unmount();
    // Another split view in the same session starts unlinked, and the choice is no part of the URL.
    open('# Title\n');
    expect(screen.getByRole('button', { name: 'Sync scrolling' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('names the sync button in Traditional Chinese', () => {
    localStorage.setItem('github-notes:language', 'zh-TW');
    try {
      open('# Title\n');
      const sync = screen.getByRole('button', { name: '同步捲動' });
      expect(sync).toHaveAttribute('title', '捲動已連動：按一下解除');
    } finally {
      localStorage.removeItem('github-notes:language');
    }
  });
});
