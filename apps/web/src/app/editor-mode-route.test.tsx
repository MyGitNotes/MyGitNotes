// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { useContext, useLayoutEffect } from 'react';
import { MemoryRouter, UNSAFE_NavigationContext, useLocation, useNavigate } from 'react-router-dom';
import { expect, it } from 'vitest';
import { FOCUS_NOTE_STATE } from '../lib/routes.js';
import { EditorModeRouteProvider, useEditorModeRoute } from './editor-mode-route.js';

interface Probe {
  mode: string | undefined;
  url: string;
  state: unknown;
  index: number;
  setMode: (mode: 'live' | 'raw' | 'split') => void;
  navigate: ReturnType<typeof useNavigate>;
}

function Consumer({ report }: { report: (probe: Probe) => void; }) {
  const route = useEditorModeRoute();
  const location = useLocation(), navigate = useNavigate();
  const { navigator } = useContext(UNSAFE_NavigationContext);
  useLayoutEffect(() => report({ mode: route?.mode, url: location.pathname + location.search + location.hash, state: location.state, index: (navigator as unknown as { index: number; }).index, setMode: mode => route!.setMode(mode), navigate }));
  return null;
}

function open(entries: (string | { pathname: string; search?: string; hash?: string; state?: unknown; })[]) {
  const probe = { current: undefined as unknown as Probe };
  render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <EditorModeRouteProvider>
        <Consumer report={value => void (probe.current = value)} />
      </EditorModeRouteProvider>
    </MemoryRouter>,
  );
  return probe;
}

const NOTE = '/notebooks/life/notes/a.md';

it('reads the mode the URL names, so a reload or a shared link reopens it', () => {
  expect(open([`${NOTE}?mode=split`]).current.mode).toBe('split');
  expect(open([`${NOTE}?mode=source`]).current.mode).toBe('raw');
});

it('is live when the URL names no mode', () => {
  expect(open([NOTE]).current.mode).toBe('live');
});

it('replaces the current history entry on a switch, keeping every other parameter, the hash and the entry state', () => {
  const probe = open(['/notebooks/life', { pathname: NOTE, search: '?q=x&tag=a', hash: '#part', state: FOCUS_NOTE_STATE }]);
  const index = probe.current.index;
  act(() => probe.current.setMode('split'));
  expect(probe.current.url).toBe(`${NOTE}?q=x&tag=a&mode=split#part`);
  expect(probe.current.mode).toBe('split');
  expect(probe.current.state).toEqual(FOCUS_NOTE_STATE);
  expect(probe.current.index).toBe(index);
  act(() => probe.current.setMode('raw'));
  expect(probe.current.url).toBe(`${NOTE}?q=x&tag=a&mode=source#part`);
  expect(probe.current.index).toBe(index);
  // Back leaves the note: no entry was added for either switch.
  act(() => void probe.current.navigate(-1));
  expect(probe.current.url).toBe('/notebooks/life');
});

it('leaves the mode out of the URL when the switch is to live, the default', () => {
  const probe = open([`${NOTE}?mode=source&q=x`]);
  act(() => probe.current.setMode('live'));
  expect(probe.current.url).toBe(`${NOTE}?q=x`);
  expect(probe.current.mode).toBe('live');
});

it('changes nothing when the mode asked for is the one the URL names', () => {
  const probe = open([`${NOTE}?mode=split`]);
  const before = probe.current;
  act(() => probe.current.setMode('split'));
  expect(probe.current.url).toBe(before.url);
});
