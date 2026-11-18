// @vitest-environment node
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { Marked } from 'marked';
import { describe, expect, it } from 'vitest';
import { transformDirectives } from '../directives.js';
import { createNoteRenderer } from '../markdown.js';
import { childEdits, initialState } from './editor-state.js';
import { addableExtraChildren, addExtraChild } from './grid.js';
import { checkCells, childAttrGroups, parseInfographic, serializeInfographic } from './model.js';
import { renderInfographic } from './render.js';

// The ladder cases of the blog's scripts/test-infographics.mjs (wayne930242/knowledge-base at 9ec2058f), adapted:
// the same documents and assertions on the figure HTML, here from renderInfographic instead of the remark plugin.
const marked = new Marked();
const render = (source: string, language: 'zh-TW' | 'en' = 'zh-TW') => renderInfographic(source.endsWith('\n') ? source : `${source}\n`, { renderInline: field => marked.parseInline(field, { gfm: true }) as string, language });

const LADDER = `::::ladder{title="三層問題" subtitle="由下往上爬" note="外框加深的是入口"}
:::rung{title="第三層　事後假想" formula="已知 x′，求 P(y_x)" note="要知道：函數關係"}
- **07**｜反事實｜/posts/causal/lessons/07-counterfactuals/
- →
- 08｜實際因果｜/posts/causal/lessons/08-actual-causation/
:::
:::rung{title="第二層　行動" formula="P(y | do(x))"}
- **03**｜干預｜/posts/causal/lessons/03-intervention/
- bridge｜用第一層的資料回答第二層
- 05｜後門與前門｜/posts/causal/lessons/05-backdoor/
- →
- 06｜do 演算
:::
:::rung{title="第一層　看到"}
- **01**｜機率基礎｜https://example.com/01
:::
:::span
- 02｜不充分決定｜/posts/causal/lessons/02-underdetermination/
:::
:::footer{title="附錄"}
- 11｜模型遊樂場｜/causal/playground/
:::
::::
`;

// The blog's live 路線圖 (lessons/00-導論-如何看因果模型.mdx and 00-introduction-en.mdx).
const ROADMAP_ZH = `::::ladder{title="三層問題，十一篇講義" subtitle="由下往上爬：每上一層，要知道的比下一層多"}
:::rung{title="第三層　事後假想" formula="已知 x′、y′，求 P(y_x)" note="要知道：函數關係"}
- **07**｜反事實｜/posts/causal/lessons/07-counterfactuals/
- →
- 08｜實際因果｜/posts/causal/lessons/08-actual-causation/
- →
- 09｜常態、規範與責任｜/posts/causal/lessons/09-normality/
:::
:::rung{title="第二層　行動" formula="P(y | do(x))" note="要知道：因果結構"}
- **03**｜干預｜/posts/causal/lessons/03-intervention/
- 10｜因果決策理論｜/posts/causal/lessons/10-decision/
- bridge｜用第一層的資料回答第二層
- 05｜後門與前門｜/posts/causal/lessons/05-adjustment/
- →
- 06｜do 演算｜/posts/causal/lessons/06-do-calculus/
:::
:::rung{title="第一層　看到" formula="P(y | x)" note="要知道：聯合分布"}
- **01**｜機率基礎｜/posts/causal/lessons/01-probability-background/
- 04｜d 分隔｜/posts/causal/lessons/04-d-separation/
:::
:::span
- 02｜不充分決定：下層的資料定不了上層的答案｜/posts/causal/lessons/02-underdetermination/
:::
:::footer{title="附錄"}
- 11｜模型遊樂場｜/posts/causal/lessons/11-appendix-playground/
:::
::::
`;
const ROADMAP_EN = `::::ladder{title="Three levels, eleven lessons" subtitle="Climb from the bottom: each level needs more knowledge than the one below"}
:::rung{title="Level 3 · imagining" formula="given x′, y′, find P(y_x)" note="needs: the functions"}
- **07**｜Counterfactuals｜/en/posts/causal/lessons/07-counterfactuals-en/
- →
- 08｜Actual causation｜/en/posts/causal/lessons/08-actual-causation-en/
:::
:::rung{title="Level 2 · doing" formula="P(y | do(x))" note="needs: the causal structure"}
- **03**｜Intervention｜/en/posts/causal/lessons/03-intervention-en/
- bridge｜answer level-2 questions with level-1 data
- 05｜Back-door and front-door｜/en/posts/causal/lessons/05-adjustment-en/
:::
:::span
- 02｜What determines what｜/en/posts/causal/lessons/02-underdetermination-en/
:::
:::footer{title="Appendix"}
- 11｜Model playground｜/en/posts/causal/lessons/11-appendix-playground-en/
:::
::::
`;

