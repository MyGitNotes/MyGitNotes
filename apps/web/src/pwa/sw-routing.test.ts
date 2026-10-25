import { describe, expect, it } from 'vitest';
import { routeRequest, type SwRequest } from './sw-routing.js';

const scope = new URL('https://notes.example/');
const precached = new Set(['index.html', 'assets/index-abc.js', 'brand/github-notes-192.png', 'site.webmanifest']);
const route = (url: string, init: Partial<SwRequest> = {}, base = scope) => routeRequest({ method: 'GET', mode: 'cors', ranged: false, url, ...init }, base, precached);

describe('routeRequest', () => {
  it('answers page loads from the network first, whatever the app route', () => {
    expect(route('https://notes.example/', { mode: 'navigate' })).toBe('navigate');
    expect(route('https://notes.example/notebooks/work/notes/a%20b.md', { mode: 'navigate' })).toBe('navigate');
    expect(route('https://notes.example/index.html', { mode: 'navigate' })).toBe('navigate');
  });

  it('keeps built files and the shell icons', () => {
    expect(route('https://notes.example/assets/index-abc.js')).toBe('asset');
    expect(route('https://notes.example/assets/chunk-never-precached.js')).toBe('asset');
    expect(route('https://notes.example/brand/github-notes-192.png')).toBe('asset');
    expect(route('https://notes.example/site.webmanifest')).toBe('asset');
  });

  it('never touches API, MCP, raw file or R2 requests, nor the sign-in and callback routes under them', () => {
    for (const path of ['api/workspace', 'api/auth/session', 'api/auth/github', 'api/auth/github/callback?code=1&state=2', 'api/files/raw?path=a.pdf', 'mcp/', 'raw-assets/notes/a.png', 'r2-assets/key']) {
      expect(route(`https://notes.example/${path}`), path).toBe('bypass');
      expect(route(`https://notes.example/${path}`, { mode: 'navigate' }), `${path} (navigation)`).toBe('bypass');
    }
  });

  it('does not slip past a server path with an escaped or dotted spelling', () => {
    expect(route('https://notes.example/%61pi/workspace', { mode: 'navigate' })).toBe('bypass');
    expect(route('https://notes.example/assets/../api/workspace')).toBe('bypass');
    expect(route('https://notes.example/assets/%2e%2e/api/workspace')).toBe('bypass');
    expect(route('https://notes.example/%E0%A4%A', { mode: 'navigate' })).toBe('bypass');
  });

  it('never touches a request that is not a plain GET', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      expect(route('https://notes.example/assets/index-abc.js', { method }), method).toBe('bypass');
      expect(route('https://notes.example/', { method, mode: 'navigate' }), `${method} navigation`).toBe('bypass');
    }
    expect(route('https://notes.example/assets/video.mp4', { ranged: true })).toBe('bypass');
  });

  it('never keeps the worker file itself or a file it does not know', () => {
    expect(route('https://notes.example/sw.js')).toBe('bypass');
    expect(route('https://notes.example/sw.js', { mode: 'navigate' })).toBe('bypass');
    expect(route('https://notes.example/robots.txt')).toBe('bypass');
  });

  it('leaves other origins alone, except the fonts the page loads', () => {
    expect(route('https://elsewhere.example/assets/index-abc.js')).toBe('bypass');
    expect(route('https://fonts.googleapis.com/css2?family=Noto+Sans+TC')).toBe('font');
    expect(route('https://fonts.gstatic.com/s/notosans/v1/a.woff2')).toBe('font');
    expect(route('http://fonts.gstatic.com/s/notosans/v1/a.woff2')).toBe('bypass');
    expect(route('https://fonts.googleapis.com.evil.example/css')).toBe('bypass');
    expect(route('https://fonts.googleapis.com/css2', { method: 'POST' })).toBe('bypass');
  });

  it('stays inside the scope when the app is served under a base path', () => {
    const base = new URL('https://notes.example/app/');
    expect(route('https://notes.example/app/', { mode: 'navigate' }, base)).toBe('navigate');
    expect(route('https://notes.example/app/assets/index-abc.js', {}, base)).toBe('asset');
    expect(route('https://notes.example/app/api/workspace', {}, base)).toBe('bypass');
    expect(route('https://notes.example/other/', { mode: 'navigate' }, base)).toBe('bypass');
    expect(route('https://notes.example/assets/index-abc.js', {}, base)).toBe('bypass');
    expect(route('https://notes.example/app-other/assets/x.js', {}, base)).toBe('bypass');
  });

  it('treats a request it cannot parse as not its own', () => {
    expect(route('not a url')).toBe('bypass');
  });
});
