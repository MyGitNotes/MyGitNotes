import { describe, expect, it } from 'vitest';
import { LIVE_DEFAULT_DRAFT_LINES } from './live-default-draft.js';
import { isEmptyLiveDraft } from './live-notes.js';

/* What counts as an empty draft, which a sweep or 「立即簽回」 discards (docs/specs/2026-11-15-builtin-live-editor §19.1). */

const titled = (body: string) => `---\ntitle: 會議\ntags: [a]\n---\n${body}`;

describe('isEmptyLiveDraft', () => {
  it('takes a body of whitespace, punctuation, Markdown markers or emoji alone as empty', () => {
    for (const body of ['', '   ', '\n\n  \n\t\n', '---', '---\n---\n', '- ', '-\n- \n* \n', '###', '# \n## \n', '…', '> \n> ', '| | |\n|---|---|\n| | |', '- [ ] ', '**  **', '😀', '😀🎉 👍🏽\n', '。，、！？']) {
      expect(isEmptyLiveDraft(body), JSON.stringify(body)).toBe(true);
      expect(isEmptyLiveDraft(titled(body)), `titled ${JSON.stringify(body)}`).toBe(true);
    }
  });

  it('takes a letter, a digit, one CJK character, an image or an embed as content', () => {
    // A digit counts even as the number of an ordered list item.
    for (const body of ['字', '1. ', 'a', '7', '١', 'é', '![](x.png)', '![]()', '<img src="x.png">', '<IMG src=x>', '<iframe src="https://example.test"></iframe>', '<video src=x>', '- 字', '😀 x']) {
      expect(isEmptyLiveDraft(body), JSON.stringify(body)).toBe(false);
      expect(isEmptyLiveDraft(titled(`\n${body}\n`)), `titled ${JSON.stringify(body)}`).toBe(false);
    }
  });

  it('never counts the frontmatter: a title or template fields alone are empty', () => {
    expect(isEmptyLiveDraft('---\ntitle: A long title with words 123\ndate: 2026-11-15\n---\n')).toBe(true);
    expect(isEmptyLiveDraft('---\ntitle: Only frontmatter\n---')).toBe(true);
    expect(isEmptyLiveDraft('---\r\ntitle: CRLF\r\n---\r\n\r\n  \r\n')).toBe(true);
  });

  it('judges only what is left once the lines of the initial body are removed', () => {
    const template = titled('# 週會\n\nKind: 週會, room: {{room}}\n\n## 待辦\n- \n');
    // Untouched, or with spaces, blank lines and markers typed around it: empty.
    expect(isEmptyLiveDraft(template, template)).toBe(true);
    expect(isEmptyLiveDraft(titled('# 週會\n\nKind: 週會, room: {{room}}\n   \n## 待辦\n- \n- \n---\n\n'), template)).toBe(true);
    // A line of the template with spaces around it is still the template's line.
    expect(isEmptyLiveDraft(titled('  # 週會  \n\nKind: 週會, room: {{room}}\n\n## 待辦\n- \n'), template)).toBe(true);
    // The frontmatter may change (a new title) and still nothing was written.
    expect(isEmptyLiveDraft(template.replace('title: 會議', 'title: 另一個標題'), template)).toBe(true);
    // Anything written in a line of its own, or into a template line, is content.
    expect(isEmptyLiveDraft(titled('# 週會\n\nKind: 週會, room: {{room}}\n\n## 待辦\n- 買牛奶\n'), template)).toBe(false);
    expect(isEmptyLiveDraft(titled('# 週會\n\nKind: 週會, room: 3F\n\n## 待辦\n- \n'), template)).toBe(false);
    // A template line written a second time is not the template's own line.
    expect(isEmptyLiveDraft(titled('# 週會\n# 週會\n\nKind: 週會, room: {{room}}\n\n## 待辦\n- \n'), template)).toBe(false);
  });

  it('judges the whole body without an initial text', () => {
    expect(isEmptyLiveDraft(titled('# 週會\n'))).toBe(false);
    expect(isEmptyLiveDraft(titled('# 週會\n'), undefined)).toBe(false);
    expect(isEmptyLiveDraft(titled('# 週會\n'), titled('# 週會\n'))).toBe(true);
  });

  it("takes the web's untouched new note as empty, in every shipped locale, without an initial text", () => {
    // The web files an untemplated new note as `# <untitled>\n\n<body>\n` (apps/web/src/lib/new-note.ts).
    const zh = titled('# 未命名\n\n在這裡寫下筆記。\n');
    const en = titled('# Untitled\n\nWrite your note here.\n');
    expect(isEmptyLiveDraft(zh)).toBe(true);
    expect(isEmptyLiveDraft(en)).toBe(true);
    expect(isEmptyLiveDraft('# 未命名\n\n在這裡寫下筆記。\n')).toBe(true);
    // In any order, with spaces around a line, blank and punctuation-only lines, or only one of the two lines.
    expect(isEmptyLiveDraft(titled('  在這裡寫下筆記。  \n\n---\n- \n# 未命名\n'))).toBe(true);
    expect(isEmptyLiveDraft(titled('# 未命名\n'))).toBe(true);
    expect(isEmptyLiveDraft(titled('Write your note here.\n'))).toBe(true);
  });

  it("takes one real character or a changed heading in the web's new note as content", () => {
    expect(isEmptyLiveDraft(titled('# 未命名\n\n在這裡寫下筆記。a\n'))).toBe(false);
    expect(isEmptyLiveDraft(titled('# 未命名\n\n在這裡寫下筆記。\n字\n'))).toBe(false);
    expect(isEmptyLiveDraft(titled('# 會議\n\n在這裡寫下筆記。\n'))).toBe(false);
    expect(isEmptyLiveDraft(titled('# Untitled draft\n\nWrite your note here.\n'))).toBe(false);
    // Whole lines only: a default line inside a longer line is not taken out.
    expect(isEmptyLiveDraft(titled('見 在這裡寫下筆記。\n'))).toBe(false);
    expect(isEmptyLiveDraft(titled('## 未命名\n'))).toBe(false);
    // Like an initial line, each default line is taken out once: written a second time it is content.
    expect(isEmptyLiveDraft(titled('# 未命名\n\n在這裡寫下筆記。\n在這裡寫下筆記。\n'))).toBe(false);
  });

  it("takes out only the initial text's lines when it has one, never the default lines on top", () => {
    const template = titled('## 待辦\n- \n');
    expect(isEmptyLiveDraft(titled('## 待辦\n- \n- \n'), template)).toBe(true);
    expect(isEmptyLiveDraft(titled('# 未命名\n\n在這裡寫下筆記。\n## 待辦\n- \n'), template)).toBe(false);
    expect(isEmptyLiveDraft(titled('# Untitled\n## 待辦\n- \n'), template)).toBe(false);
    expect(isEmptyLiveDraft(titled('# 未命名\n## 待辦\n- 買牛奶\n'), template)).toBe(false);
    // The web's placeholder as the initial text: typed a second time it is content, not a default line.
    const placeholder = titled('# 未命名\n\n在這裡寫下筆記。\n');
    expect(isEmptyLiveDraft(placeholder, placeholder)).toBe(true);
    expect(isEmptyLiveDraft(titled('# 未命名\n\n在這裡寫下筆記。\n在這裡寫下筆記。\n'), placeholder)).toBe(false);
  });

  it('lists the default lines it takes out', () => {
    expect(LIVE_DEFAULT_DRAFT_LINES).toEqual(expect.arrayContaining(['# 未命名', '在這裡寫下筆記。', '# Untitled', 'Write your note here.']));
  });
});
