// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { saveNote } from './api.js';
import { mutateFile } from './files-api.js';

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = '';
});

// A write the server refuses because the note's frontmatter cannot be read reads as the editor's own message, in the
// reader's language, wherever it is shown: a save, or a rename that writes a title.
it('names a refusal for unreadable frontmatter in the reader’s language', async () => {
  document.documentElement.lang = 'zh-TW';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'The frontmatter cannot be read: fix it in the YAML view or the editor.', code: 'frontmatter-invalid' }), { status: 409 })));
  await expect(saveNote({ path: 'notes/a.md', content: 'x', metadata: { status: 'done' } })).rejects.toMatchObject({ status: 409, code: 'frontmatter-invalid', message: '標頭屬性無法解析，請在 YAML 檢視或編輯器中修正。' });
  await expect(mutateFile({ kind: 'move', notebookId: 'nb', path: 'notes/a.md', destination: 'notes/b.md', title: 'B' })).rejects.toMatchObject({ status: 409, message: '標頭屬性無法解析，請在 YAML 檢視或編輯器中修正。' });
});
