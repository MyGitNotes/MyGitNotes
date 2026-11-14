// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import remarkDirective from 'remark-directive';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { parseDirectiveAttributes, QRCODE_LEAF } from './directives.js';
import { applyEdits, formatMarkdown } from './markdown-format.js';
import { renderNote } from './markdown.js';
import { qrCodeAttribute, qrCodeText, QrCodeValueError, turnIntoQrCode } from './qrcode-edit.js';

/**
 * Runs the action on a document written with the selection or caret marked: `⟦…⟧` is a selection, `|` a caret. The answer is the document
 * after, with the caret or selection marked the same way.
 */
function turn(marked: string): string {
  const open = marked.indexOf('⟦'), caret = marked.indexOf('|');
  const [doc, from, to] = open >= 0 ? [marked.replace('⟦', '').replace('⟧', ''), open, marked.indexOf('⟧') - 1] : [marked.replace('|', ''), caret, caret];
  const result = formatMarkdown(doc, from, to, 'qrcode');
  expect(result.refused).toBeUndefined();
  const after = applyEdits(doc, result.changes);
  return result.anchor === result.head ? `${after.slice(0, result.anchor)}|${after.slice(result.anchor)}` : `${after.slice(0, result.anchor)}⟦${after.slice(result.anchor, result.head)}⟧${after.slice(result.head)}`;
}

describe('Turn into QR code', () => {
  it('turns a selection inside a line into an inline :qrcode', () => {
    expect(turn('Scan ⟦https://example.com/a?b=1⟧ now')).toBe('Scan :qrcode{url="https://example.com/a?b=1"}| now');
    expect(turn('see ⟦hello world⟧ here')).toBe('see :qrcode{url="hello world"}| here');
  });

  it('turns a selection that is a whole line into a ::qrcode line', () => {
    expect(turn('before\n⟦https://example.com/talk⟧\nafter')).toBe('before\n::qrcode{url="https://example.com/talk"}|\nafter');
    // The line break a triple click takes along, the line's indent and several selected lines are all that line, or those lines, alone.
    expect(turn('before\n⟦https://example.com/talk\n⟧after')).toBe('before\n::qrcode{url="https://example.com/talk"}|\nafter');
    expect(turn('  ⟦https://example.com/talk⟧  ')).toBe('::qrcode{url="https://example.com/talk"}|');
    expect(turn('⟦https://example.com/long\nwrapped⟧')).toBe('::qrcode{url="https://example.com/long wrapped"}|');
  });

  it('trims whitespace and line breaks off the string', () => {
    // The whitespace around the selection stays where it was.
    expect(turn('a ⟦  https://example.com \n⟧ b')).toBe('a   :qrcode{url="https://example.com"}| \n b');
    expect(qrCodeText('  one \n two\t three ')).toBe('one two three');
  });

  it('replaces a bare address under the caret, with a block when it is the whole line', () => {
    expect(turn('Open https://exa|mple.com/x now')).toBe('Open :qrcode{url="https://example.com/x"}| now');
    expect(turn('Open https://example.com/x|, then')).toBe('Open :qrcode{url="https://example.com/x"}|, then');
    // A full stop after the address is the sentence's.
    expect(turn('a\nhttps://exam|ple.com/x.\nb')).toBe('a\n:qrcode{url="https://example.com/x"}|.\nb');
    expect(turn('https://exam|ple.com/x')).toBe('::qrcode{url="https://example.com/x"}|');
    expect(turn('a\n  https://exam|ple.com/x  \nb')).toBe('a\n::qrcode{url="https://example.com/x"}|\nb');
  });

  it('keeps a Markdown link or an autolink and writes the code as a block under its line', () => {
    const talk = '::qrcode{url="https://example.com/talk"}';
    expect(turn('See [the talk](https://exam|ple.com/talk) first.')).toBe(`See [the talk](https://exam|ple.com/talk) first.\n\n${talk}`);
    expect(turn('See [the ta|lk](https://example.com/talk "Title") first.\nNext line')).toBe(`See [the ta|lk](https://example.com/talk "Title") first.\n\n${talk}\n\nNext line`);
    expect(turn('Go <https://exa|mple.com/talk>\n\nmore')).toBe(`Go <https://exa|mple.com/talk>\n\n${talk}\n\nmore`);
    expect(turn('- [t](<https://example.com/a b>|)')).toBe('- [t](<https://example.com/a b>|)\n\n::qrcode{url="https://example.com/a b"}');
  });

  it('uses the address of a selected Markdown link as it does a caret in one', () => {
    expect(turn('See ⟦[the talk](https://example.com/talk)⟧ first.\n\nNext')).toBe('See ⟦[the talk](https://example.com/talk)⟧ first.\n\n::qrcode{url="https://example.com/talk"}\n\nNext');
  });

  it('writes a ::qrcode snippet with the caret between its quotes when there is nothing to use', () => {
    expect(turn('|')).toBe('::qrcode{url="|"}');
    expect(turn('one\n\n|\n\ntwo')).toBe('one\n\n::qrcode{url="|"}\n\ntwo');
    expect(turn('plain te|xt\nnext')).toBe('plain text\n\n::qrcode{url="|"}\n\nnext');
    expect(turn('plain text|')).toBe('plain text\n\n::qrcode{url="|"}');
    // Whitespace alone selected is nothing selected.
    expect(turn('a\n⟦  \n⟧b')).toBe('a\n::qrcode{url="|"}\nb');
  });

  it('takes any string, the address first', () => {
    expect(turn('⟦WIFI:T:WPA;S:cafe;P:secret;;⟧')).toBe('::qrcode{url="WIFI:T:WPA;S:cafe;P:secret;;"}|');
    expect(turn('x ⟦mailto:me@example.com⟧ y')).toBe('x :qrcode{url="mailto:me@example.com"}| y');
    expect(turn('x ⟦say "hi"⟧ y')).toBe('x :qrcode{url=\'say "hi"\'}| y');
  });
});