describe('ladder (the blog plugin cases)', () => {
  it('renders rungs in order with cards, arrows, bridge, span and footer', () => {
    const html = render(LADDER);
    expect(html).toMatch(/<figure class="ig-figure ig-ladder" lang="zh-TW">/);
    expect(html).toMatch(/<div class="ig-ladder-frame has-span">/);
    expect([...html.matchAll(/class="ig-rung-title">([^<]*)</g)].map(m => m[1])).toEqual(['第三層　事後假想', '第二層　行動', '第一層　看到']);
    expect((html.match(/class="ig-rung"/g) ?? []).length).toBe(3);
    expect(html).toMatch(/class="ig-rung-formula">已知 x′，求 P\(y<sub>x<\/sub>\)<\/p>/);
    expect(html).toMatch(/class="ig-rung-need">要知道：函數關係</);
    expect(html).toMatch(/<a class="ig-card is-highlight" href="\/posts\/causal\/lessons\/07-counterfactuals\/"><span class="ig-card-num"><strong>07<\/strong><\/span><span class="ig-card-name">反事實<\/span><\/a>/);
    expect(html).toMatch(/反事實<\/span><\/a><span class="ig-ladder-arrow" aria-hidden="true">→<\/span><a class="ig-card"/);
    expect(html).toMatch(/<div class="ig-rung-bridge"><span class="ig-bridge-label">用第一層的資料回答第二層<\/span><a class="ig-card" href="[^"]*05-backdoor\/">.*?<span class="ig-ladder-arrow"[^>]*>→<\/span><span class="ig-card">.*do 演算.*<\/div>/);
    expect(html).toMatch(/干預<\/span><\/a><div class="ig-rung-bridge">/);
    expect(html).toMatch(/<span class="ig-card"><span class="ig-card-num">06</);
    expect(html).toMatch(/href="https:\/\/example.com\/01"/);
    expect(html).toMatch(/<a class="ig-ladder-span" href="[^"]*02-underdetermination\/">/);
    expect(html).toMatch(/<div class="ig-ladder-footer"><span class="ig-footer-title">附錄<\/span><a class="ig-card" href="\/causal\/playground\/">/);
    expect(html).toMatch(/說明：外框加深的是入口/);
  });

  it('without span or footer is a plain stack of rungs', () => {
    const html = render(`::::ladder\n:::rung{title="只有一層"}\n- 01｜機率\n:::\n::::`);
    expect(html).toMatch(/<div class="ig-ladder-frame">/);
    expect(html).not.toMatch(/ig-ladder-span|ig-ladder-footer|ig-rung-bridge/);
  });

  it('throws on malformed ladders, as the blog fails its build', () => {
    const bad = (body: string, pattern: RegExp) => expect(() => render(`::::ladder\n${body}\n::::`)).toThrow(pattern);
    expect(() => render('::::ladder\n::::')).toThrow(/ladder needs :::rung children/);
    bad(':::scenario\n- a｜b\n:::', /ladder takes only :::rung/);
    bad(':::rung\n- 01｜機率\n:::', /every ladder rung needs a title/);
    bad(':::rung{title="一"}\n:::', /needs at least one item/);
    bad(':::rung{title="一"}\n- 01\n:::', /every ladder item needs 編號｜名稱/);
    bad(':::rung{title="一"}\n- 01｜機率｜javascript:alert(1)\n:::', /must be a path or an http/);
    bad(':::rung{title="一"}\n- 01｜機率｜a b\n:::', /must be a path or an http/);
    bad(':::rung{title="一"}\n- →\n- 01｜機率\n:::', /arrow → must sit between two cards/);
    bad(':::rung{title="一"}\n- 01｜機率\n- →\n:::', /arrow → must sit between two cards/);
    bad(':::rung{title="一"}\n- bridge｜說明\n:::', /bridge needs cards/);
    bad(':::rung{title="一"}\n- 01｜a\n:::\n:::span\n- 02｜a\n- 03｜b\n:::', /:::span needs exactly one item/);
    bad(':::rung{title="一"}\n- 01｜a\n:::\n:::footer\n:::', /:::footer needs at least one item/);
  });
});

