// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AnnotateError, isAnnotateName, parseAnnotate } from './parse.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.md`, import.meta.url), 'utf8').replace(/\n$/, '');
const IMG = '![首頁](/raw-assets/a.png)';
const block = (...rows: string[]) => [':::annotate', IMG, '', ...rows, ':::'].join('\n');
const problems = (source: string) => parseAnnotate(source).rows.map(row => row.problems.map(problem => problem.code));

describe('isAnnotateName', () => {
  it('knows the directive name only', () => {
    expect(isAnnotateName('annotate')).toBe(true);
    expect(isAnnotateName('annotation')).toBe(false);
    expect(isAnnotateName('argument-map')).toBe(false);
  });
});

describe('parseAnnotate: the example block', () => {
  const parsed = parseAnnotate(fixture('review'));

  it('reads the label as the title and the first body line as the media', () => {
    expect(parsed.title).toBe('首頁 v3 設計審閱');
    expect(parsed.media).toMatchObject({ alt: '首頁 v3', src: '/raw-assets/by-hash/3f2a9c0d6b1e4f5a8c7d2e9b0a1f3c4d5e6f7a8b' });
  });

  it('reads every row with its geometry, flags and author', () => {
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0]).toMatchObject({ id: 1, kind: 'pin', x: 41.2, y: 23.3, resolved: false, comment: 'Logo 太小，和導覽列的基線沒有對齊。', problems: [] });
    expect(parsed.rows[0].by).toBeUndefined();
    expect(parsed.rows[1]).toMatchObject({ id: 2, kind: 'region', x: 8, y: 61.5, w: 35, h: 12, by: 'alice', problems: [] });
    expect(parsed.rows[2]).toMatchObject({ id: 3, kind: 'pin', resolved: true, by: 'bob' });
  });

  it('joins indented continuation lines into the comment, without the indent', () => {
    expect(parsed.rows[1].comment).toBe('CTA 對比不足，改用主色。\nhover 狀態也一起看。');
  });

  it('gives source ranges that cover the row text exactly', () => {
    const source = fixture('review');
    const [first, second] = parsed.rows;
    expect(source.slice(first.range.from, first.range.to)).toBe('- {#1 pin x=41.2% y=23.3%} Logo 太小，和導覽列的基線沒有對齊。');
    expect(source.slice(second.range.from, second.range.to)).toBe('- {#2 region x=8% y=61.5% w=35% h=12% by=alice} CTA 對比不足，改用主色。\n  hover 狀態也一起看。');
    expect(source.slice(first.headRange.from, first.headRange.to)).toBe('{#1 pin x=41.2% y=23.3%}');
    expect(source.slice(parsed.media.range.from, parsed.media.range.to)).toBe('![首頁 v3](/raw-assets/by-hash/3f2a9c0d6b1e4f5a8c7d2e9b0a1f3c4d5e6f7a8b)');
  });

  it('records each token with its range for in-place edits', () => {
    const source = fixture('review');
    const tokens = parsed.rows[1].tokens.map(token => [token.key, source.slice(token.from, token.to)]);
    expect(tokens).toEqual([['#', '#2'], ['kind', 'region'], ['x', 'x=8%'], ['y', 'y=61.5%'], ['w', 'w=35%'], ['h', 'h=12%'], ['by', 'by=alice']]);
  });
});

