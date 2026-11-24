// @vitest-environment node
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { createNoteRenderer } from '../markdown.js';

const { window } = new JSDOM('');
const { renderNote } = createNoteRenderer({ parser: new window.DOMParser() as unknown as DOMParser, purify: createDOMPurify(window as unknown as Window & typeof globalThis), language: 'en' });
const draw = (source: string) => new window.DOMParser().parseFromString(renderNote(source, 'n.md'), 'text/html');
const process = (body: string) => `::::process{title="一期識報的一天"}\n${body}\n::::`;
const stage = (title: string, body = '') => `:::stage{title="${title}"}\n${body ? `${body}\n` : ''}:::`;

// Examples and rejection cases from the blog's directive guide and test-infographics.mjs.
describe('process', () => {
  it('draws stages in one figure with times, item math and highlights', () => {
    const source = process(`:::stage{title="記者交稿" time="03:00–04:30"}\n- 國際｜歐美、中東\n- **評析 $X$**｜由 Blog 編輯撰寫 $Y$\n- 三\n- 四\n- 五\n:::\n:::stage{title="識報總編" time="05:30" highlight}\n- 逐一查證｜每個事實都回到來源\n:::`);
    const doc = draw(source);
    const stages = doc.querySelectorAll('figure.ig-process > .ig-body > ol.ig-process > li.ig-stage');
    expect(stages).toHaveLength(2);
    expect(stages[0].getAttribute('style')).toBe('--ig-i:0');
    expect(stages[0].querySelector('.ig-stage-time')?.textContent).toBe('03:00–04:30');
    expect(stages[0].querySelectorAll('.ig-stage-items.is-many > li')).toHaveLength(5);
    expect(stages[0].querySelectorAll('.ig-stage-item.is-highlight .note-math')).toHaveLength(2);
    expect(stages[1].classList.contains('is-highlight')).toBe(true);
  });

  it.each([
    ['no stages', '- a', /process needs :::stage children/],
    ['untitled stage', ':::stage\n- a\n:::', /every process stage needs a title/],
    ['blank title', stage('  '), /every process stage needs a title/],
  ])('shows the infographic error for %s', (_label, body, message) => {
    const doc = draw(`Before.\n\n${process(body)}\n\nAfter.`);
    expect(doc.querySelector('.ig-error-message')?.textContent ?? '').toMatch(message);
    expect(doc.querySelector('figure')).toBeNull();
    expect(doc.body.textContent).toMatch(/Before\.[\s\S]*After\./);
  });
});