describe('the string a directive carries', () => {
  const read = (directive: string) => {
    const match = QRCODE_LEAF.exec(directive)!;
    return parseDirectiveAttributes(match[2]).url;
  };

  it.each([['https://example.com/a?b=1&c=2', 'https://example.com/a?b=1&c=2'], ['https://example.com/say"hi"', 'https://example.com/say%22hi%22'], ['https://example.com/{id}', 'https://example.com/{id%7D'], ['plain text', 'plain text'], ['say "hi" now', 'say "hi" now'], ["it's here", "it's here"]])('writes %j so that it reads back as %j', (text, expected) => {
    const directive = `::qrcode{${qrCodeAttribute(text)}}`;
    // MyGitNotes' own readers.
    expect(read(directive)).toBe(expected);
    const rendered = document.createElement('div');
    rendered.innerHTML = renderNote(directive, 'n.md');
    expect(rendered.querySelector<HTMLElement>('[data-qrcode]')?.dataset.qrcode).toBe(expected);
    // remark-directive, which the blog reads the same line with.
    const tree = unified().use(remarkParse).use(remarkDirective).parse(directive) as unknown as { children: { type: string; name: string; attributes: Record<string, string>; }[]; };
    expect(tree.children[0]).toMatchObject({ type: 'leafDirective', name: 'qrcode', attributes: { url: expected } });
  });

  it('refuses the text a directive has no way to carry, and leaves the document alone', () => {
    for (const text of ['both " and \' here', 'a } brace', 'it\'s "x"']) {
      expect(() => qrCodeAttribute(text), text).toThrow(QrCodeValueError);
      const doc = `x ${text} y`;
      const result = formatMarkdown(doc, 2, 2 + text.length, 'qrcode');
      expect(result).toEqual({ changes: [], anchor: 2, head: 2 + text.length, refused: 'qrcode-text' });
    }
  });

  it('writes an inline directive MyGitNotes reads back, in a line of text', () => {
    const doc = turn('Scan ⟦https://example.com/talk?x=1⟧ here').replace('|', '');
    const html = renderNote(doc, 'n.md');
    expect(html).toContain('data-qrcode="https://example.com/talk?x=1"');
    expect(html).toContain('data-size="128"');
  });

  it('links only an address a browser can open, and shows any other string as it is', () => {
    const html = (text: string) => {
      const host = document.createElement('div');
      host.innerHTML = renderNote(`::qrcode{${qrCodeAttribute(text)}}`, 'n.md');
      return host;
    };
    expect(html('https://example.com/a').querySelector('a')?.getAttribute('href')).toBe('https://example.com/a');
    expect(html('mailto:me@example.com').querySelector('a')).not.toBeNull();
    for (const text of ['hello world', 'WIFI:T:WPA;S:cafe;P:secret;;', 'notes/a.md']) {
      const host = html(text);
      expect(host.querySelector('a'), text).toBeNull();
      expect(host.querySelector('.qrcode-link-text')?.textContent).toBe(text);
    }
  });

  it('throws only the refusal, for the caller that wants it', () => {
    expect(() => turnIntoQrCode('a } b', 2, 3)).toThrow(QrCodeValueError);
  });

  describe('review fixes (R0150)', () => {
    it('F003: leaves an existing directive alone', () => {
      for (const marked of ['x :qrcode{url="https://a.b/|c"} y', '::qrcode{url="https://a.b/|c"}', '::qrcode{url="|"}', 'x ⟦:qrcode{url="https://a.b/c"}⟧ y']) {
        expect(turn(marked).replace(/[|⟦⟧]/g, '')).toBe(marked.replace(/[|⟦⟧]/g, ''));
      }
    });

    it('F004: the renderer links only what the link pass keeps', () => {
      const host = document.createElement('div');
      host.innerHTML = renderNote(':qrcode{url="tel:+886123"} :qrcode{url="ftp://a.b/c"}', { notePath: 'n.md' } as never);
      expect(host.querySelectorAll('.qrcode-link').length).toBe(0);
    });

    it('F005: puts the block after the whole table, list or quote', () => {
      const run = (doc: string, at: number) => applyEdits(doc, formatMarkdown(doc, at, at, 'qrcode').changes);
      const table = '| [t](https://a.b) |\n|---|\n| x |\n\nafter';
      expect(run(table, 5)).toBe('| [t](https://a.b) |\n|---|\n| x |\n\n::qrcode{url="https://a.b"}\n\nafter');
      const list = '- [t](https://a.b)\n- two\n\nafter';
      expect(run(list, 5)).toBe('- [t](https://a.b)\n- two\n\n::qrcode{url="https://a.b"}\n\nafter');
      const quote = '> [t](https://a.b)\n> more\nafter';
      expect(run(quote, 5)).toBe('> [t](https://a.b)\n> more\n\n::qrcode{url="https://a.b"}\n\nafter');
    });

    it('F006: a relative target is no address', () => {
      expect(turn('see [n|](./other.md)')).toBe('see [n](./other.md)\n\n::qrcode{url="|"}');
    });

    it('F007: keeps the CR of a CRLF line', () => {
      const doc = 'https://a.b\r\nnext', result = formatMarkdown(doc, 3, 3, 'qrcode');
      expect(applyEdits(doc, result.changes)).toBe('::qrcode{url="https://a.b"}\r\nnext');
    });
  });
});
