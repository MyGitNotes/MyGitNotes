import './tooltip.css';
import { placeTooltip } from '../lib/tooltip-position.js';
import { TOOLTIP_DELAY_MS } from './Tooltip.js';

/** T1 for rendered Markdown and editor widgets that do not have a React trigger. */
export function installDomTooltips(doc: Document) {
  const win = doc.defaultView!;
  const controller = new AbortController();
  const { signal } = controller;
  let active: HTMLElement | undefined;
  let bubble: HTMLElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closedAt = -Infinity;
  let keyboard = false;
  const hide = () => {
    clearTimeout(timer);
    active = undefined;
    if (bubble) {
      bubble.remove();
      bubble = undefined;
      closedAt = Date.now();
    }
  };
  const trigger = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('[data-t1-label],[data-t1-trigger]') ?? undefined : undefined;
  const begin = (event: MouseEvent | FocusEvent, immediate: boolean) => {
    const next = trigger(event.target);
    if (next === active) return;
    hide();
    if (!next?.dataset.t1Label) return;
    active = next;
    const show = () => {
      if (!next.isConnected || !next.dataset.t1Label) return;
      bubble = doc.createElement('div');
      bubble.className = 'tooltip';
      bubble.setAttribute('role', 'tooltip');
      const label = doc.createElement('span');
      label.className = 'tooltip-label';
      label.textContent = next.dataset.t1Label;
      bubble.append(label);
      (next.closest('dialog') ?? doc.body).append(bubble);
      const { width, height } = bubble.getBoundingClientRect();
      const { left, top, arrow, side } = placeTooltip(next.getBoundingClientRect(), { width, height }, { width: win.innerWidth, height: win.innerHeight }, 'bottom');
      bubble.dataset.side = side;
      bubble.style.left = `${left}px`;
      bubble.style.top = `${top}px`;
      bubble.style.setProperty('--tooltip-arrow', `${arrow}px`);
    };
    if (immediate || Date.now() - closedAt < 400) show();
    else timer = setTimeout(show, TOOLTIP_DELAY_MS);
  };
  const end = (event: MouseEvent | FocusEvent) => {
    if (active && trigger(event.relatedTarget) !== active) hide();
  };
  doc.addEventListener('pointerover', event => {
    if (event.pointerType !== 'touch') begin(event, false);
  }, { signal });
  doc.addEventListener('pointerout', end, { signal });
  doc.addEventListener('focusin', event => {
    if (keyboard) begin(event, true);
  }, { signal });
  doc.addEventListener('focusout', end, { signal });
  doc.addEventListener('keydown', event => {
    keyboard = true;
    if (event.key === 'Escape') hide();
  }, { capture: true, signal });
  doc.addEventListener('pointerdown', () => {
    keyboard = false;
    hide();
  }, { capture: true, signal });
  win.addEventListener('scroll', hide, { capture: true, signal });
  win.addEventListener('resize', hide, { signal });
  return () => {
    controller.abort();
    hide();
  };
}
