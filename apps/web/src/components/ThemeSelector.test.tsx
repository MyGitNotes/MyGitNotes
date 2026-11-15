// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { I18nProvider } from '../lib/i18n/index.js';
import { PALETTE_FAMILIES } from '../lib/palettes.js';
import { EINK_FAMILY_ID, registerThemes, setEReaderDetected, type ThemeChoice } from '../lib/themes.js';
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
  setEReaderDetected(false);
  localStorage.clear();
  registerThemes({});
});

const names = () => [...container.querySelectorAll('[role="radiogroup"]:last-child button')].map(button => button.textContent);
const mount = (value: ThemeChoice = { familyId: 'flexoki', mode: 'light' }, onChange: (choice: ThemeChoice) => void = () => {}) => act(async () => root.render(createElement(I18nProvider, null, createElement(ThemeSelector, { value, onChange }))));
const checkedFamily = () => container.querySelector('[role="radiogroup"]:last-child [aria-checked="true"]')?.textContent;
const modeButtons = () => [...container.querySelectorAll<HTMLButtonElement>('[role="radiogroup"]:first-of-type button')];

it('lists the built-in families', async () => {
  await mount();
  expect(names()).toEqual(PALETTE_FAMILIES.map(family => family.name));
});

it('lists a registered family after the built-ins', async () => {
  registerThemes({ families: [{ ...PALETTE_FAMILIES[0], id: 'ocean', name: 'Ocean' }] });
  await mount();
  expect(names()).toEqual([...PALETTE_FAMILIES.map(family => family.name), 'Ocean']);
});

it('names the e-ink family in the chosen language', async () => {
  localStorage.setItem('github-notes:language', 'zh-TW');
  await mount();
  expect(names()).toContain('電子紙（高對比）');
});

it('says when an e-reader brought e-ink, marks it chosen, and offers the way back to the standard theme', async () => {
  setEReaderDetected(true);
  const chosen: ThemeChoice[] = [];
  await mount({ familyId: 'flexoki', mode: 'system' }, choice => chosen.push(choice));
  expect(container.textContent).toContain('E-reader detected, so the E-ink theme is in use.');
  expect(checkedFamily()).toBe('E-ink (high contrast)');
  const back = [...container.querySelectorAll('button')].find(button => button.textContent === 'Use the standard theme')!;
  await act(async () => back.click());
  expect(chosen).toEqual([{ familyId: 'flexoki', mode: 'system' }]);
});

it('shows no notice when e-ink was chosen or no e-reader was detected', async () => {
  await mount({ familyId: EINK_FAMILY_ID, mode: 'system' });
  expect(container.textContent).not.toContain('E-reader detected');
  expect(checkedFamily()).toBe('E-ink (high contrast)');
});

it('disables the light and dark choice while e-ink is shown', async () => {
  await mount({ familyId: EINK_FAMILY_ID, mode: 'system' });
  expect(modeButtons().map(button => button.disabled)).toEqual([true, true, true]);
  await mount({ familyId: 'flexoki', mode: 'system' });
  expect(modeButtons().map(button => button.disabled)).toEqual([false, false, false]);
});
