// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { saveNote } from './api.js';
import { mutateFile } from './files-api.js';
import { NoteFrontmatterUnreadableError } from '@mygitnotes/core/frontmatter';
import { en } from './i18n/en.js';
import { zhTW } from './i18n/zh-TW.js';

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = '';
});

// A write the server refuses because the note's frontmatter cannot be read reads as the editor's own message, in the
// reader's language, wherever it is shown: a save, or a rename that writes a title.
it('names a refusal for unreadable frontmatter in the reader’s language', async () => {
  document.documentElement.lang = 'zh-TW';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'The frontmatter cannot be read: in the note\'s text, fix the YAML between its first "---" line and the closing "---" line.', code: 'frontmatter-invalid' }), { status: 409 })));
  await expect(saveNote({ path: 'notes/a.md', content: 'x', metadata: { status: 'done' } })).rejects.toMatchObject({ status: 409, code: 'frontmatter-invalid', message: '標頭屬性無法解析：請在筆記內文中，修正開頭「---」行與結尾「---」行之間的 YAML。' });
  await expect(mutateFile({ kind: 'move', notebookId: 'nb', path: 'notes/a.md', destination: 'notes/b.md', title: 'B' })).rejects.toMatchObject({ status: 409, message: '標頭屬性無法解析：請在筆記內文中，修正開頭「---」行與結尾「---」行之間的 YAML。' });
});

// FM-F005: the refusal says how to fix the block in the note's text, not in the YAML view the direct editor locks on such
// a note; the server's words and the editor's are the same.
it('words the refusal the same on the server and in the editor, without sending anyone to the YAML view', () => {
  expect(new NoteFrontmatterUnreadableError().message).toBe(en['editor.frontmatterInvalidLive']);
  for (const message of [en['editor.frontmatterInvalidLive'], zhTW['editor.frontmatterInvalidLive']]) {
    expect(message).not.toMatch(/YAML view|YAML 檢視/);
    expect(message).toContain('---');
  }
});
