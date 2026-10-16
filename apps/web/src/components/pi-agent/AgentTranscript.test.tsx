// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { AgentTranscript } from './AgentTranscript.js';
import { type AssistantBlock, emptyTranscript, type ToolOutcome, type TranscriptState } from '../../lib/pi-agent/transcript.js';

afterEach(cleanup);

const call = (id: string, name: string, args: unknown = {}): AssistantBlock => ({ type: 'toolCall', id, name, args });
const text = (value: string): AssistantBlock => ({ type: 'text', text: value });
const done: ToolOutcome = { text: 'file one\nfile two', isError: false, running: false };

function transcript(blocks: AssistantBlock[], tools: Record<string, ToolOutcome>): TranscriptState {
  return { ...emptyTranscript, entries: [{ kind: 'assistant', key: 1, blocks }], tools };
}

const view = (state: TranscriptState) => createElement(AgentTranscript, { transcript: state });
const groups = () => [...document.querySelectorAll<HTMLDetailsElement>('.pi-agent-tool-group')];

it('folds consecutive tool calls of one reply into a single summary naming the tools', () => {
  render(view(transcript([call('t1', 'bash', { command: 'ls' }), call('t2', 'read', { path: 'a.md' }), call('t3', 'bash', { command: 'pwd' })], { t1: done, t2: done, t3: done })));
  const [group] = groups();
  expect(groups()).toHaveLength(1);
  expect(group.querySelector('summary')!.textContent).toBe('Ran 3 tools: bash, read');
  // Done and fine, so it starts collapsed; each call is still its own expandable row.
  expect(group.open).toBe(false);
  expect(group.querySelectorAll('.pi-agent-tool')).toHaveLength(3);
  fireEvent.click(group.querySelector('summary')!);
  expect(group.open).toBe(true);
  expect(group.querySelector('.pi-agent-tool .pi-agent-pre')?.textContent).toContain('"command": "ls"');
});

it('leaves a lone tool call as its own row, and groups only calls that follow each other', () => {
  render(view(transcript([call('t1', 'bash'), text('Then I read it.'), call('t2', 'read'), call('t3', 'grep')], { t1: done, t2: done, t3: done })));
  expect(groups()).toHaveLength(1);
  expect(groups()[0].querySelector('summary')!.textContent).toBe('Ran 2 tools: read, grep');
  // The lone call before the text is a plain row outside the group.
  expect(document.querySelectorAll('.pi-agent-tool-group-body .pi-agent-tool')).toHaveLength(2);
  expect(document.querySelectorAll('.pi-agent-tool')).toHaveLength(3);
});

it('stays open with a spinner and the running tool name while a call runs, and collapses when they finish', () => {
  const running = transcript([call('t1', 'bash'), call('t2', 'read')], { t1: done, t2: { text: '', isError: false, running: true } });
  const { rerender } = render(view(running));
  const [group] = groups();
  expect(group.dataset.state).toBe('running');
  expect(group.open).toBe(true);
  expect(group.querySelector('summary')!.textContent).toBe('Running read (2 tools)');
  expect(group.querySelector('summary .pi-agent-tool-state')!.getAttribute('aria-label')).toBe('Running');
  rerender(view(transcript(running.entries[0].kind === 'assistant' ? running.entries[0].blocks : [], { t1: done, t2: done })));
  expect(groups()[0].dataset.state).toBe('done');
  expect(groups()[0].open).toBe(false);
});

it('shows a failed call in the error colour and keeps the group open', () => {
  render(view(transcript([call('t1', 'bash'), call('t2', 'read')], { t1: done, t2: { text: 'no such file', isError: true, running: false } })));
  const [group] = groups();
  expect(group.dataset.state).toBe('error');
  expect(group.open).toBe(true);
  expect(group.querySelector('summary')!.textContent).toBe('Ran 2 tools: bash, read');
  expect(group.querySelector('summary .pi-agent-tool-state')!.getAttribute('aria-label')).toBe('Failed');
  expect(group.querySelector('.pi-agent-tool[data-state="error"]')).toBeTruthy();
});
