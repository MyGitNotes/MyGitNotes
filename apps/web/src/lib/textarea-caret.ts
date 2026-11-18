/** The styles that decide where a textarea's text lies, copied onto the mirror that measures it. */
const MIRRORED = ['box-sizing', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'font-family', 'font-size', 'font-style', 'font-variant', 'font-weight', 'font-stretch', 'font-feature-settings', 'line-height', 'letter-spacing', 'word-spacing', 'tab-size', 'text-indent', 'text-transform', 'text-align', 'direction'] as const;

interface CaretDocument {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number; } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
}

/**
 * The offset in a textarea's value nearest the viewport point, or null where the browser has no caret hit test.
 * A browser hit-tests no text inside a textarea, so an invisible copy of it, laid over it with the same box, font,
 * wrapping and scroll, is hit-tested instead and taken away again.
 */
export function textareaOffsetAt(area: HTMLTextAreaElement, x: number, y: number): number | null {
  const document = area.ownerDocument as Document & CaretDocument;
  const caretAt = document.caretPositionFromPoint
    ? (left: number, top: number) => {
      const position = document.caretPositionFromPoint!(left, top);
      return position && { node: position.offsetNode, offset: position.offset };
    }
    : document.caretRangeFromPoint
    ? (left: number, top: number) => {
      const range = document.caretRangeFromPoint!(left, top);
      return range && { node: range.startContainer, offset: range.startOffset };
    }
    : null;
  if (!caretAt) return null;
  const style = getComputedStyle(area);
  const box = area.getBoundingClientRect();
  const mirror = document.createElement('div');
  for (const name of MIRRORED) mirror.style.setProperty(name, style.getPropertyValue(name));
  const wraps = area.getAttribute('wrap') !== 'off';
  Object.assign(mirror.style, { position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, margin: '0', overflow: 'hidden', whiteSpace: wraps ? 'pre-wrap' : 'pre', overflowWrap: wraps ? 'break-word' : 'normal', opacity: '0', zIndex: '2147483647', pointerEvents: 'auto' });
  // A trailing newline holds a last empty line open, as the textarea does.
  const text = document.createTextNode(`${area.value}\n`);
  mirror.append(text);
  document.body.append(mirror);
  try {
    mirror.scrollTop = area.scrollTop;
    mirror.scrollLeft = area.scrollLeft;
    const hit = caretAt(x, y);
    return hit && hit.node === text ? Math.min(hit.offset, area.value.length) : null;
  } finally {
    mirror.remove();
  }
}
