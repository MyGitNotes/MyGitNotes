import { describe, expect, it } from 'vitest';
import { DEMO_BASE, demoLanguage, demoNotebooks, demoPageRequest, demoScenarioOf } from './demo.js';
import type { WorkspaceConfig } from './types.js';

const request = (cookie?: string | string[]) => ({ headers: cookie === undefined ? {} : { cookie } });
const notebook = (id: string) => ({ id, title: id, root: `notes/${id}` });
const config = (ids: string[], defaultNotebook: string): WorkspaceConfig => ({ schema_version: 4, workspace: { title: 'Demo', default_notebook: defaultNotebook }, notebooks: ids.map(notebook) as WorkspaceConfig['notebooks'] });

describe('demoLanguage', () => {
  it('reads the language from the demo cookie among other cookies', () => {
    expect(demoLanguage(request('a=1; mygitnotes_demo=zh-tw; b=2'))).toBe('zh-tw');
    expect(demoLanguage(request(['a=1', 'mygitnotes_demo=en']))).toBe('en');
  });
  it('is case-insensitive in the value and ignores garbage, a missing cookie and a lookalike name', () => {
    expect(demoLanguage(request('mygitnotes_demo=ZH-TW'))).toBe('zh-tw');
    expect(demoLanguage(request('mygitnotes_demo=fr'))).toBeUndefined();
    expect(demoLanguage(request('mygitnotes_demo='))).toBeUndefined();
    expect(demoLanguage(request('xmygitnotes_demo=en; garbage; ;='))).toBeUndefined();
    expect(demoLanguage(request())).toBeUndefined();
  });
});

describe('demoScenarioOf', () => {
  it('splits a language suffix off a notebook id', () => {
    expect(demoScenarioOf('trpg-zh-tw')).toEqual({ scenario: 'trpg', language: 'zh-tw' });
    expect(demoScenarioOf('trpg-en')).toEqual({ scenario: 'trpg', language: 'en' });
    expect(demoScenarioOf('trpg')).toEqual({ scenario: 'trpg' });
    expect(demoScenarioOf('en')).toEqual({ scenario: 'en' });
  });
});

describe('demoNotebooks', () => {
  it('keeps one twin per scenario in the asked language and moves the default to its twin', () => {
    const kept = demoNotebooks(config(['contract-en', 'contract-zh-tw', 'trpg-en', 'trpg-zh-tw'], 'contract-en'), 'zh-tw');
    expect(kept.notebooks.map(item => item.id)).toEqual(['contract-zh-tw', 'trpg-zh-tw']);
    expect(kept.workspace.default_notebook).toBe('contract-zh-tw');
  });
  it('falls back to the -en twin, then to the first, and keeps notebooks without a language suffix', () => {
    const kept = demoNotebooks(config(['a-en', 'b-zh-tw', 'plain'], 'plain'), 'zh-tw');
    expect(kept.notebooks.map(item => item.id)).toEqual(['a-en', 'b-zh-tw', 'plain']);
    expect(kept.workspace.default_notebook).toBe('plain');
    expect(demoNotebooks(config(['b-zh-tw'], 'b-zh-tw'), 'en').notebooks.map(item => item.id)).toEqual(['b-zh-tw']);
  });
  it('does not change the manifest it was given', () => {
    const original = config(['a-en', 'a-zh-tw'], 'a-en');
    demoNotebooks(original, 'zh-tw');
    expect(original.notebooks).toHaveLength(2);
  });
});

describe('demoPageRequest', () => {
  const from = (referer?: string | string[]) => ({ headers: referer === undefined ? {} : { referer } });

  it('is true for a request that comes from the demo page or under it, whichever origin the page names', () => {
    for (const referer of ['https://h/demo', 'https://h/demo/', 'https://h/demo/trpg', 'https://h/demo/trpg/notebooks/x?y=1#z', 'http://localhost:5173/demo/notes', 'https://evil.example/demo']) expect(demoPageRequest(from(referer)), referer).toBe(true);
  });

  it('is false for any other page, a lookalike path, and a Referer that names no demo path outside its path', () => {
    for (const referer of ['https://h/demonstration', 'https://h/demo-x/a', 'https://h/', 'https://h', 'https://h/notes?r=/demo', 'https://h/notes#/demo', 'https://h/Demo', 'https://h/a/demo', 'https://h/demo%2Fx', 'https://h/x/../notes', 'https://demo/']) expect(demoPageRequest(from(referer)), referer).toBe(false);
  });

  it('judges the path as the browser resolved it, so dot segments cannot reach the demo path from another page', () => {
    expect(demoPageRequest(from('https://h/notes/../demo/trpg'))).toBe(true);
    expect(demoPageRequest(from('https://h/demo/../notes'))).toBe(false);
  });

  it('is false for a missing, empty, malformed or repeated Referer', () => {
    for (const referer of [undefined, '', ' ', 'not a url', '/demo', '//demo', 'demo', 'javascript:/demo', 'file:///demo', 'ftp://h/demo', ['https://h/demo', 'https://h/demo']]) expect(demoPageRequest(from(referer as string | string[] | undefined)), String(referer)).toBe(false);
  });

  it('shares the base the web app uses for the demo address', () => {
    expect(DEMO_BASE).toBe('/demo');
  });
});
