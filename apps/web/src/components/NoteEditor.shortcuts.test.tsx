// @vitest-environment jsdom
import { type ChangeEvent, createElement, forwardRef, useImperativeHandle } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { PanelProvider } from '../lib/panel-context.js';
import { NoteEditor } from './NoteEditor.js';
import type { MarkdownEditorHandle } from './MarkdownEditor.js';

vi.mock('./MarkdownEditor.js', () => ({
  MarkdownEditor: forwardRef<MarkdownEditorHandle, { content: string; mode: string; readOnly: boolean; compact?: boolean; onChange: (content: string) => void; }>(({ content, mode, readOnly, compact, onChange }, ref) => {
    useImperativeHandle(ref, () => ({
      insert: (text, at) => {
        const position = at ?? content.length;
        onChange(content.slice(0, position) + text + content.slice(position));
      },
      insertAnnotated() {},
      revealRange() {},
      goToLine() {},
      getCurrentLine: () => 1,
      getSelection: () => null,
      ready: () => true,
      focus() {},
    }), [content, onChange]);
    return createElement('textarea', { 'aria-label': 'Note content', value: content, readOnly, 'data-compact': compact ? 'true' : undefined, 'data-mode': mode, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value) });
  }),
}));

afterEach(cleanup);

const note = { id: 'a', path: 'notes/a/a.md', notebookId: 'a', title: 'Alpha', tags: [], metadata: { title: 'Alpha' }, content: '# Alpha\n' };

it('takes Ctrl+F from the browser to open find in note in zoom and in a Focus pane, since the browser cannot find text the editor has not drawn', () => {
  for (const frame of ['pane', 'zoom', 'inline'] as const) {
    // A Focus pane shows its note's panel in the rail it is given, so the pane reports the section it opens.
    const onChange = vi.fn();
    const documentPanel = frame === 'pane' ? { target: null, mode: null, onChange } : undefined;
    render(createElement(PanelProvider, null, createElement(NoteEditor, { note, frame, active: true, documentPanel, statuses: [], onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main' })));
    const event = new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(event);
    });
    if (frame === 'zoom') expect(document.querySelector('aside.note-document-panel')?.getAttribute('data-panel')).toBe('find');
    if (frame === 'pane') expect(onChange).toHaveBeenCalledWith('find');
    expect(event.defaultPrevented).toBe(frame !== 'inline');
    cleanup();
  }
});

it('opens the note commands leader on Ctrl+Shift+E in zoom and in a Focus pane, not in an inline editor', () => {
  for (const frame of ['pane', 'zoom', 'inline'] as const) {
    render(createElement(PanelProvider, null, createElement(NoteEditor, { note, frame, active: true, statuses: [], onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main' })));
    const event = new KeyboardEvent('keydown', { key: 'E', code: 'KeyE', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(event);
    });
    expect(Boolean(screen.queryByRole('dialog', { name: 'Note commands' }))).toBe(frame !== 'inline');
    expect(event.defaultPrevented).toBe(frame !== 'inline');
    cleanup();
  }
});
