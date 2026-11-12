// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  // Each test starts before the icon set has loaded.
  vi.resetModules();
  document.body.innerHTML = '';
});
afterEach(() => {
  document.body.innerHTML = '';
});

it('draws a placeholder with the name and size before the icon set loads', async () => {
  const { inlineIconHtml } = await import('./inline-icon.js');
  document.body.innerHTML = inlineIconHtml('FileText', '20');
  const holder = document.querySelector<HTMLElement>('.lucide-icon')!;
  expect(holder.classList.contains('lucide-icon-pending')).toBe(true);
  expect(holder.title).toBe('FileText');
  expect(holder.dataset.size).toBe('20');
  expect(holder.querySelector('svg')!.getAttribute('width')).toBe('20');
});

it('redraws a placeholder with the real icon once the set has loaded, wherever it sits in the document', async () => {
  const { inlineIconHtml } = await import('./inline-icon.js');
  document.body.innerHTML = `<p>a ${inlineIconHtml('User', '16')} b ${inlineIconHtml('no-such-icon')} c</p>`;
  await vi.waitFor(() => expect(document.querySelector('.lucide-icon-pending')).toBeNull());
  const [known, unknown] = [...document.querySelectorAll<HTMLElement>('.lucide-icon')];
  expect(known.querySelector('circle')!.getAttribute('r')).toBe('4');
  expect(known.querySelector('svg')!.getAttribute('width')).toBe('16');
  expect(known.classList.contains('lucide-icon-missing')).toBe(false);
  expect(unknown.classList.contains('lucide-icon-missing')).toBe(true);
  expect(unknown.title).toBe('no-such-icon');
  expect(document.querySelector('p')!.textContent).toBe('a  b  c');
});

it('draws the real icon at once when the set is already there', async () => {
  const { loadLucideIcons } = await import('./lucide-registry.js');
  const { inlineIconHtml } = await import('./inline-icon.js');
  await loadLucideIcons();
  expect(inlineIconHtml('User')).not.toContain('lucide-icon-pending');
});
