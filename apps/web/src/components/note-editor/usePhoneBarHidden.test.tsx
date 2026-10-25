// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { usePhoneBarHidden } from './usePhoneBarHidden.js';

afterEach(() => {
  cleanup();
  document.getElementById('root')?.remove();
});

function Probe({ enabled = true }: { enabled?: boolean; }) {
  const root = document.getElementById('root');
  const hidden = usePhoneBarHidden(root, enabled);
  return <output data-hidden={hidden} />;
}

function setup(enabled = true) {
  const root = document.createElement('div');
  root.id = 'root';
  root.innerHTML = '<div class="note-editor-body"><div class="cm-scroller"></div></div><div class="elsewhere"></div>';
  document.body.append(root);
  const view = render(<Probe enabled={enabled} />);
  const scroller = root.querySelector<HTMLElement>('.cm-scroller')!;
  const scrollTo = (top: number, target: HTMLElement = scroller) =>
    act(() => {
      target.scrollTop = top;
      target.dispatchEvent(new Event('scroll'));
    });
  const hidden = () => view.container.querySelector('output')!.getAttribute('data-hidden') === 'true';
  return { scrollTo, hidden, root, scroller, view };
}

it('hides as the text scrolls down past the bar and returns as soon as it scrolls back up', () => {
  const { scrollTo, hidden } = setup();
  expect(hidden()).toBe(false);
  // Small movements near the top leave it be.
  scrollTo(10);
  scrollTo(30);
  expect(hidden()).toBe(false);
  scrollTo(80);
  scrollTo(140);
  expect(hidden()).toBe(true);
  scrollTo(150);
  expect(hidden()).toBe(true);
  // A few pixels back up is a wobble, not the reader returning.
  scrollTo(145);
  expect(hidden()).toBe(true);
  scrollTo(125);
  expect(hidden()).toBe(false);
});

it('shows again at the very top, and ignores scrolling outside the note body', () => {
  const { scrollTo, hidden, root } = setup();
  scrollTo(100);
  scrollTo(200);
  expect(hidden()).toBe(true);
  scrollTo(0);
  expect(hidden()).toBe(false);
  scrollTo(100, root.querySelector<HTMLElement>('.elsewhere')!);
  scrollTo(300, root.querySelector<HTMLElement>('.elsewhere')!);
  expect(hidden()).toBe(false);
});

it('stays shown while disabled, and shows again when it is disabled with the bar hidden', () => {
  const { scrollTo, hidden, view } = setup();
  scrollTo(100);
  scrollTo(200);
  expect(hidden()).toBe(true);
  view.rerender(<Probe enabled={false} />);
  expect(hidden()).toBe(false);
  scrollTo(400);
  expect(hidden()).toBe(false);
});
