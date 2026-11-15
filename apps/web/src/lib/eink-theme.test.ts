// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, EINK_FAMILY_ID, familyTokens, getFamily, getThemeChoice, getThemeView, listFamilies, registerThemes, setEReaderDetected, setThemeChoice } from './themes.js';

const root = () => document.documentElement;
/** A new visit: the registry and the saved choice are read again from storage. */
const reload = () => registerThemes({});

beforeEach(() => {
  localStorage.clear();
  setEReaderDetected(false);
  reload();
});
afterEach(() => {
  localStorage.clear();
  setEReaderDetected(false);
  reload();
});

describe('e-ink family', () => {
  it('is a built-in listed in the pickers', () => {
    expect(listFamilies().map(family => family.id)).toContain(EINK_FAMILY_ID);
    expect(getFamily(EINK_FAMILY_ID).name).toBe('E-ink (high contrast)');
  });

  it('has no text token other than pure black and nothing that is not white behind it', () => {
    for (const mode of ['light', 'dark'] as const) {
      const tokens = familyTokens(getFamily(EINK_FAMILY_ID), mode);
      for (const name of ['--color-text', '--color-muted', '--color-primary', '--color-primary-hover', '--color-link', '--color-danger', '--color-warning', '--color-success', '--color-info', '--color-line', '--color-line-strong', '--color-border', '--color-scrim']) {
        expect(tokens[name], `${mode} ${name}`).toBe('#000000');
      }
      for (const name of Object.keys(tokens).filter(name => /^--color-(?:accent|status)-/.test(name))) expect(tokens[name], `${mode} ${name}`).toBe('#000000');
      for (const name of ['--color-bg', '--color-surface', '--color-sidebar', '--color-code-bg', '--color-primary-soft', '--color-danger-soft', '--color-warning-soft', '--color-success-soft', '--color-info-soft', '--surface-glass']) {
        expect(tokens[name], `${mode} ${name}`).toBe('#ffffff');
      }
      for (const name of ['--color-on-primary', '--color-on-primary-hover', '--color-on-danger', '--color-on-warning', '--color-on-success', '--color-on-info']) {
        expect(tokens[name], `${mode} ${name}`).toBe('#ffffff');
      }
    }
  });

  it('has no shadow, blur or translucent token', () => {
    const tokens = familyTokens(getFamily(EINK_FAMILY_ID), 'light');
    for (const name of ['--shadow-sm', '--shadow-md', '--shadow-lg', '--surface-blur']) expect(tokens[name], name).toBe('none');
    for (const [name, value] of Object.entries(tokens)) {
      expect(value, name).not.toMatch(/color-mix|rgba?\(|gradient|#[0-9a-f]{8}\b/i);
    }
  });

  it('is shown light whatever the mode choice says', () => {
    setThemeChoice({ familyId: EINK_FAMILY_ID, mode: 'dark' });
    applyTheme(getThemeChoice());
    expect(root().getAttribute('data-theme')).toBe(EINK_FAMILY_ID);
    expect(root().getAttribute('data-theme-mode')).toBe('light');
    expect(root().classList.contains('dark')).toBe(false);
  });

  it('takes its own tokens off when another family is applied', () => {
    applyTheme({ familyId: EINK_FAMILY_ID, mode: 'light' });
    expect(root().style.getPropertyValue('--shadow-md')).toBe('none');
    expect(root().style.getPropertyValue('--color-line')).toBe('#000000');
    applyTheme({ familyId: 'flexoki', mode: 'light' });
    expect(root().style.getPropertyValue('--shadow-md')).toBe('');
    expect(root().style.getPropertyValue('--color-line')).toBe('');
  });

  it('turns off motion, shadows and blur in its stylesheet', () => {
    const css = fs.readFileSync(path.resolve('apps/web/src/eink.css'), 'utf8');
    expect(css).toMatch(/\[data-theme='eink'\][^{]*\{[^}]*transition-duration: 0s !important/);
    expect(css).toMatch(/\[data-theme='eink'\][^{]*\{[^}]*animation-duration: 1ms !important/);
    expect(css).toMatch(/\[data-theme='eink'\][^{]*\{[^}]*box-shadow: none !important/);
    expect(css).toMatch(/\[data-theme='eink'\][^{]*\{[^}]*backdrop-filter: none !important/);
    expect(fs.readFileSync(path.resolve('apps/web/src/app/create-web-app.tsx'), 'utf8')).toContain("import '../eink.css';");
  });
});

describe('automatic e-ink on an e-reader', () => {
  it('applies e-ink while the choice is the untouched default', () => {
    setEReaderDetected(true);
    expect(getThemeView()).toEqual({ choice: { familyId: 'flexoki', mode: 'system' }, familyId: EINK_FAMILY_ID, auto: true });
    applyTheme(getThemeChoice());
    expect(root().getAttribute('data-theme')).toBe(EINK_FAMILY_ID);
  });

  it('keeps the saved preference as it was and caches the e-ink colours for the first paint', () => {
    setEReaderDetected(true);
    applyTheme(getThemeChoice());
    expect(localStorage.getItem('github_notes_theme')).toBe('flexoki');
    expect(localStorage.getItem('github_notes_theme_mode')).toBe('system');
    expect(JSON.parse(localStorage.getItem('github_notes_theme_tokens')!).tokens['--color-muted']).toBe('#000000');
  });

  it('applies the default family where no e-reader is detected', () => {
    expect(getThemeView()).toEqual({ choice: { familyId: 'flexoki', mode: 'system' }, familyId: 'flexoki', auto: false });
  });

  it('leaves a family chosen before alone', () => {
    localStorage.setItem('github_notes_theme', 'gruvbox');
    localStorage.setItem('github_notes_theme_mode', 'dark');
    reload();
    setEReaderDetected(true);
    expect(getThemeView()).toMatchObject({ familyId: 'gruvbox', auto: false });
  });

  it('applies over a default family and mode an older visit saved without a choice', () => {
    localStorage.setItem('github_notes_theme', 'flexoki');
    localStorage.setItem('github_notes_theme_mode', 'system');
    reload();
    setEReaderDetected(true);
    expect(getThemeView()).toMatchObject({ familyId: EINK_FAMILY_ID, auto: true });
  });

  it('yields to an explicit choice, even of the default family, and remembers it on the next visit', () => {
    setEReaderDetected(true);
    setThemeChoice({ familyId: 'flexoki', mode: 'system' });
    expect(getThemeView()).toMatchObject({ familyId: 'flexoki', auto: false });
    applyTheme(getThemeChoice());
    expect(root().getAttribute('data-theme')).toBe('flexoki');
    reload();
    expect(getThemeView()).toMatchObject({ familyId: 'flexoki', auto: false });
  });

  it('keeps e-ink chosen explicitly where no e-reader is detected, on the next visit too', () => {
    setThemeChoice({ familyId: EINK_FAMILY_ID, mode: 'system' });
    applyTheme(getThemeChoice());
    reload();
    expect(getThemeView()).toEqual({ choice: { familyId: EINK_FAMILY_ID, mode: 'system' }, familyId: EINK_FAMILY_ID, auto: false });
  });

  it('remembers a detected e-reader for the first render of the next visit', () => {
    setEReaderDetected(true);
    reload();
    expect(getThemeView().auto).toBe(true);
    setEReaderDetected(false);
    reload();
    expect(getThemeView().auto).toBe(false);
  });

  it('gives a new view object only when what it shows changes', () => {
    const first = getThemeView();
    expect(getThemeView()).toBe(first);
    setEReaderDetected(true);
    expect(getThemeView()).not.toBe(first);
  });
});
