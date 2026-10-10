// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { graphOwnsEnter } from './graph-keys.js';

const page = (html: string) => {
  document.body.innerHTML = html;
  return { graph: document.querySelector('#graph')!, at: (selector: string) => document.querySelector(selector)! };
};

it('takes Enter pressed on the graph itself, also when the graph is zoomed inside a dialog', () => {
  const { graph } = page('<div role="dialog"><div id="graph" tabindex="0"><canvas></canvas></div></div>');
  expect(graphOwnsEnter(graph, graph)).toBe(true);
  expect(graphOwnsEnter(graph, graph.querySelector('canvas')!)).toBe(true);
});

it('leaves Enter to form controls and editable text inside the graph', () => {
  const { graph, at } = page('<div id="graph"><button id="b"></button><input id="i"><div id="e" contenteditable="true"></div></div>');
  for (const id of ['#b', '#i', '#e']) expect(graphOwnsEnter(graph, at(id))).toBe(false);
});

it('leaves Enter to a dialog the graph holds, native or ARIA', () => {
  const { graph, at } = page('<div id="graph"><dialog open><p id="n"></p></dialog><div role="dialog"><p id="a"></p></div></div>');
  expect(graphOwnsEnter(graph, at('#n'))).toBe(false);
  expect(graphOwnsEnter(graph, at('#a'))).toBe(false);
});

it('ignores a key from a note editor zoom borrowed from a card, whose element sits outside the graph', () => {
  const { graph, at } = page('<div id="graph"></div><div role="dialog" aria-label="Note editor"><a id="link" href="#x">link</a><div id="locked" contenteditable="false"></div></div>');
  expect(graphOwnsEnter(graph, at('#link'))).toBe(false);
  expect(graphOwnsEnter(graph, at('#locked'))).toBe(false);
});