describe('parseAnnotate: block syntax', () => {
  it('takes the title attribute over the label', () => {
    expect(parseAnnotate(`:::annotate[label]{title="attr"}\n${IMG}\n:::`).title).toBe('attr');
  });

  it('accepts a block with no rows', () => {
    const parsed = parseAnnotate(`:::annotate\n${IMG}\n:::`);
    expect(parsed.rows).toEqual([]);
    expect(parsed.title).toBeUndefined();
  });

  it('reads an image with a title and an angle-bracket-free path with spaces encoded', () => {
    const parsed = parseAnnotate(':::annotate\n![alt](a%20b.png "Caption")\n:::');
    expect(parsed.media).toMatchObject({ alt: 'alt', src: 'a%20b.png', title: 'Caption' });
  });

  it('reads r2: refs and external images', () => {
    expect(parseAnnotate(':::annotate\n![x](r2:shots/a.png)\n:::').media.src).toBe('r2:shots/a.png');
    expect(parseAnnotate(':::annotate\n![x](https://example.com/a.png)\n:::').media.src).toBe('https://example.com/a.png');
  });

  it('reads a block inside a blockquote once the quote markers are stripped by the caller', () => {
    const quoted = [':::annotate', IMG, '', '- {#1 pin x=1% y=2%} hi', ':::'];
    expect(parseAnnotate(quoted.join('\n')).rows[0].comment).toBe('hi');
  });

  it('allows blank lines between rows and a comment with several paragraphs', () => {
    const parsed = parseAnnotate(block('- {#1 pin x=1% y=2%} one', '', '  second paragraph', '', '- {#2 pin x=3% y=4%} two'));
    expect(parsed.rows.map(row => row.comment)).toEqual(['one\n\nsecond paragraph', 'two']);
  });

  it('keeps a nested list and code in a comment as Markdown', () => {
    const parsed = parseAnnotate(block('- {#1 pin x=1% y=2%} items:', '  - a', '  - b'));
    expect(parsed.rows[0].comment).toBe('items:\n- a\n- b');
  });

  it('reads an empty comment', () => {
    expect(parseAnnotate(block('- {#1 pin x=1% y=2%}')).rows[0].comment).toBe('');
  });

  it('reads a quoted author with spaces', () => {
    expect(parseAnnotate(block('- {#1 pin x=1% y=2% by="Ann Lee"} hi')).rows[0].by).toBe('Ann Lee');
  });

  it('reads decimals to two places', () => {
    const row = parseAnnotate(block('- {#1 pin x=12.3456% y=0.5%} hi')).rows[0];
    expect(row.x).toBe(12.35);
    expect(row.y).toBe(0.5);
  });
});

describe('parseAnnotate: block errors', () => {
  const fails = (source: string, message: RegExp) => {
    expect(() => parseAnnotate(source)).toThrow(AnnotateError);
    expect(() => parseAnnotate(source)).toThrow(message);
  };

  it('needs a media line', () => fails(':::annotate\n\n- {#1 pin x=1% y=1%} hi\n:::', /image/i));
  it('rejects an empty body', () => fails(':::annotate\n:::', /image/i));
  it('rejects a reference-style image', () => fails(':::annotate\n![alt][ref]\n:::', /reference/i));
  it('rejects two images', () => fails(':::annotate\n![a](a.png)\n![b](b.png)\n:::', /one image/i));
  it('rejects two images on one line', () => fails(':::annotate\n![a](a.png) ![b](b.png)\n:::', /one image/i));
  it('rejects a paragraph in the body', () => fails(`:::annotate\n${IMG}\n\nsome text\n:::`, /unexpected/i));
  it('rejects a heading in the body', () => fails(`:::annotate\n${IMG}\n\n## Heading\n:::`, /unexpected/i));
  it('rejects a nested container', () => fails(`:::annotate\n${IMG}\n\n::::info\nx\n::::\n:::`, /nested|unexpected/i));
  it('rejects a link instead of an image', () => fails(':::annotate\n[a](a.png)\n:::', /image/i));
  it('rejects an unknown block attribute', () => fails(`:::annotate{scale="2"}\n${IMG}\n:::`, /scale/));
  it('rejects a block that never closes', () => fails(`:::annotate\n${IMG}`, /not closed/i));
  it('rejects another directive name', () => fails(`:::info\n${IMG}\n:::`, /not an annotate/i));
});

