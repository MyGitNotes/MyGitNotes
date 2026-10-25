// @vitest-environment jsdom
import { createRef } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useNoteDocumentPanel } from './useNoteDocumentPanel.js';
import type { MarkdownEditorHandle } from '../MarkdownEditor.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("reopens a zoomed note's panel as the user left it, open on its last section or closed", () => {
  const props = { frame: 'zoom' as const, active: false, isMarkdown: true, content: '# Alpha', editorMode: 'raw' as const, setEditorMode: vi.fn(), editorRef: createRef<MarkdownEditorHandle>(), metadata: {}, notePath: 'notes/a.md', branch: 'main', readOnly: false };
  const first = renderHook(() => useNoteDocumentPanel(props));
  expect(first.result.current.notePanel).toBeNull();
  act(() => first.result.current.setNotePanel('history'));
  first.unmount();
  const second = renderHook(() => useNoteDocumentPanel({ ...props, notePath: 'notes/b.md' }));
  expect(second.result.current.notePanel).toBe('history');
  act(() => second.result.current.setNotePanel(null));
  second.unmount();
  expect(renderHook(() => useNoteDocumentPanel(props)).result.current.notePanel).toBeNull();
});

it('keeps panel drafts across content updates and resets navigation only when the document identity changes', () => {
  const editorRef = createRef<MarkdownEditorHandle>();
  const initialProps = { frame: 'zoom' as const, active: false, isMarkdown: true, content: '# Alpha\n\nalpha alpha alpha', editorMode: 'raw' as const, setEditorMode: vi.fn(), editorRef, metadata: {}, notePath: 'notes/a.md', branch: 'main', readOnly: false };
  const { result, rerender } = renderHook(props => useNoteDocumentPanel(props), { initialProps });
  act(() => {
    result.current.setNotePanel('find');
    result.current.setFindQuery('alpha');
    result.current.setYamlText('custom: draft');
    result.current.setNewFieldKey('draft');
    result.current.setTagInput('unfinished');
  });
  act(() => result.current.stepFind(2));
  expect(result.current.findIndex).toBe(2);
  rerender({ ...initialProps, content: '# Alpha\n\nalpha alpha alpha\nupdated' });
  expect(result.current.findIndex).toBe(2);
  expect(result.current.tagInput).toBe('unfinished');
  rerender({ ...initialProps, notePath: 'notes/b.md' });
  expect(result.current.findQuery).toBe('');
  expect(result.current.findIndex).toBe(0);
  expect(result.current.tagInput).toBe('');
  expect(result.current.yamlText).toBe('custom: draft');
  expect(result.current.newFieldKey).toBe('draft');
});

it('clamps a search selection when matches shrink and keeps the clamped selection when they grow again', () => {
  const revealRange = vi.fn();
  const editorRef = { current: { insert: vi.fn(), insertAnnotated: vi.fn(), revealRange, goToLine: vi.fn(), getCurrentLine: () => 1, getSelection: () => null, ready: () => true, focus() {} } };
  const initialProps = { frame: 'zoom' as const, active: false, isMarkdown: true, content: 'one one one', editorMode: 'raw' as const, setEditorMode: vi.fn(), editorRef, metadata: {}, notePath: 'notes/a.md', branch: 'main', readOnly: false };
  const { result, rerender } = renderHook(props => useNoteDocumentPanel(props), { initialProps });
  act(() => {
    result.current.setNotePanel('find');
    result.current.setFindQuery('one');
  });
  act(() => result.current.stepFind(2));
  expect(result.current.findIndex).toBe(2);
  rerender({ ...initialProps, content: 'one' });
  expect(result.current.findIndex).toBe(0);
  expect(revealRange).toHaveBeenLastCalledWith(0, 3);
  rerender(initialProps);
  expect(result.current.findIndex).toBe(0);
  act(() => result.current.stepFind(1));
  act(() => result.current.setFindQuery('on'));
  expect(result.current.findIndex).toBe(0);
});

