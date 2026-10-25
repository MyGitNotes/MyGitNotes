// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installAnnotationLinking } from './linking.js';

const FIGURE = `<figure class="ann-figure" id="ann-9"><div class="ann-stage"><svg class="ann-overlay">
<a href="#ann-9-1" id="ann-9-1-m" class="ann-marker ann-pin ann-n-1"><svg><path/></svg></a>
<a href="#ann-9-2" id="ann-9-2-m" class="ann-marker ann-pin ann-n-2"><svg><path/></svg></a></svg></div>
<ol><li id="ann-9-1" class="ann-item ann-pin ann-n-1"><a class="ann-ref" href="#ann-9-1-m">1</a></li>
<li id="ann-9-2" class="ann-item ann-pin ann-n-2"><a class="ann-ref" href="#ann-9-2-m">2</a></li></ol></figure>
<figure class="ann-figure" id="ann-10"><ol><li id="ann-10-1" class="ann-item ann-n-1"><a class="ann-ref" href="#ann-10-1-m">1</a></li></ol></figure>`;

let remove: () => void;
beforeEach(() => {
  document.body.innerHTML = FIGURE;
  location.hash = '';
  remove = installAnnotationLinking(document);
});
afterEach(() => remove());

const fire = (target: Element, type: string, init: EventInit = {}) => target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, ...init }));
const linked = () => [...document.querySelectorAll('.is-linked')].map(element => element.id);

describe('installAnnotationLinking', () => {
  it('highlights the marker and the item that share a number, in that figure only', () => {
    fire(document.getElementById('ann-9-1')!, 'pointerover');
    expect(linked().sort()).toEqual(['ann-9-1', 'ann-9-1-m']);
  });

  it('highlights the item when its marker is hovered, and moves the highlight along', () => {
    fire(document.getElementById('ann-9-1-m')!, 'pointerover');
    fire(document.getElementById('ann-9-2-m')!, 'pointerover');
    expect(linked().sort()).toEqual(['ann-9-2', 'ann-9-2-m']);
  });

  it('follows keyboard focus', () => {
    fire(document.querySelector('#ann-9-2 .ann-ref')!, 'focusin');
    expect(linked().sort()).toEqual(['ann-9-2', 'ann-9-2-m']);
  });

  it('clears the highlight when the pointer leaves', () => {
    fire(document.getElementById('ann-9-1')!, 'pointerover');
    fire(document.getElementById('ann-9-1')!, 'pointerout');
    expect(linked()).toEqual([]);
  });

  it('lets a click on a marker scroll to its item without changing the URL hash', () => {
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.getElementById('ann-9-2-m')!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(location.hash).toBe('');
    expect(document.getElementById('ann-9-2')!.classList.contains('is-flash')).toBe(true);
  });

  it('does the reverse from the number in the list', () => {
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('#ann-9-1 .ann-ref')!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(document.getElementById('ann-9-1-m')!.classList.contains('is-flash')).toBe(true);
  });

  it('leaves other links alone', () => {
    document.body.insertAdjacentHTML('beforeend', '<a id="other" href="#x">x</a>');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.getElementById('other')!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
  });

  it('stops listening once removed', () => {
    remove();
    fire(document.getElementById('ann-9-1')!, 'pointerover');
    expect(linked()).toEqual([]);
  });
});
