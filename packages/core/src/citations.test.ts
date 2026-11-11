import { describe, expect, it } from 'vitest';
import { type Citation, type CitationEntry, findCitations, formatCitation } from './citations.js';

const entries = new Map<string, CitationEntry>([['sosa2007', { key: 'sosa2007', authors: ['Sosa'], year: '2007', title: 'A Virtue Epistemology' }], ['two2010', { key: 'two2010', authors: ['Smith', 'Doe'], year: '2010', title: 'Two' }], ['three2011', { key: 'three2011', authors: ['Smith', 'Doe', 'Roe'], year: '2011', title: 'Three' }], ['王2015', { key: '王2015', authors: ['王小明'], year: '2015', title: '知識論' }], ['a', { key: 'a', authors: ['A'], year: '2001', title: 'A' }], ['b', { key: 'b', authors: ['B'], year: '2002', title: 'B' }]]);

/** Each citation as `kind:source -> key[,locator]; …`, so a case reads as one line. */
function found(text: string): string[] {
  return findCitations(text).map(c => `${c.kind}:${text.slice(c.from, c.to)} -> ${c.items.map(i => i.locator === undefined ? i.key : `${i.key}|${i.locator}`).join('; ')}`);
}

function shown(text: string): (string | undefined)[] {
  return findCitations(text).map(c => formatCitation(c, entries));
}

describe('findCitations', () => {
  it('reads each form md-cites accepts', () => {
    expect(found('甲 [@a]。')).toEqual(['group:[@a] -> a']);
    expect(found('[@a; @b, 23]')).toEqual(['group:[@a; @b, 23] -> a; b|23']);
    expect(found('[@a, 頁 23] 乙')).toEqual(['group:[@a, 頁 23] -> a|頁 23']);
    expect(found('[-@a]')).toEqual(['year:[-@a] -> a']);
    expect(found('[-@a, 23]')).toEqual(['year:[-@a, 23] -> a|23']);
    expect(found('[23][@a]')).toEqual(['cmarker:[23][@a] -> a|23']);
    expect(found('如@a.')).toEqual(['narrative:@a -> a']);
    expect(found('所說，@a [45] 也')).toEqual(['narrative:@a [45] -> a|45']);
    expect(found('@a 指出')).toEqual(['narrative:@a -> a']);
    expect(found('`@a` 與 [@王2020]')).toEqual(['group:[@王2020] -> 王2020']);
  });

  it('ends a key at trailing punctuation and keeps inner : . / -', () => {
    expect(found('see @sosa2007.')).toEqual(['narrative:@sosa2007 -> sosa2007']);
    expect(found('[@doi:10.1/x-y]')).toEqual(['group:[@doi:10.1/x-y] -> doi:10.1/x-y']);
    expect(found('@a(2007)')).toEqual(['narrative:@a -> a']);
  });

  it('takes CJK right after a bare key as part of the key, as md-cites does', () => {
    expect(found('@a指出')).toEqual(['narrative:@a指出 -> a指出']);
  });

  it('leaves emails, URLs, escapes, links and footnotes alone', () => {
    expect(found('a@b.com')).toEqual([]);
    expect(found('https://x/@u')).toEqual([]);
    expect(found('https://x.com/?q=@u&r=@v')).toEqual([]);
    expect(found('\\@a')).toEqual([]);
    expect(found('[@a](https://x)')).toEqual([]);
    expect(found('@a [text](https://x)')).toEqual(['narrative:@a -> a']);
    expect(found('x[^1] @a [^2]')).toEqual(['narrative:@a -> a']);
    expect(found('[@a]: https://x')).toEqual([]);
    expect(found('   [@a]: https://x "t"')).toEqual([]);
  });

  it('skips code spans, fenced code, HTML comments and front matter', () => {
    expect(found('`[@a]` x')).toEqual([]);
    expect(found('```\n@a\n[@a]\n```\n[@b]')).toEqual(['group:[@b] -> b']);
    expect(found('~~~\n[@a]\n~~~')).toEqual([]);
    expect(found('<!-- [@a] @b --> [@b]')).toEqual(['group:[@b] -> b']);
    expect(found('<!--\n[@a]\n-->\n[@b]')).toEqual(['group:[@b] -> b']);
    expect(found('---\ntitle: "[@a]"\nowner: @b\n---\n[@b]')).toEqual(['group:[@b] -> b']);
  });

  it('refuses the forms md-cites stops on', () => {
    expect(found('[see @a]')).toEqual([]);
    expect(found('[@a; -@b]')).toEqual([]);
    expect(found('[@a 23]')).toEqual([]);
    expect(found('[@a; see @b]')).toEqual([]);
  });

  it('reports ranges in the whole text', () => {
    const text = '第一行\n第二行 [@a] 與 @b。';
    const [group, narrative] = findCitations(text) as [Citation, Citation];
    expect(text.slice(group.from, group.to)).toBe('[@a]');
    expect(text.slice(narrative.from, narrative.to)).toBe('@b');
    expect(group.from).toBe(8);
  });

  it('finds several citations on one line, as md-cites would', () => {
    expect(found('[@a] 與 [@b]，另見 @a。')).toEqual(['group:[@a] -> a', 'group:[@b] -> b', 'narrative:@a -> a']);
    // md-cites takes the character after `]` with the group, so the `@b` that follows is not read.
    expect(found('[@a]@b')).toEqual(['group:[@a] -> a']);
  });
});

describe('formatCitation', () => {
  it('copies the default author-date style', () => {
    expect(shown('[@sosa2007]')).toEqual(['(Sosa 2007)']);
    expect(shown('[@sosa2007, 23]')).toEqual(['(Sosa 2007, 23)']);
    expect(shown('[@two2010]')).toEqual(['(Smith 及 Doe 2010)']);
    expect(shown('[@three2011]')).toEqual(['(Smith 等 2011)']);
    expect(shown('[@王2015]')).toEqual(['(王小明 2015)']);
    expect(shown('[@a; @b]')).toEqual(['(A 2001; B 2002)']);
    expect(shown('[-@sosa2007]')).toEqual(['(2007)']);
    expect(shown('[23][@sosa2007]')).toEqual(['(Sosa 2007, 23)']);
    expect(shown('@two2010 指出')).toEqual(['Smith 及 Doe (2010)']);
    expect(shown('@sosa2007 [23] 指出')).toEqual(['Sosa (2007, 23)']);
  });

  it('answers undefined when any key is missing', () => {
    expect(shown('[@missing]')).toEqual([undefined]);
    expect(shown('[@a; @missing]')).toEqual([undefined]);
  });

  it('falls back to the title without authors and says when the year is unknown', () => {
    const lookup = new Map<string, CitationEntry>([['x', { key: 'x', authors: [], year: '', title: 'Report' }]]);
    expect(formatCitation(findCitations('[@x]')[0]!, lookup)).toBe('(Report n.d.)');
  });
});
