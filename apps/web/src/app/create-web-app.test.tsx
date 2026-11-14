// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { listFamilies, registerThemes } from '../lib/themes.js';

vi.mock('../App.js', () => ({ AppContent: () => null }));
vi.mock('../pwa/register.js', () => ({ registerServiceWorker: vi.fn() }));

const { createWebApp, PALETTE_FAMILIES } = await import('./create-web-app.js');

afterEach(() => registerThemes({}));

it('registers the edition themes before it renders', () => {
  const root = document.createElement('div');
  createWebApp(root, { themes: { families: [{ ...PALETTE_FAMILIES[0], id: 'ocean', name: 'Ocean' }], defaultFamily: 'ocean' } });
  expect(listFamilies().at(-1)?.id).toBe('ocean');
});

it('throws, rendering nothing, when the default family is unknown', () => {
  const root = document.createElement('div');
  expect(() => createWebApp(root, { themes: { defaultFamily: 'missing' } })).toThrow(/missing/);
  expect(root.childElementCount).toBe(0);
});
