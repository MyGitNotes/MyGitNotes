// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Header } from './Header.js';
import { PiAgentProvider } from '../lib/pi-agent/session.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** Answers the session probe when the test says so, as a slow round trip to an external bridge does. */
function probe() {
  let answer: (response: Response) => void = () => {};
  const pending = new Promise<Response>(resolve => {
    answer = resolve;
  });
  vi.stubGlobal('fetch', vi.fn(() => pending));
  return { reply: (body: unknown, status = 200) => act(async () => answer(new Response(JSON.stringify(body), { status }))) };
}

function header(enabled = true) {
  render(
    <PiAgentProvider enabled={enabled} defaultRepository='local:home' notebooks={[]} repositories={[]}>
      <Header workspaceTitle='Notes' activeTab='notes' setActiveTab={() => {}} selectedNotebookId='' notebooks={[]} onSelectNotebook={() => {}} onCreateNote={() => {}} onOpenCommands={() => {}} />
    </PiAgentProvider>,
  );
}

const agentsPageButton = () => document.querySelector('[data-header-agent]');
const dockToggle = () => document.querySelector<HTMLButtonElement>('.assistant-dock-toggle');

beforeEach(() => {
  localStorage.clear();
});

it('shows no Agents page button while the session probe is pending, only the dock toggle, disabled', async () => {
  probe();
  header();
  expect(agentsPageButton()).toBeNull();
  expect(dockToggle()?.disabled).toBe(true);
});

it('shows the dock toggle, enabled and with no Agents page button, once the probe says the agent is offered', async () => {
  const server = probe();
  header();
  await server.reply({ session: null, piAvailable: true });
  await waitFor(() => expect(dockToggle()?.disabled).toBe(false));
  expect(agentsPageButton()).toBeNull();
});

it.each([['answers that no agent is offered', { session: null, piAvailable: false }, 200], ['fails', { error: "The agent's bridge is unreachable." }, 502]])('shows the Agents page button, and no dock toggle, once the probe %s', async (_name, body, status) => {
  const server = probe();
  header();
  await server.reply(body, status);
  await waitFor(() => expect(agentsPageButton()).not.toBeNull());
  expect(dockToggle()).toBeNull();
});

it('shows the Agents page button where the agent is not enabled at all', () => {
  header(false);
  expect(screen.getByRole('button', { name: 'Agent workspaces' })).toBeTruthy();
  expect(dockToggle()).toBeNull();
});
