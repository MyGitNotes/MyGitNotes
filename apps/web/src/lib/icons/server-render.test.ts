// @vitest-environment node
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';
import { createNoteRenderer, loadLucideIcons } from '../markdown.js';

it('renders the real icon on a server, with no document, once loadLucideIcons has resolved', async () => {
  const { window } = new JSDOM('');
  const { renderNote } = createNoteRenderer({ parser: new window.DOMParser() as unknown as DOMParser, purify: createDOMPurify(window as never) });
  await loadLucideIcons();
  const html = renderNote(':icon{name="User"}', 'n.md');
  expect(html).not.toContain('lucide-icon-pending');
  expect(html).toContain('<path');
});