describe('parseAnnotate: row problems keep the row and name the cause', () => {
  it('flags a duplicate id on the later row', () => {
    expect(problems(block('- {#1 pin x=1% y=1%} a', '- {#1 pin x=2% y=2%} b'))).toEqual([[], ['duplicate-id']]);
  });

  it('flags a missing id', () => {
    expect(problems(block('- {pin x=1% y=1%} a'))).toEqual([['missing-id']]);
  });

  it('flags an invalid id', () => {
    expect(problems(block('- {#0 pin x=1% y=1%} a', '- {#x pin x=1% y=1%} b', '- {#-2 pin x=1% y=1%} c'))).toEqual([['invalid-id'], ['invalid-id'], ['invalid-id']]);
  });

  it('flags an unknown kind', () => {
    expect(problems(block('- {#1 arrow x=1% y=1%} a'))).toEqual([['unknown-kind']]);
  });

  it('flags a missing kind', () => {
    expect(problems(block('- {#1} a'))).toEqual([['missing-kind']]);
  });

  it('flags a missing key', () => {
    const parsed = parseAnnotate(block('- {#1 pin x=1%} a', '- {#2 region x=1% y=1% w=5%} b'));
    expect(parsed.rows[0].problems).toEqual([{ code: 'missing-key', detail: 'y' }]);
    expect(parsed.rows[1].problems).toEqual([{ code: 'missing-key', detail: 'h' }]);
  });

  it('flags a value that is not a percentage', () => {
    const parsed = parseAnnotate(block('- {#1 pin x=12 y=1%} a', '- {#2 pin x=abc% y=1%} b'));
    expect(parsed.rows[0].problems).toEqual([{ code: 'invalid-value', detail: 'x' }]);
    expect(parsed.rows[1].problems).toEqual([{ code: 'invalid-value', detail: 'x' }]);
  });

  it('flags values out of range', () => {
    expect(problems(block('- {#1 pin x=101% y=1%} a', '- {#2 pin x=1% y=100.5%} b', '- {#3 region x=90% y=1% w=20% h=5%} c', '- {#4 region x=1% y=1% w=0% h=5%} d'))).toEqual([['out-of-range'], ['out-of-range'], ['out-of-range'], ['out-of-range']]);
  });

  it('flags a misspelled or unknown token instead of ignoring it', () => {
    const parsed = parseAnnotate(block('- {#1 pin x=1% y=1% reslved} a', '- {#2 pin x=1% y=1% color=red} b', '- {#3 pin x=1% y=1% w=5%} c'));
    expect(parsed.rows[0].problems).toEqual([{ code: 'unknown-token', detail: 'reslved' }]);
    expect(parsed.rows[1].problems).toEqual([{ code: 'unknown-token', detail: 'color' }]);
    expect(parsed.rows[2].problems).toEqual([{ code: 'unknown-token', detail: 'w' }]);
  });

  it('flags a repeated key', () => {
    expect(parseAnnotate(block('- {#1 pin x=1% x=2% y=1%} a')).rows[0].problems).toEqual([{ code: 'duplicate-key', detail: 'x' }]);
  });

  it('flags page= on an image row (reserved for PDF)', () => {
    expect(parseAnnotate(block('- {#1 pin x=1% y=1% page=2} a')).rows[0].problems).toEqual([{ code: 'page-on-image' }]);
  });

  it('flags a list item with no {…} head and keeps its text', () => {
    const row = parseAnnotate(block('- just a note')).rows[0];
    expect(row.problems).toEqual([{ code: 'malformed' }]);
    expect(row.comment).toBe('just a note');
  });

  it('flags an unclosed head', () => {
    expect(problems(block('- {#1 pin x=1% y=1% oops'))).toEqual([['malformed']]);
  });

  it('keeps geometry of a problem row whose geometry is valid', () => {
    const row = parseAnnotate(block('- {#1 pin x=1% y=2% reslved} a')).rows[0];
    expect(row).toMatchObject({ x: 1, y: 2, kind: 'pin' });
  });

  it('collects several problems of one row', () => {
    expect(problems(block('- {#1 pin x=1% reslved} a'))).toEqual([['unknown-token', 'missing-key']]);
  });
});
