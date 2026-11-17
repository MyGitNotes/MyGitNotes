// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { LAST_NOTEBOOK_STORAGE_PREFIX, openingNotebook, readLastNotebook, rememberLastNotebook } from './last-notebook.js';

const config = { workspace: { default_notebook: 'notes~a' }, notebooks: [{ id: 'notes~a' }, { id: 'code~src' }] };

beforeEach(() => localStorage.clear());

describe('openingNotebook', () => {
  it('opens the notebook the route names, whatever was remembered', () => {
    expect(openingNotebook({ routed: 'notes~a', remembered: 'code~src', config })).toBe('notes~a');
    // A route naming a notebook the workspace lacks still names it, so the page can say it was not found.
    expect(openingNotebook({ routed: 'gone~x', remembered: 'code~src', config })).toBe('gone~x');
  });
  it('opens the remembered notebook when the route names none', () => {
    expect(openingNotebook({ routed: undefined, remembered: 'code~src', config })).toBe('code~src');
  });
  it('falls back to the default notebook when the workspace does not list the remembered one', () => {
    expect(openingNotebook({ routed: undefined, remembered: 'gone~x', config })).toBe('notes~a');
  });
  it('opens the default notebook, then the first, when nothing was remembered', () => {
    expect(openingNotebook({ routed: undefined, remembered: null, config })).toBe('notes~a');
    expect(openingNotebook({ routed: undefined, remembered: null, config: { workspace: { default_notebook: '' }, notebooks: [{ id: 'code~src' }] } })).toBe('code~src');
  });
  it('judges nothing before the workspace has loaded', () => {
    expect(openingNotebook({ routed: undefined, remembered: 'code~src', config: null })).toBe('example');
  });
});

describe('the remembered notebook', () => {
  it('is kept per workspace', () => {
    rememberLastNotebook('local:/notes', 'code~src');
    rememberLastNotebook('github:me/other@main', 'other~b');
    expect(localStorage.getItem(`${LAST_NOTEBOOK_STORAGE_PREFIX}local:/notes`)).toBe('code~src');
    expect(readLastNotebook('local:/notes')).toBe('code~src');
    expect(readLastNotebook('github:me/other@main')).toBe('other~b');
  });
});