describe('ladder in notes', () => {
  it('takes a path relative to the note as a link, which the blog does not', () => {
    expect(render(`::::ladder\n:::rung{title="一"}\n- 01｜機率｜../lessons/01.md\n:::\n::::`)).toMatch(/<a class="ig-card" href="\.\.\/lessons\/01\.md">/);
  });

  it('marks the figure with the note language, so the bridge colon is half-width in English', () => {
    expect(render(ROADMAP_EN, 'en')).toMatch(/<figure class="ig-figure ig-ladder" lang="en">/);
    expect(render(ROADMAP_EN, 'en')).toMatch(/class="ig-rung-formula">given x′, y′, find P\(y<sub>x<\/sub>\)/);
  });

  it('writes y_{xz} as one subscript', () => {
    expect(render(`::::ladder\n:::rung{title="一" formula="P(y_{xz})"}\n- 01｜a\n:::\n::::`)).toContain('P(y<sub>xz</sub>)');
  });

  it('shows a malformed ladder as the inline error box instead of the figure', () => {
    const output = transformDirectives('before\n\n::::ladder\n:::rung{title="一"}\n- →\n:::\n::::\n\nafter', source => marked.parse(source) as string, source => marked.parseInline(source) as string, 'zh-TW');
    expect(output).toContain('ig-error');
    expect(output).toContain('arrow → must sit between two cards');
    expect(output).not.toContain('ig-ladder-frame');
    expect(output).toMatch(/before[\s\S]*after/);
  });

  it('resolves card links as the note resolves its other links', () => {
    const { window } = new JSDOM('');
    const renderer = createNoteRenderer({ parser: new window.DOMParser() as unknown as DOMParser, purify: createDOMPurify(window as unknown as Window & typeof globalThis), origin: 'https://app.example', language: 'zh-TW' });
    const document = new JSDOM(`<body>${renderer.renderNote(`::::ladder\n:::rung{title="一" formula="P(y_x)"}\n- **01**｜a｜./b.md\n- →\n- 02｜c｜https://example.com/c\n:::\n:::span\n- 03｜d｜/notes/d.md\n:::\n::::\n`, 'notes/n.md')}</body>`).window.document;
    const local = document.querySelector('a.ig-card.is-highlight');
    expect(local?.getAttribute('data-workspace-link')).toBe('./b.md');
    expect(local?.getAttribute('data-source-path')).toBe('notes/n.md');
    expect(document.querySelector('a.ig-card:not(.is-highlight)')?.getAttribute('data-workspace-link')).toBe('https://example.com/c');
    expect(document.querySelector('a.ig-ladder-span')?.getAttribute('data-workspace-link')).toBe('/notes/d.md');
    expect(document.querySelector('.ig-rung-formula sub')?.textContent).toBe('x');
    expect(document.querySelector('.ig-ladder-arrow')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('ladder model', () => {
  it.each([['DIRECTIVES_USAGE', LADDER], ['路線圖 zh', ROADMAP_ZH], ['roadmap en', ROADMAP_EN]])('round-trips the blog example %s unchanged', (_name, source) => {
    const block = parseInfographic(source);
    expect(block?.kind).toBe('ladder');
    expect(block?.problems).toEqual([]);
    expect(block?.children.map(child => child.name)).toEqual([...source.matchAll(/^:::(\w+)/gm)].map(m => m[1]));
    expect(serializeInfographic(block!)).toBe(source);
  });

  it('reports an unknown container inside a ladder', () => {
    expect(parseInfographic('::::ladder\n:::lane\n- a\n:::\n::::\n')?.problems.map(problem => problem.code)).toEqual(['unknown-container']);
  });

  it('checks the link column and leaves arrows and bridges alone', () => {
    const block = parseInfographic('::::ladder\n:::rung{title="一"}\n- 01｜a｜a b\n- →\n- 02｜b｜/x\n- bridge｜說明\n- 03｜c｜mailto:x@y\n:::\n::::\n')!;
    expect(checkCells(block)).toEqual([{ child: 0, row: 0, column: 2, code: 'not-a-link' }, { child: 0, row: 4, column: 2, code: 'not-a-link' }]);
  });

  it('gives each container its own attributes', () => {
    expect(childAttrGroups('ladder').essential.map(attr => attr.key)).toEqual(['title', 'formula', 'note']);
    expect(childAttrGroups('ladder', 'footer').essential.map(attr => attr.key)).toEqual(['title']);
    expect(childAttrGroups('ladder', 'span').essential).toEqual([]);
  });
});

describe('ladder editor state', () => {
  it('adds a rung, the span bar and the footer once each', () => {
    const block = parseInfographic('::::ladder\n:::rung{title="一"}\n- 01｜a\n:::\n::::\n')!;
    let state = initialState(block);
    expect(addableExtraChildren(state.block)).toEqual(['span', 'footer']);
    state = { ...state, ...childEdits.add()(state) };
    expect(state.block.children.map(child => child.name)).toEqual(['rung', 'rung']);
    state = { ...state, ...childEdits.addExtra('span')(state) };
    expect(state.tab).toBe(2);
    expect(addableExtraChildren(state.block)).toEqual(['footer']);
    expect(addExtraChild(state.block, 'span')).toBe(state.block);
    state = { ...state, ...childEdits.addExtra('footer')(state) };
    expect(serializeInfographic(state.block)).toBe('::::ladder\n:::rung{title="一"}\n- 01｜a\n:::\n:::rung\n-\n:::\n:::span\n-\n:::\n:::footer\n-\n:::\n::::\n');
  });

  it('removes and reorders containers and keeps the source otherwise', () => {
    let state = initialState(parseInfographic(ROADMAP_ZH)!);
    state = { ...state, ...childEdits.remove(3)(state) };
    expect(state.block.children.map(child => child.name)).toEqual(['rung', 'rung', 'rung', 'footer']);
    state = { ...state, ...childEdits.move(0, 1)(state) };
    expect(state.block.children[1].attrs.title).toBe('第三層　事後假想');
    expect(parseInfographic(serializeInfographic(state.block))?.problems).toEqual([]);
  });
});
