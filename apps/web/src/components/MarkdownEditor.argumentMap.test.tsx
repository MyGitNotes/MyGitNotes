// @vitest-environment jsdom
import { createElement, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { renderArgumentMap } from '../lib/argument-maps/render.js';
import { en } from '../lib/i18n/en.js';
import { zhTW } from '../lib/i18n/zh-TW.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { MarkdownEditor } from './MarkdownEditor.js';

beforeEach(() => {
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(cleanup);

function Editor({ initial, mode }: { initial: string; mode: 'live' | 'raw'; }) {
  const [content, setContent] = useState(initial);
  return createElement(MarkdownEditor, { content, path: 'notes/a.md', mode, readOnly: false, onChange: setContent, ariaLabel: 'Note content' });
}

describe('the Insert argument map button', () => {
  it('inserts a working example as a block of its own in the live editor and shows its figure', async () => {
    const { container } = render(createElement(I18nProvider, null, createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, {}, createElement(Editor, { initial: 'first\nsecond', mode: 'live' })))));
    const view = EditorView.findFromDOM(await screen.findByRole('textbox', { name: 'Note content' }, { timeout: 5000 }))!;
    view.dispatch({ selection: { anchor: 6 } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert argument map' }));
    expect(view.state.doc.toString()).toBe(`first\n\n${en['argumentMap.template'].trimEnd()}\n\nsecond`);
    expect(container.querySelector('.live-md-argument-map figure.am-figure')).not.toBeNull();
    expect(container.querySelector('.am-error')).toBeNull();
  });

  it('inserts the same block in the source editor', () => {
    render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, {}, createElement(Editor, { initial: 'first\n\n\nsecond', mode: 'raw' }))));
    const textarea = screen.getByLabelText<HTMLTextAreaElement>('Note content');
    textarea.setSelectionRange(7, 7);
    fireEvent.click(screen.getByRole('button', { name: 'Insert argument map' }));
    expect(textarea.value).toBe(`first\n\n${en['argumentMap.template'].trimEnd()}\n\nsecond`);
  });

  it('has a template in each language that renders without an error', () => {
    for (const [strings, language, undercut] of [[en, 'en', 'Undercuts'], [zhTW, 'zh-TW', '削弱']] as const) {
      const html = renderArgumentMap(strings['argumentMap.template'], { renderInline: markdown => markdown, language });
      expect(html).toContain('am-figure');
      expect(html).toContain(`<span class="am-badge">${undercut}</span>`);
    }
  });
});
