// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderNote } from './markdown.js';
import { hydrateQrCodes, qrCodeSize } from './qrcode.js';

const toCanvas = vi.hoisted(() =>
  vi.fn(async (canvas: HTMLCanvasElement, _text: string, options: { width: number; }) => {
    canvas.width = options.width;
    canvas.height = options.width;
  })
);
vi.mock('qrcode', () => ({ default: { toCanvas } }));

function host(markdown: string, slides?: 'preview' | 'deck'): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML = renderNote(markdown, 'notes/a.md', undefined, undefined, undefined, slides ? { slides } : undefined);
  return element;
}

afterEach(() => {
  toCanvas.mockClear();
  vi.restoreAllMocks();
});

describe('the QR codes of a note', () => {
  it('writes an inline :qrcode as a link to the address, sized 128 unless the directive says', () => {
    const note = host('Scan :qrcode{url="https://example.com/a?b=1&c=2"} or :qrcode{url="https://example.com" size="220"} or :qrcode[https://example.org].');
    const [first, second, third] = [...note.querySelectorAll<HTMLElement>('[data-qrcode]')];
    expect([first.tagName, first.dataset.qrcode, first.dataset.size]).toEqual(['SPAN', 'https://example.com/a?b=1&c=2', '128']);
    expect([second.dataset.qrcode, second.dataset.size]).toEqual(['https://example.com', '220']);
    expect(third.dataset.qrcode).toBe('https://example.org');
    expect(first.querySelector('a')?.getAttribute('href')).toBe('https://example.com/a?b=1&c=2');
    expect(first.querySelector('a')?.textContent).toContain('https://example.com/a?b=1&c=2');
    expect(note.textContent).not.toMatch(/(?<!https):qrcode/);
  });

  it("writes a ::qrcode on a line of its own as a block, the blog's leaf form", () => {
    const note = host('before\n\n::qrcode{url="https://example.com/talk" size="220"}\n\nafter');
    const block = note.querySelector<HTMLElement>('div.qrcode-container.qrcode-block')!;
    expect([block.dataset.qrcode, block.dataset.size]).toEqual(['https://example.com/talk', '220']);
    expect(block.querySelector('a')?.getAttribute('href')).toBe('https://example.com/talk');
    expect(note.textContent).not.toContain('::qrcode');
    expect([...note.querySelectorAll('p')].map(paragraph => paragraph.textContent)).toEqual(['before', 'after']);
  });

  it.each(['preview', 'deck'] as const)("writes both forms in a slide note's %s", slides => {
    const note = host('## One\n\n::qrcode{url="https://example.com/a"}\n\ntext :qrcode{url="https://example.com/b"}\n', slides);
    expect([...note.querySelectorAll<HTMLElement>('[data-qrcode]')].map(element => element.dataset.qrcode)).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('reads no qrcode inside a code block', () => {
    const note = host('```md\n::qrcode{url="https://example.com"}\n```\n\n`:qrcode{url="x"}`');
    expect(note.querySelector('[data-qrcode]')).toBeNull();
  });

  it('draws no code without an address, and shows the name alone', () => {
    const note = host(':qrcode{size="200"} and\n\n::qrcode\n');
    const containers = [...note.querySelectorAll<HTMLElement>('[data-qrcode]')];
    expect(containers.map(element => element.dataset.qrcode)).toEqual(['', '']);
    expect(note.querySelector('a')).toBeNull();
    expect(containers.map(element => element.textContent)).toEqual(['QR Code', 'QR Code']);
  });

  it('makes no link of a javascript: address', () => {
    const note = host(':qrcode{url="javascript:alert(1)"}');
    expect(note.querySelector('a')).toBeNull();
  });
});

describe('qrCodeSize', () => {
  it('reads whole pixels, defaults to 128 and stays within the limits', () => {
    expect([undefined, '', 'big', '220', '220px', ' 96 ', '12', '99999', '-5'].map(qrCodeSize)).toEqual([128, 128, 128, 220, 220, 96, 32, 1024, 128]);
  });
});

describe('hydrateQrCodes', () => {
  const settle = () => vi.waitFor(() => expect(toCanvas).toHaveBeenCalled());

  it('draws a canvas of the size into the link, once, and keeps the link text for a reader without the picture', async () => {
    const note = host('::qrcode{url="https://example.com/talk" size="220"}');
    const stop = hydrateQrCodes(note);
    await settle();
    const container = note.querySelector<HTMLElement>('[data-qrcode]')!;
    await vi.waitFor(() => expect(container.dataset.qrcodeRendered).toBe('true'));
    expect(toCanvas.mock.calls[0].slice(1)).toEqual(['https://example.com/talk', { width: 220, margin: 1 }]);
    const canvas = container.querySelector('a canvas')!;
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com/talk');
    expect(container.querySelector('.qrcode-link-text')?.textContent).toContain('https://example.com/talk');
    hydrateQrCodes(note);
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    stop();
  });

  it('draws nothing for a code with no address, and nothing after it was stopped', async () => {
    const empty = host(':qrcode{size="200"}');
    hydrateQrCodes(empty);
    const stopped = host(':qrcode{url="https://example.com"}');
    hydrateQrCodes(stopped)();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(toCanvas).not.toHaveBeenCalled();
    expect(stopped.querySelector('canvas')).toBeNull();
  });

  it('leaves the link when the code cannot be drawn', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    toCanvas.mockRejectedValueOnce(new Error('too long'));
    const note = host(':qrcode{url="https://example.com"}');
    hydrateQrCodes(note);
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect(note.querySelector('canvas')).toBeNull();
    expect(note.querySelector<HTMLElement>('[data-qrcode]')?.dataset.qrcodeRendered).toBeUndefined();
  });
});
