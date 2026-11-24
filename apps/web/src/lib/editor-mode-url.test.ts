import { describe, expect, it } from 'vitest';
import { editorModeOf, searchWithEditorMode, shownEditorMode } from './editor-mode-url.js';

describe('the editor mode in the query string', () => {
  it('reads ?mode=live|source|split, and live when the URL names none or an unknown one', () => {
    expect(editorModeOf('?mode=source')).toBe('raw');
    expect(editorModeOf('?q=x&mode=split')).toBe('split');
    expect(editorModeOf('?mode=live')).toBe('live');
    expect(editorModeOf('')).toBe('live');
    expect(editorModeOf('?mode=raw')).toBe('live');
    expect(editorModeOf('?mode=SPLIT')).toBe('live');
  });

  it('writes source and split, leaves live (the default) out, and keeps every other parameter in its place', () => {
    expect(searchWithEditorMode('?returnTo=%2Fnotebooks%2Flife&q=a+b', 'split')).toBe('?returnTo=%2Fnotebooks%2Flife&q=a+b&mode=split');
    expect(searchWithEditorMode('?mode=split&q=1', 'raw')).toBe('?mode=source&q=1');
    expect(searchWithEditorMode('?q=1&mode=source&tag=x', 'live')).toBe('?q=1&tag=x');
    expect(searchWithEditorMode('?mode=source', 'live')).toBe('');
    expect(searchWithEditorMode('', 'live')).toBe('');
    // A bare parameter stays bare.
    expect(searchWithEditorMode('?zoom&mode=split', 'raw')).toBe('?zoom&mode=source');
    expect(searchWithEditorMode('?zoom', 'split')).toBe('?zoom&mode=split');
    expect(searchWithEditorMode('?mode=split&zoom&mode=live', 'live')).toBe('?zoom');
  });

  it('shows split on desktop and falls back to live on a phone', () => {
    expect(shownEditorMode('split', false)).toBe('split');
    expect(shownEditorMode('split', true)).toBe('live');
    expect(shownEditorMode('raw', true)).toBe('raw');
  });
});
