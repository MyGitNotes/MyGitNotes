// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { draw } from './note-test-helpers.js';

const nested = (body: string) => `:::nested{title="三種可能性的包含關係" subtitle="由外往內愈來愈嚴格"}\n${body}\n:::`;

describe('nested', () => {
  it('nests each range inside the previous one and renders math in names and notes', () => {
    const doc = draw(nested(String.raw`- 概念上可能｜不自相矛盾
- **真正可能 $GP$**｜形上學上可能
- 自然律可能｜符合實際的自然律；$NP \subseteq GP$`));
    const outer = doc.querySelector('figure.ig-nested > .ig-body > ul.ig-nest > li.ig-ring');
    const middle = outer?.querySelector(':scope > ul.ig-nest > li.ig-ring.is-highlight');
    const inner = middle?.querySelector(':scope > ul.ig-nest > li.ig-ring');
    expect(outer?.querySelector('.ig-ring-name')?.textContent).toBe('概念上可能');
    expect(middle?.querySelector('.ig-ring-name > strong > .note-math')).not.toBeNull();
    expect(inner?.querySelector('.ig-ring-note .note-math')?.getAttribute('aria-label')).toBe(String.raw`NP \subseteq GP`);
    expect([outer, middle, inner].map(node => node?.getAttribute('style'))).toEqual(['--ig-i:0', '--ig-i:1', '--ig-i:2']);
  });

  it('permits five layers, omitted notes, and separators inside inline Markdown', () => {
    const doc = draw(nested(String.raw`- **外｜層**
- 普通｜**只有說明加粗**
- 中間｜公式 $a｜b$
- 近內｜*[甲｜乙](./b.md)*
- 最內`));
    expect(doc.querySelectorAll('.ig-ring')).toHaveLength(5);
    expect(doc.querySelectorAll('.ig-ring.is-highlight')).toHaveLength(1);
    expect(doc.querySelector('.ig-ring-name > strong')?.textContent).toBe('外｜層');
    expect(doc.querySelector('.ig-ring-note > a, .ig-ring-note > em > a')?.textContent).toBe('甲｜乙');
    expect(doc.querySelector('.ig-ring[style="--ig-i:4"] .ig-ring-note')).toBeNull();
  });

  it.each([
    ['one range', '- 只有一層', /2 to 5 ranges/],
    ['six ranges', '- a\n- b\n- c\n- d\n- e\n- f', /2 to 5 ranges/],
    ['a sublist', '- a\n  - b\n- c', /flat list written from outside in/],
    ['a second paragraph', '- a\n\n  多一段\n- b', /flat list written from outside in/],
    ['a third field', '- a｜b｜c\n- d', /名稱｜說明/],
    ['an empty name', '- ｜說明\n- d', /名稱｜說明/],
    ['an empty note', '- a｜\n- b', /名稱｜說明/],
    ['other content before the list', '段落\n\n- a\n- b', /takes only one list/],
    ['other content after the list', '- a\n- b\n\n段落', /takes only one list/],
    ['multiple lists', '- a\n\n* b', /takes only one list/],
  ])('shows the infographic error for %s', (_label, body, message) => {
    const doc = draw(`Before.\n\n${nested(body)}\n\nAfter.`);
    expect(doc.querySelector('.ig-error-message')?.textContent ?? '').toMatch(message);
    expect(doc.querySelector('figure')).toBeNull();
    expect(doc.body.textContent).toMatch(/Before\.[\s\S]*After\./);
  });
});
