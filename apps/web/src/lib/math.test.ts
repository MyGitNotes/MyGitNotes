// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderNote } from './markdown.js';
import { findMath, mathTailLength } from './math.js';

function mount(source: string) {
  return new DOMParser().parseFromString(renderNote(source, 'notes/n.md'), 'text/html').body;
}

/** The formulas KaTeX drew, with the TeX source their accessible label carries. */
function formulas(root: HTMLElement) {
  return [...root.querySelectorAll('.note-math')].filter(node => node.querySelector('.katex')).map(node => ({ display: !!node.querySelector('.katex-display'), tex: node.getAttribute('aria-label') }));
}

describe('findMath', () => {
  it('finds inline and display math with their positions', () => {
    expect(findMath('a $x$ b')).toEqual([{ from: 2, to: 5, tex: 'x', display: false }]);
    expect(findMath('$$\ny = 1\n$$')).toEqual([{ from: 0, to: 11, tex: 'y = 1', display: true }]);
    expect(findMath('see $$x$$ here')).toEqual([{ from: 4, to: 9, tex: 'x', display: true }]);
  });

  it('leaves prices, escaped dollars, and unclosed dollars as text', () => {
    expect(findMath('It costs $5 and $10 today.')).toEqual([]);
    expect(findMath('Pay $5, not $ 6$.')).toEqual([]);
    expect(findMath('literal \\$x\\$ here')).toEqual([]);
    expect(findMath('just one $ sign')).toEqual([]);
    expect(findMath('$$\na\n\nb\n$$')).toEqual([]);
  });

  it('keeps an escaped dollar inside a formula', () => {
    expect(findMath('$a \\$ b$')).toEqual([{ from: 0, to: 8, tex: 'a \\$ b', display: false }]);
  });
});

describe('mathTailLength', () => {
  it('counts the punctuation that closes a sentence or a phrase right after a formula, in either width', () => {
    expect(mathTailLength('$x$: next', 3)).toBe(1);
    expect(mathTailLength('$x$：下一句', 3)).toBe(1);
    expect(mathTailLength('($x$). Next', 4)).toBe(2);
    expect(mathTailLength('$x$。」他說', 3)).toBe(2);
    expect(mathTailLength('$x$, $y$;', 3)).toBe(1);
  });

  it('counts nothing where a space, a letter, a newline or the end follows', () => {
    expect(mathTailLength('$x$ : next', 3)).toBe(0);
    expect(mathTailLength('$x$ab', 3)).toBe(0);
    expect(mathTailLength('$x$\n: next', 3)).toBe(0);
    expect(mathTailLength('$x$', 3)).toBe(0);
  });
});

/**
 * KaTeX breaks an inline formula into inline blocks, and a browser may break a line between the last of them and the
 * text after it, so a colon right after a formula could land alone at the start of the next line.
 */
describe('punctuation right after a formula in rendered notes', () => {
  it('stays in one unbreakable run with the formula', () => {
    const root = mount('The energy is $E = mc^2$: it follows.');
    const run = root.querySelector('.note-math-run');
    expect(run?.querySelector('.note-math')).not.toBeNull();
    expect(run?.textContent?.endsWith(':')).toBe(true);
    expect(root.querySelector('p')?.textContent).toContain(': it follows.');
  });

  it('keeps a run of closing punctuation, full-width included, and escapes nothing it should not', () => {
    const root = mount('這個公式 $E=mc^2$：是質能等價（見 $x$）。');
    const runs = [...root.querySelectorAll('.note-math-run')].map(run => run.textContent!.slice(-2).replace(/[^：）。]/g, ''));
    expect(runs).toEqual(['：', '）。']);
  });

  it('leaves a formula with no punctuation after it, and a display formula, unwrapped', () => {
    expect(mount('Then $x$ and more.').querySelector('.note-math-run')).toBeNull();
    expect(mount('See $$y$$: here').querySelector('.note-math-run')).toBeNull();
    expect(mount('$$\ny\n$$\n\nDone.').querySelector('.note-math-run')).toBeNull();
  });
});

describe('math in rendered notes', () => {
  it('draws inline and display formulas instead of the dollar source', () => {
    const root = mount('Inline $x^2$ here.\n\n$$\n\\mathrm{ref}_a(t_1 + t_2) = \\mathrm{ref}_a(t_1) + \\mathrm{ref}_a(t_2)\n$$\n\nAfter $$y$$ too.');
    expect(root.textContent).not.toContain('$');
    expect(formulas(root)).toEqual([{ display: false, tex: 'x^2' }, { display: true, tex: '\\mathrm{ref}_a(t_1 + t_2) = \\mathrm{ref}_a(t_1) + \\mathrm{ref}_a(t_2)' }, { display: true, tex: 'y' }]);
  });

  it('renders the sample note formulas next to CJK punctuation and escapes', () => {
    const root = mount('「$p(9)$」由函數符號 $p$ 組成。於是 $|\\{\\text{Socrates}\\}| = \\text{Socrates}$。\n\n- (5\\*) 它是 $\\Box\\exists x Fx$ 與 $\\#(F)$。');
    expect(formulas(root).map(formula => formula.tex)).toEqual(['p(9)', 'p', '|\\{\\text{Socrates}\\}| = \\text{Socrates}', '\\Box\\exists x Fx', '\\#(F)']);
    expect(root.querySelector('.katex-error')).toBeNull();
  });

  it('keeps code and prices literal', () => {
    const root = mount('Costs $5 and $10.\n\n`$x$` in code\n\n```\n$$y$$\n```');
    expect(formulas(root)).toEqual([]);
    expect(root.textContent).toContain('Costs $5 and $10.');
    expect(root.querySelector('code')?.textContent).toBe('$x$');
    expect(root.querySelector('pre')?.textContent).toContain('$$y$$');
  });

  it('renders formulas inside tables and directive bodies', () => {
    expect(formulas(mount('| a | b |\n| - | - |\n| $x$ | 1 |'))).toEqual([{ display: false, tex: 'x' }]);
    expect(formulas(mount(':::info\nSee $y$.\n:::'))).toEqual([{ display: false, tex: 'y' }]);
  });

  it('stays safe through the sanitizer', () => {
    const root = mount('$\\href{javascript:alert(1)}{x}$ and $<img src=x onerror=alert(1)>$ and $$\\htmlClass{x}{y}$$');
    expect(root.querySelector('a, img, [href], [src], [onerror]')).toBeNull();
    expect(root.querySelector('.katex [class~="x"]')).toBeNull();
    expect(formulas(root).map(formula => formula.tex)).toEqual(['\\href{javascript:alert(1)}{x}', '<img src=x onerror=alert(1)>', '\\htmlClass{x}{y}']);
  });

  it('shows a bad formula as an error instead of breaking the note', () => {
    const root = mount('Broken $\\frac{1}$ formula, then more text.');
    expect(root.textContent).toContain('then more text.');
    expect(root.querySelector('.katex-error')?.textContent).toBe('\\frac{1}');
  });
});
