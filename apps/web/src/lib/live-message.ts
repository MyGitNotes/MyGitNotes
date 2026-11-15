import type { LiveFrameEditorInfo } from '@mygitnotes/core';

/*
 * The messages between the app and a framed live editor (docs/specs/2026-11-15-live-notes/spec.md §8, §9). The editor
 * posts its status to the app's origin; the app accepts one only from the editor's exact origin and the frame's own
 * window, of the editor's message type and with valid fields, and keeps nothing else from it. The app posts the theme
 * back to the editor's origin only.
 */

/** What the framed editor says of itself. Only these values ever leave a message. */
export interface LiveStatus {
  /** Connected, non-idle editors, this person included. */
  users: number;
  /** The editor holds no unsaved typing. */
  saved: boolean;
  connected: boolean;
  /** The live note was checked in and closed. */
  released: boolean;
}

export type LiveTheme = 'light' | 'dark';

const MAX_USERS = 10_000;
const isUsers = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_USERS;

/**
 * The status in a message event, or null when the event is not one: another origin, another window than `frame`, another
 * type, or a field that is missing or of the wrong shape. `released` may be left out (false); the others are required.
 */
export function liveStatusOf(event: Pick<MessageEvent, 'origin' | 'source' | 'data'>, editor: Pick<LiveFrameEditorInfo, 'origin' | 'messageType'>, frame: Window | null | undefined): LiveStatus | null {
  if (!frame || event.source !== frame || event.origin !== editor.origin) return null;
  const data: unknown = event.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const { type, users, saved, connected, released = false } = data as Record<string, unknown>;
  if (type !== editor.messageType || !isUsers(users) || typeof saved !== 'boolean' || typeof connected !== 'boolean' || typeof released !== 'boolean') return null;
  return { users, saved, connected, released };
}

/** The embed URL with the theme parameter, or null when it is not a URL of the editor's origin. */
export function liveEmbedUrl(embedUrl: string, editor: Pick<LiveFrameEditorInfo, 'origin' | 'themeParam'>, theme: LiveTheme): string | null {
  let url: URL;
  try {
    url = new URL(embedUrl);
  } catch {
    return null;
  }
  if (url.origin !== editor.origin || !/^https?:$/.test(url.protocol)) return null;
  if (editor.themeParam) url.searchParams.set(editor.themeParam, theme);
  return url.href;
}

/** Whether a URL the editor gave opens on its own origin, which a link may then point at. */
export const isLiveEditorUrl = (value: string, editor: Pick<LiveFrameEditorInfo, 'origin'>): boolean => liveEmbedUrl(value, { origin: editor.origin }, 'light') !== null;

/** The message that tells the framed editor the app's theme; it is posted with the editor's origin as target. */
export const liveThemeMessage = (editor: Pick<LiveFrameEditorInfo, 'messageType'>, theme: LiveTheme) => ({ type: `${editor.messageType}:theme`, theme });
