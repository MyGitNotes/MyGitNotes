// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { I18nProvider } from '../lib/i18n/index.js';
import { PALETTE_FAMILIES } from '../lib/palettes.js';
import { registerThemes } from '../lib/themes.js';
import { ThemeSelector } from './ThemeSelector.js';

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.setItem('github-notes:language', 'en');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  registerThemes({});
});

const names = () => [...container.querySelectorAll('[role="radiogroup"]:last-child button')].map(button => button.textContent);
const mount = () => act(async () => root.render(createElement(I18nProvider, null, createElement(ThemeSelector, { value: { familyId: 'flexoki', mode: 'light' }, onChange: () => {} }))));

it('lists the built-in families', async () => {
  await mount();
  expect(names()).toEqual(PALETTE_FAMILIES.map(family => family.name));
});

it('lists a registered family after the built-ins', async () => {
  registerThemes({ families: [{ ...PALETTE_FAMILIES[0], id: 'ocean', name: 'Ocean' }] });
  await mount();
  expect(names()).toEqual([...PALETTE_FAMILIES.map(family => family.name), 'Ocean']);
});
