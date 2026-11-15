// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { LiveCheckoutView } from '../../lib/live-api.js';
import { LiveEditorFrame, type LiveEditorFrameProps } from './LiveEditorFrame.js';

const editor = { origin: 'https://live.example.test', messageType: 'live-status', themeParam: 'theme' };
const checkout: LiveCheckoutView = { id: 'abc', notebookId: 'notes~life', path: 'notes/life/a.md', pending: false, editorUrl: 'https://live.example.test/abc', embedUrl: 'https://live.example.test/embed/abc', since: '2026-11-15T01:00:00.000Z', activeEditors: 1, conflict: null };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const props = (overrides: Partial<LiveEditorFrameProps> = {}): LiveEditorFrameProps => ({ checkout, editor, theme: 'light', onRefetch: vi.fn(), onClose: vi.fn(), ...overrides });
const frame = () => document.querySelector('iframe');
const post = (data: unknown, source: unknown = frame()?.contentWindow, origin = editor.origin) =>
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin, source: source as Window }));
  });
const status = (fields: Record<string, unknown> = {}) => ({ type: 'live-status', users: 1, saved: true, connected: true, released: false, ...fields });

it('frames no page off the editor origin', () => {
  render(createElement(LiveEditorFrame, props({ checkout: { ...checkout, embedUrl: 'https://evil.example.test/embed/abc' } })));
  expect(frame()).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent('The live editor cannot be shown here.');
});

it('frames the embed URL with the theme parameter, without sandbox, and opens the editor in a new tab', () => {
  render(createElement(LiveEditorFrame, props({ theme: 'dark' })));
  const iframe = frame()!;
  expect(iframe.getAttribute('src')).toBe('https://live.example.test/embed/abc?theme=dark');
  expect(iframe.hasAttribute('sandbox')).toBe(false);
  expect(iframe.hasAttribute('allow')).toBe(false);
  expect(iframe.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
  const link = screen.getByRole('link', { name: 'Open in a new tab' });
  expect(link).toHaveAttribute('href', checkout.editorUrl);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

it('posts a theme change to the frame on the editor origin only', () => {
  const view = render(createElement(LiveEditorFrame, props()));
  const postMessage = vi.spyOn(frame()!.contentWindow!, 'postMessage').mockImplementation(() => {});
  view.rerender(createElement(LiveEditorFrame, props({ theme: 'dark' })));
  expect(postMessage).toHaveBeenCalledWith({ type: 'live-status:theme', theme: 'dark' }, editor.origin);
  // The frame keeps the URL it opened with; the theme travels by message.
  expect(frame()!.getAttribute('src')).toBe('https://live.example.test/embed/abc?theme=light');
});

it('shows the status the frame posts and ignores messages from elsewhere', () => {
  render(createElement(LiveEditorFrame, props()));
  expect(screen.getByRole('button', { name: 'Check in now' })).toBeDisabled();
  post(status({ users: 3 }), window, editor.origin);
  post(status({ users: 4 }), frame()!.contentWindow, 'https://evil.example.test');
  post({ ...status({ users: 5 }), type: 'other' });
  expect(screen.queryByText('3 editing')).toBeNull();
  expect(screen.getByRole('button', { name: 'Check in now' })).toBeDisabled();
  post(status({ users: 2 }));
  expect(screen.getByText('2 editing')).toBeInTheDocument();
  expect(screen.getByText('Saved')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Check in now' })).toBeEnabled();
});

it('reads the note again when the editor saves a change', () => {
  const onRefetch = vi.fn();
  render(createElement(LiveEditorFrame, props({ onRefetch })));
  post(status({ saved: true }));
  expect(onRefetch).not.toHaveBeenCalled();
  post(status({ saved: false }));
  post(status({ saved: true }));
  expect(onRefetch).toHaveBeenCalledTimes(1);
});

it('unmounts the frame, says so and reads the note again when the editor releases the note', () => {
  const onRefetch = vi.fn();
  const onCheckedIn = vi.fn();
  render(createElement(LiveEditorFrame, props({ onRefetch, onCheckedIn })));
  post(status({ released: true }));
  expect(onCheckedIn).toHaveBeenCalledWith();
  expect(frame()).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Checked in');
  expect(onRefetch).toHaveBeenCalled();
});

it('unmounts the frame before it checks the note in, and reports a note that stays open', async () => {
  const onRefetch = vi.fn();
  let framedAtPost: boolean | null = null;
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    framedAtPost = frame() !== null;
    expect(url).toBe('/api/live/checkin');
    expect(JSON.parse(String(init.body))).toEqual({ notebookId: 'notes~life', path: 'notes/life/a.md' });
    return new Response(JSON.stringify({ id: 'abc', path: 'notes/life/a.md', committed: true, commit: 'c'.repeat(40), released: false, reason: 'active', activeEditors: 2, revision: 'c'.repeat(40) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const onCheckedIn = vi.fn();
  render(createElement(LiveEditorFrame, props({ onRefetch, onCheckedIn })));
  post(status());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Check in now' }));
  });
  expect(framedAtPost).toBe(false);
  expect(onCheckedIn).toHaveBeenCalledWith(expect.objectContaining({ committed: true, released: false }));
  expect(screen.getByRole('status')).toHaveTextContent('Saved to Git; 2 people are still editing, so it will be checked in again tonight.');
  expect(onRefetch).toHaveBeenCalled();
  // The person may go back to the editor.
  fireEvent.click(screen.getByRole('button', { name: 'Back to the editor' }));
  expect(frame()).not.toBeNull();
});

it('says a check-in that failed, and closes', async () => {
  const onClose = vi.fn();
  const onRefetch = vi.fn();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Live editor unavailable.' }), { status: 502, headers: { 'Content-Type': 'application/json' } }));
  render(createElement(LiveEditorFrame, props({ onClose, onRefetch })));
  post(status());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Check in now' }));
  });
  expect(screen.getByRole('alert')).toHaveTextContent('Live editor unavailable.');
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalled();
  expect(onRefetch).toHaveBeenCalled();
});
