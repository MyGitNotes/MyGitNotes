// @vitest-environment jsdom
import { createElement, type ReactNode, useRef, useState } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { KeyboardRoot } from '../../lib/keyboard/KeyboardDispatcher.js';
import { PanelProvider, usePanelContext } from '../../lib/panel-context.js';
import { useAgentInputFocusRequest } from '../../lib/pi-agent/input-focus.js';
import { type AgentTarget, PiAgentContext, type PiAgentValue } from '../../lib/pi-agent/session.js';
import { AgentFocusCommand } from './AgentFocusCommand.js';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

/** The agent panel's message box, which takes a pending focus request when it mounts. */
function AgentBox() {
  const input = useRef<HTMLTextAreaElement>(null);
  useAgentInputFocusRequest(input);
  return createElement('section', { className: 'pi-agent-panel' }, createElement('textarea', { ref: input, 'aria-label': 'Message' }));
}

/** The tools panel's agent tool, shown while the panel has it open. */
function ToolsPanel() {
  const { isOpen, activeTool } = usePanelContext();
  return isOpen && activeTool === 'agent' ? createElement(AgentBox) : null;
}

function mount({ available = true, target = null }: { available?: boolean; target?: AgentTarget | null; }, children?: ReactNode) {
  const agent = { available, target } as PiAgentValue;
  return render(createElement(KeyboardRoot, null, createElement(PanelProvider, null, createElement(PiAgentContext.Provider, { value: agent }, createElement(AgentFocusCommand), children))));
}

const pressToggle = (target: Element) => {
  const event = new KeyboardEvent('keydown', { key: '`', code: 'Backquote', ctrlKey: true, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

it('opens the agent in the note editor it names and focuses the message box', () => {
  let openAgent = () => {};
  function Editor() {
    const [open, setOpen] = useState(false);
    openAgent = () => setOpen(true);
    return createElement('div', null, createElement('textarea', { 'aria-label': 'Note content' }), open && createElement(AgentBox));
  }
  const opened = vi.fn(() => openAgent());
  mount({ target: { notebookId: 'a', path: 'notes/a.md', openAgent: opened, focusEditor: vi.fn() } }, createElement(Editor));
  const note = screen.getByLabelText('Note content');
  note.focus();

  const event = pressToggle(note);
  expect(event.defaultPrevented).toBe(true);
  expect(opened).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(screen.getByLabelText('Message'));
});

it('returns from the agent to the note editor it names', () => {
  const focusEditor = vi.fn();
  const openAgent = vi.fn();
  mount({ target: { notebookId: 'a', path: 'notes/a.md', openAgent, focusEditor } }, createElement(AgentBox));
  const message = screen.getByLabelText('Message');
  message.focus();

  pressToggle(message);
  expect(focusEditor).toHaveBeenCalledTimes(1);
  expect(openAgent).not.toHaveBeenCalled();
});

it('opens the agent in the tools panel when no note editor is open', () => {
  mount({}, createElement('div', null, createElement('button', null, 'Elsewhere'), createElement(ToolsPanel)));
  const button = screen.getByRole('button', { name: 'Elsewhere' });
  button.focus();

  pressToggle(button);
  expect(document.activeElement).toBe(screen.getByLabelText('Message'));
});

it('leaves the key to the page where the agent is not available', () => {
  const openAgent = vi.fn();
  mount({ available: false, target: { notebookId: 'a', path: 'notes/a.md', openAgent } }, createElement('button', null, 'Elsewhere'));
  const event = pressToggle(screen.getByRole('button', { name: 'Elsewhere' }));
  expect(event.defaultPrevented).toBe(false);
  expect(openAgent).not.toHaveBeenCalled();
});

/** An agent panel whose message box appears only once its session is ready. */
let showBox = () => {};
function SlowAgentPanel() {
  const input = useRef<HTMLTextAreaElement>(null);
  const [ready, setReady] = useState(false);
  showBox = () => setReady(true);
  useAgentInputFocusRequest(input);
  return createElement('section', { className: 'pi-agent-panel' }, ready ? createElement('textarea', { ref: input, 'aria-label': 'Message' }) : createElement('p', null, 'Starting'));
}

it('focuses the message box once it appears after its panel', () => {
  mount({}, createElement('div', null, createElement('button', null, 'Elsewhere'), createElement(SlowAgentPanel)));
  const button = screen.getByRole('button', { name: 'Elsewhere' });
  button.focus();
  pressToggle(button);
  expect(document.activeElement).toBe(button);
  act(() => showBox());
  expect(document.activeElement).toBe(screen.getByLabelText('Message'));
});

it('does not take focus from where the person went before the box appeared', () => {
  mount({}, createElement('div', null, createElement('button', null, 'Elsewhere'), createElement('input', { 'aria-label': 'Search' }), createElement(SlowAgentPanel)));
  const button = screen.getByRole('button', { name: 'Elsewhere' });
  button.focus();
  pressToggle(button);
  const search = screen.getByLabelText('Search');
  act(() => search.focus());
  act(() => showBox());
  expect(document.activeElement).toBe(search);
});
