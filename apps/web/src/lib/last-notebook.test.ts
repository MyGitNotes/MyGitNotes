// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetLastNotebook, LAST_NOTEBOOK_STORAGE_PREFIX, openingNotebook, readLastNotebook, rememberLastNotebook } from './last-notebook.js';

const config = { workspace: { default_notebook: 'notes~a' }, notebooks: [{ id: 'notes~a' }, { id: 'code~src' }] };

beforeEach(() => localStorage.clear());

describe('openingNotebook', () => {
  it('opens the notebook the route names, whatever was remembered', () => {
    expect(openingNotebook({ routed: 'notes~a', remembered: 'code~src', config })).toEqual({ notebook: 'notes~a', stale: false });
    // A route naming a notebook the workspace lacks still names it, so the page can say it was not found.
    expect(openingNotebook({ routed: 'gone~x', remembered: 'code~src', config })).toEqual({ notebook: 'gone~x', stale: false });
  });
  it('opens the remembered notebook when the route names none', () => {
    expect(openingNotebook({ routed: undefined, remembered: 'code~src', config })).toEqual({ notebook: 'code~src', stale: false });
  });
  it('falls back to the default notebook, marking the remembered one stale, when the workspace no longer serves it', () => {
    expect(openingNotebook({ routed: undefined, remembered: 'gone~x', config })).toEqual({ notebook: 'notes~a', stale: true });
  });
  it('opens the default notebook, then the first, when nothing was remembered', () => {
    expect(openingNotebook({ routed: undefined, remembered: null, config })).toEqual({ notebook: 'notes~a', stale: false });
    expect(openingNotebook({ routed: undefined, remembered: null, config: { workspace: { default_notebook: '' }, notebooks: [{ id: 'code~src' }] } })).toEqual({ notebook: 'code~src', stale: false });
  });
  it('judges nothing before the workspace has loaded', () => {
    expect(openingNotebook({ routed: undefined, remembered: 'code~src', config: null })).toEqual({ notebook: 'example', stale: false });
  });
});

describe('the remembered notebook', () => {
  it('is kept per workspace, and forgetting it leaves other workspaces alone', () => {
    rememberLastNotebook('local:/notes', 'code~src');
    rememberLastNotebook('github:me/other@main', 'other~b');
    expect(localStorage.getItem(`${LAST_NOTEBOOK_STORAGE_PREFIX}local:/notes`)).toBe('code~src');
    expect(readLastNotebook('local:/notes')).toBe('code~src');
    forgetLastNotebook('local:/notes');
    expect(readLastNotebook('local:/notes')).toBeNull();
    expect(readLastNotebook('github:me/other@main')).toBe('other~b');
  });
});
