import { describe, expect, it } from 'vitest';
import { liveEmbedUrl, liveStatusOf, liveThemeMessage } from './live-message.js';

const editor = { origin: 'https://live.example.test', messageType: 'live-status', themeParam: 'theme' };
const frame = {} as Window;
const status = { type: 'live-status', users: 2, saved: true, connected: true, released: false };
const event = (overrides: Partial<{ origin: string; source: unknown; data: unknown; }> = {}) => ({ origin: editor.origin, source: frame, data: status, ...overrides }) as MessageEvent;

describe('liveStatusOf', () => {
  it('accepts a status from the editor origin and the frame window, keeping only the four fields', () => {
    expect(liveStatusOf(event({ data: { ...status, html: '<img onerror=x>' } }), editor, frame)).toEqual({ users: 2, saved: true, connected: true, released: false });
  });

  it('treats a missing released field as false', () => {
    const { released: _released, ...rest } = status;
    expect(liveStatusOf(event({ data: rest }), editor, frame)).toMatchObject({ released: false });
  });

  it('ignores a message from another origin, even one that differs only by scheme, port or a path', () => {
    for (const origin of ['https://evil.example.test', 'http://live.example.test', 'https://live.example.test:8443', 'https://live.example.test/', 'null', '']) expect(liveStatusOf(event({ origin }), editor, frame), origin).toBeNull();
  });

  it('ignores a message from any window but the frame', () => {
    expect(liveStatusOf(event({ source: {} as Window }), editor, frame)).toBeNull();
    expect(liveStatusOf(event({ source: null }), editor, frame)).toBeNull();
    expect(liveStatusOf(event(), editor, null)).toBeNull();
  });

  it('ignores a message of another type, and the theme message the app itself posts', () => {
    for (const type of ['other', 'live-status:theme', 'LIVE-STATUS', undefined]) expect(liveStatusOf(event({ data: { ...status, type } }), editor, frame), String(type)).toBeNull();
  });

  it('ignores bad fields', () => {
    const bad = [{ users: -1 }, { users: 10001 }, { users: 1.5 }, { users: '2' }, { users: Number.NaN }, { saved: 'true' }, { connected: 1 }, { released: 'yes' }, { users: undefined }, { saved: undefined }, { connected: undefined }];
    for (const fields of bad) expect(liveStatusOf(event({ data: { ...status, ...fields } }), editor, frame), JSON.stringify(fields)).toBeNull();
    for (const data of [null, 'live-status', 42, [], ['live-status']]) expect(liveStatusOf(event({ data }), editor, frame), JSON.stringify(data)).toBeNull();
  });

  it('accepts the bounds of users', () => {
    expect(liveStatusOf(event({ data: { ...status, users: 0 } }), editor, frame)?.users).toBe(0);
    expect(liveStatusOf(event({ data: { ...status, users: 10000 } }), editor, frame)?.users).toBe(10000);
  });
});

describe('liveEmbedUrl', () => {
  it('adds the theme parameter to an embed URL on the editor origin', () => {
    expect(liveEmbedUrl('https://live.example.test/embed/abc?x=1', editor, 'dark')).toBe('https://live.example.test/embed/abc?x=1&theme=dark');
    expect(liveEmbedUrl('https://live.example.test/embed/abc?theme=light', editor, 'dark')).toBe('https://live.example.test/embed/abc?theme=dark');
  });

  it('adds none without a theme parameter', () => {
    expect(liveEmbedUrl('https://live.example.test/embed/abc', { ...editor, themeParam: undefined }, 'dark')).toBe('https://live.example.test/embed/abc');
  });

  it('refuses a URL off the editor origin, or none at all', () => {
    for (const url of ['https://evil.example.test/embed/abc', 'http://live.example.test/embed', 'javascript:alert(1)', 'not a url', '//live.example.test/embed']) expect(liveEmbedUrl(url, editor, 'light'), url).toBeNull();
  });
});

describe('liveThemeMessage', () => {
  it('is the message type with :theme', () => {
    expect(liveThemeMessage(editor, 'dark')).toEqual({ type: 'live-status:theme', theme: 'dark' });
  });
});
