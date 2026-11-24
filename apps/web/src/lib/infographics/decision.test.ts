// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { draw } from './note-test-helpers.js';

const decision = (body: string) => `:::decision{title="這組變數能用來調整嗎？" subtitle="後門準則：兩題都過關才行"}\n${body}\n:::`;
const shallow = '- 一？\n  - 是｜a\n  - 否｜b';
const deep = (n: number) =>
  [
    '- 問 1？',
    ...Array.from({ length: n }, (_, i) => {
      const indent = '  '.repeat(i + 1);
      return `${indent}- 否｜結論\n${indent}- 是｜${i + 1 < n ? `問 ${i + 2}？` : '結論'}`;
    }),
  ].join('\n');

describe('decision', () => {
  it('draws one numbered trunk, ending branches first, with steps, highlighted and loop results, and math', () => {
    const doc = draw(decision(`- 候選的一組變數 $Z$ 裡，有 $X$ 的後代嗎？｜先列出 $Z$
  - 沒有 $C$｜$Z$ 堵住 $X$ 與 $Y$ 之間的所有路徑嗎？｜拿掉 $X$ 指出去的箭頭
    - 是｜**可以：按 $Z$ 分組平均，就得到干預的值**
    - 否｜**↺ 換一組 $Z$，回到第一題**
  - 有｜不符合後門準則，例如含復健班名冊 $C$`));
    expect(doc.querySelector('figure.ig-decision')?.getAttribute('lang')).toBe('en');
    expect([...doc.querySelectorAll('.ig-question-num')].map(node => node.textContent)).toEqual(['1', '2']);
    expect(doc.querySelector('.ig-question[style="--ig-i:0"] > .ig-question-step + .ig-question-text .ig-question-body')?.querySelectorAll('.note-math')).toHaveLength(2);
    expect(doc.querySelector('.ig-decision-tree > .ig-branches > .ig-branch:first-child > .ig-branch-result .note-math')).not.toBeNull();
    expect(doc.querySelector('.ig-decision-tree > .ig-branches > .ig-branch:last-child')?.classList.contains('is-next')).toBe(true);
    expect(doc.querySelector('.is-next > .ig-branch-label .note-math')).not.toBeNull();
    expect(doc.querySelector('.is-next > .ig-question > .ig-question-step .note-math')).not.toBeNull();
    expect(doc.querySelector('.is-next > .ig-question + .ig-branches .ig-branch-result.is-highlight > strong .note-math')).not.toBeNull();
    const loop = doc.querySelector('.ig-branch-result.is-loop.is-highlight');
    expect(loop?.firstElementChild?.className).toBe('ig-loop-mark');
    expect(loop?.querySelector('strong .note-math')).not.toBeNull();
    expect(loop?.textContent?.match(/↺/g)).toHaveLength(1);
  });

  it('renders a single-question decision with two conclusions', () => {
    const doc = draw(decision(shallow));
    expect(doc.querySelectorAll('.ig-question-num')).toHaveLength(1);
    expect(doc.querySelectorAll('.ig-branch-result')).toHaveLength(2);
    expect(doc.querySelector('.ig-branch.is-next')).toBeNull();
  });

  it('supports five questions and CommonMark indentation for ordered or loose lists', () => {
    expect(draw(decision(deep(5))).querySelector('.ig-question[style="--ig-i:4"] .ig-question-num')?.textContent).toBe('5');
    const doc = draw(decision('10. 問題？\n\n    - 是｜另一題？\n\n      - 是｜a\n      - 否｜b\n    - 否｜c'));
    expect(doc.querySelectorAll('.ig-question')).toHaveLength(2);
  });

  it.each([['multiple roots', `${shallow}\n- 二？\n  - 是｜a\n  - 否｜b`, /exactly one root question/], ['extra content', `段落\n\n${shallow}`, /takes only one list/], ['directive label', '', /takes only one list/], ['another list', `${shallow}\n\n* 另一個清單`, /takes only one list/], ['no branches', '- 一？', /2 or 3 branches/], ['one branch', '- 一？\n  - 是｜a', /2 or 3 branches/], ['four branches', `${shallow}\n  - 丙｜c\n  - 丁｜d`, /2 or 3 branches/], ['missing branch content', '- 一？\n  - 是\n  - 否｜b', /branch needs 分支標籤｜內容/], ['four branch fields', '- 一？\n  - 是｜a｜b｜c\n  - 否｜b', /at most 分支標籤｜內容｜做法/], ['step on a conclusion', '- 一？\n  - 是｜a｜做法\n  - 否｜b', /conclusion takes 分支標籤｜結論/], ['empty branch label', '- 一？\n  - ｜a\n  - 否｜b', /empty field/], ['empty root step', shallow.replace('一？', '一？｜'), /empty field/], ['three root fields', shallow.replace('一？', '一？｜做法｜多'), /root question takes 問題｜做法/], ['two continuing branches', '- 一？\n  - 是｜二？\n    - 對｜a\n    - 錯｜b\n  - 否｜三？\n    - 對｜a\n    - 錯｜b', /one branch per question can lead/], ['loop in root question', shallow.replace('一？', '↺ 一？'), /↺ only starts a conclusion/], ['loop in branch label', shallow.replace('是｜', '↺ 是｜'), /↺ only starts a conclusion/], ['loop in step', deep(2).replace('問 2？', '問 2？｜↺'), /↺ only starts a conclusion/], ['loop in next question', deep(2).replace('問 2？', '↺ 問 2？'), /↺ only starts a conclusion/], ['loop mid-conclusion', shallow.replace('是｜a', '是｜a ↺ b'), /↺ only starts a conclusion in a decision/], ['second loop marker', shallow.replace('是｜a', '是｜↺ a ↺ b'), /↺ only starts a conclusion in a decision/], ['second paragraph', shallow.replace('是｜a', '是｜a\n\n    多一段'), /only one line and an optional list/], ['six questions', deep(6), /at most 5 questions/]])('shows the infographic error for %s', (label, body, message) => {
    const source = label === 'directive label' ? decision(shallow).replace(':::decision{', ':::decision[Label]{') : decision(body);
    const doc = draw(`Before.\n\n${source}\n\nAfter.`);
    expect(doc.querySelector('.ig-error-message')?.textContent ?? '').toMatch(message);
    expect(doc.querySelector('figure')).toBeNull();
    expect(doc.body.textContent).toMatch(/Before\.[\s\S]*After\./);
  });
});
