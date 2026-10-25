import { describe, expect, it } from 'vitest';
import { demoLanguageOf, notebookScenario, parseDemoPath, scenarioNotebook } from './demo.js';

describe('parseDemoPath', () => {
  it('reads the scenario slug of /demo/<scenario> and below it', () => {
    expect(parseDemoPath('/demo')).toEqual({});
    expect(parseDemoPath('/demo/')).toEqual({});
    expect(parseDemoPath('/demo/trpg')).toEqual({ scenario: 'trpg' });
    expect(parseDemoPath('/demo/trpg/notebooks/demo~trpg-en/notes/a.md')).toEqual({ scenario: 'trpg' });
  });
  it('is null outside the demo and ignores a slug that is not one', () => {
    expect(parseDemoPath('/')).toBeNull();
    expect(parseDemoPath('/notebooks/demo')).toBeNull();
    expect(parseDemoPath('/demonstration')).toBeNull();
    expect(parseDemoPath('/demo/UPPER')).toEqual({});
    expect(parseDemoPath('/demo/-x')).toEqual({});
  });
});

describe('scenarioNotebook', () => {
  const keys = ['demo~contract-zh-tw', 'demo~trpg-zh-tw', 'demo~plain'];
  it('finds the notebook whose local id is the scenario or starts with it and a dash', () => {
    expect(scenarioNotebook(keys, 'trpg')).toBe('demo~trpg-zh-tw');
    expect(scenarioNotebook(keys, 'plain')).toBe('demo~plain');
    expect(scenarioNotebook(keys, 'TRPG')).toBe('demo~trpg-zh-tw');
  });
  it('answers nothing for an unknown scenario and does not match a prefix without the dash', () => {
    expect(scenarioNotebook(keys, 'nope')).toBeUndefined();
    expect(scenarioNotebook(keys, 'con')).toBeUndefined();
    expect(scenarioNotebook(keys, 'tr')).toBeUndefined();
  });
});

describe('demo language and scenario names', () => {
  it('maps the UI language to the cookie language', () => {
    expect(demoLanguageOf('zh-TW')).toBe('zh-tw');
    expect(demoLanguageOf('en')).toBe('en');
  });
  it('names the scenario of a notebook without its language suffix', () => {
    expect(notebookScenario('demo~trpg-zh-tw')).toBe('trpg');
    expect(notebookScenario('demo~contract-en')).toBe('contract');
    expect(notebookScenario('demo~plain')).toBe('plain');
  });
});
