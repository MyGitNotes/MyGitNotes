// @vitest-environment jsdom
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { KeyboardRoot } from '../../lib/keyboard/KeyboardDispatcher.js';
import { assistantDock, useAssistantDock } from '../../lib/assistant-dock.js';
import { PanelProvider } from '../../lib/panel-context.js';
import { useAgentInputFocusRequest } from '../../lib/pi-agent/input-focus.js';
import { type AgentTarget, PiAgentContext, type PiAgentValue } from '../../lib/pi-agent/session.js';
import { AgentFocusCommand } from './AgentFocusCommand.js';

beforeEach(() => {
  localStorage.clear();
  assistantDock.reload();
});
afterEach(cleanup);

/** Lets a test reveal what a component shows later: a message box appearing once Pi is ready. */
const reveal: { show: () => void; } = { show: () => {} };
function useRevealed(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    reveal.show = () => setShown(true);
  }, []);
  return shown;
}

/** The agent panel's message box, which takes a pending focus request when it mounts. */
function AgentBox() {
  const input = useRef<HTMLTextAreaElement>(null);
  useAgentInputFocusRequest(input);
  return (
    <section className='pi-agent-panel'>
      <textarea ref={input} aria-label='Message' />
    </section>
  );
}

/** An agent panel whose message box appears only once its session is ready. */
function SlowAgentPanel() {
  const input = useRef<HTMLTextAreaElement>(null);
  const ready = useRevealed();
  useAgentInputFocusRequest(input);
  return <section className='pi-agent-panel'>{ready ? <textarea ref={input} aria-label='Message' /> : <p>Starting</p>}</section>;
}

/** The assistant dock, which shows the agent's message box while it is open. */
function Dock() {
  const { open } = useAssistantDock();
  return open ? <AgentBox /> : null;
}

/** A note editor beside the dock. */
function Editor() {
  return <textarea aria-label='Note content' />;
}

function mount({ available = true, target = null, session = null }: { available?: boolean; target?: AgentTarget | null; session?: PiAgentValue['session']; }, children?: ReactNode) {
  const agent = { available, target, session, starting: false, start: vi.fn(async () => {}), wake: vi.fn() } as unknown as PiAgentValue;
  render(
    <KeyboardRoot>
      <PanelProvider>
        <PiAgentContext.Provider value={agent}>
          <AgentFocusCommand />
          {children}
        </PiAgentContext.Provider>
      </PanelProvider>
    </KeyboardRoot>,
  );
  return agent;
}

const pressToggle = (target: Element) => {
  const event = new KeyboardEvent('keydown', { key: '`', code: 'Backquote', ctrlKey: true, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

it('opens the dock from a note editor and focuses the message box', () => {
  mount(
    { target: { notebookId: 'a', path: 'notes/a.md', focusEditor: vi.fn() } },
    <>
      <Editor />
      <Dock />
    </>,
  );
  const note = screen.getByLabelText('Note content');
  note.focus();
  expect(screen.queryByLabelText('Message')).toBeNull();

  const event = pressToggle(note);
  expect(event.defaultPrevented).toBe(true);
  expect(assistantDock.get().open).toBe(true);
  expect(document.activeElement).toBe(screen.getByLabelText('Message'));
  expect(JSON.parse(localStorage.getItem('mygitnotes:assistant-dock')!).open).toBe(true);
});

it('returns from the agent to the note editor it names', () => {
  const focusEditor = vi.fn();
  assistantDock.open();
  mount({ target: { notebookId: 'a', path: 'notes/a.md', focusEditor } }, <Dock />);
  const message = screen.getByLabelText('Message');
  message.focus();

  pressToggle(message);
  expect(focusEditor).toHaveBeenCalledTimes(1);
  expect(assistantDock.get().open).toBe(true);
});

it('closes the dock from the agent when no note editor is open, so the key toggles on a list', () => {
  assistantDock.open();
  mount({}, <Dock />);
  const message = screen.getByLabelText('Message');
  message.focus();

  pressToggle(message);
  expect(assistantDock.get().open).toBe(false);
  expect(screen.queryByLabelText('Message')).toBeNull();
});

it('opens the dock when no note editor is open', () => {
  mount(
    {},
    <div>
      <button type='button'>Elsewhere</button>
      <Dock />
    </div>,
  );
  const button = screen.getByRole('button', { name: 'Elsewhere' });
  button.focus();

  pressToggle(button);
  expect(document.activeElement).toBe(screen.getByLabelText('Message'));
});

it('leaves the dock open when the key is pressed again from elsewhere', () => {
  assistantDock.open();
  mount(
    {},
    <>
      <button type='button'>Elsewhere</button>
      <Dock />
    </>,
  );
  pressToggle(screen.getByRole('button', { name: 'Elsewhere' }));
  expect(assistantDock.get().open).toBe(true);
  expect(document.activeElement).toBe(screen.getByLabelText('Message'));
});

it('leaves the key to the page where the agent is not available', () => {
  mount(
    { available: false, target: { notebookId: 'a', path: 'notes/a.md' } },
    <>
      <button type='button'>Elsewhere</button>
      <Dock />
    </>,
  );
  const event = pressToggle(screen.getByRole('button', { name: 'Elsewhere' }));
  expect(event.defaultPrevented).toBe(false);
  expect(assistantDock.get().open).toBe(false);
});

it('focuses the message box once it appears after its panel', () => {
  mount(
    {},
    <div>
      <button type='button'>Elsewhere</button>
      <SlowAgentPanel />
    </div>,
  );
  const button = screen.getByRole('button', { name: 'Elsewhere' });
  button.focus();
  pressToggle(button);
  expect(document.activeElement).toBe(button);
  act(() => reveal.show());
  expect(document.activeElement).toBe(screen.getByLabelText('Message'));
});

it('does not take focus from where the person went before the box appeared', () => {
  mount(
    {},
    <div>
      <button type='button'>Elsewhere</button>
      <input aria-label='Search' />
      <SlowAgentPanel />
    </div>,
  );
  const button = screen.getByRole('button', { name: 'Elsewhere' });
  button.focus();
  pressToggle(button);
  const search = screen.getByLabelText('Search');
  act(() => search.focus());
  act(() => reveal.show());
  expect(document.activeElement).toBe(search);
});

it('starts Pi on the way to the agent when none runs, and starts an ended session again', () => {
  const resting = mount({}, <button type='button'>Elsewhere</button>);
  pressToggle(screen.getByRole('button', { name: 'Elsewhere' }));
  expect(resting.wake).toHaveBeenCalledTimes(1);
  expect(resting.start).not.toHaveBeenCalled();
  cleanup();

  const ended = mount({ session: { id: 's1', cwd: '/w', location: { repository: 'local:home', folder: '' }, status: 'exited', startedAt: '' } }, <button type='button'>Elsewhere</button>);
  pressToggle(screen.getByRole('button', { name: 'Elsewhere' }));
  expect(ended.start).toHaveBeenCalledTimes(1);
});