it('leaves keys typed in help or quick open to them while a note is zoomed', () => {
  const props = { frame: 'zoom' as const, active: true, isMarkdown: true, content: '# Alpha', editorMode: 'raw' as const, setEditorMode: vi.fn(), editorRef: createRef<MarkdownEditorHandle>(), metadata: {}, notePath: 'notes/a.md', branch: 'main', readOnly: false };
  const { result } = renderHook(() => useNoteDocumentPanel(props));
  act(() => result.current.setNotePanel('outline'));
  act(() => result.current.setIsEditorLeaderOpen(true));
  const press = (target: EventTarget, init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  };
  for (const scope of ['help', 'palette']) {
    const surface = document.body.appendChild(document.createElement('div'));
    surface.setAttribute('data-key-scope', scope);
    const filter = surface.appendChild(document.createElement('input'));
    expect(press(filter, { key: 'f', code: 'KeyF' }).defaultPrevented).toBe(false);
    expect(press(filter, { key: '/', code: 'Slash' }).defaultPrevented).toBe(false);
    expect(press(filter, { key: 'Escape' }).defaultPrevented).toBe(false);
    expect(result.current.isEditorLeaderOpen).toBe(true);
    expect(result.current.notePanel).toBe('outline');
    surface.remove();
  }
  // Outside those surfaces the same Escape still closes the leader first.
  expect(press(document.body, { key: 'Escape' }).defaultPrevented).toBe(true);
  expect(result.current.isEditorLeaderOpen).toBe(false);
});

it('closes its panel on Escape, but leaves an Escape typed in the assistant dock beside it to the dock', () => {
  const props = { frame: 'zoom' as const, active: true, isMarkdown: true, content: '# Alpha', editorMode: 'raw' as const, setEditorMode: vi.fn(), editorRef: createRef<MarkdownEditorHandle>(), metadata: {}, notePath: 'notes/a.md', branch: 'main', readOnly: false };
  const { result } = renderHook(() => useNoteDocumentPanel(props));
  const dock = document.body.appendChild(document.createElement('div'));
  dock.className = 'assistant-dock';
  const message = dock.appendChild(document.createElement('textarea'));
  act(() => result.current.setNotePanel('history'));
  const escape = (target: Element) => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  };
  expect(escape(message).defaultPrevented).toBe(false);
  expect(result.current.notePanel).toBe('history');
  expect(escape(document.body).defaultPrevented).toBe(true);
  expect(result.current.notePanel).toBeNull();
  dock.remove();
});

it("switches a Markdown note between live preview and source from the leader's M, in a Focus pane too, and offers no M for other files", () => {
  const setEditorMode = vi.fn();
  const props = { frame: 'pane' as const, active: true, isMarkdown: true, content: '# Alpha', editorMode: 'live' as const, setEditorMode, editorRef: createRef<MarkdownEditorHandle>(), metadata: {}, notePath: 'notes/a.md', branch: 'main', readOnly: false };
  const press = (key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(event);
    });
    return event;
  };
  const { result, unmount } = renderHook(() => useNoteDocumentPanel(props));
  act(() => result.current.setIsEditorLeaderOpen(true));
  expect(press('m').defaultPrevented).toBe(true);
  expect(setEditorMode).toHaveBeenCalledWith('raw');
  expect(result.current.isEditorLeaderOpen).toBe(false);
  // Without the leader, M is an ordinary key.
  expect(press('m').defaultPrevented).toBe(false);
  unmount();
  const text = renderHook(() => useNoteDocumentPanel({ ...props, isMarkdown: false, notePath: 'notes/a.txt' }));
  act(() => text.result.current.setIsEditorLeaderOpen(true));
  expect(press('m').defaultPrevented).toBe(false);
  expect(setEditorMode).toHaveBeenCalledOnce();
});

it('leaves Escape to Vim outside normal mode and in its prompt, and closes the panel with it in normal mode', () => {
  const props = { frame: 'zoom' as const, active: true, isMarkdown: true, content: '# Alpha', editorMode: 'live' as const, setEditorMode: vi.fn(), editorRef: createRef<MarkdownEditorHandle>(), metadata: {}, notePath: 'notes/a.md', branch: 'main', readOnly: false };
  const { result } = renderHook(() => useNoteDocumentPanel(props));
  const editor = document.body.appendChild(document.createElement('div'));
  editor.className = 'cm-editor';
  const content = editor.appendChild(document.createElement('div'));
  const prompt = editor.appendChild(document.createElement('div'));
  prompt.className = 'cm-panels';
  const promptInput = prompt.appendChild(document.createElement('input'));
  const escape = (target: Element) => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  };
  act(() => result.current.setNotePanel('outline'));
  for (const mode of ['insert', 'visual', 'replace']) {
    editor.setAttribute('data-vim-mode', mode);
    expect(escape(content).defaultPrevented).toBe(false);
    expect(result.current.notePanel).toBe('outline');
  }
  editor.setAttribute('data-vim-mode', 'normal');
  expect(escape(promptInput).defaultPrevented).toBe(false);
  expect(result.current.notePanel).toBe('outline');
  expect(escape(content).defaultPrevented).toBe(true);
  expect(result.current.notePanel).toBeNull();
  editor.remove();
});
