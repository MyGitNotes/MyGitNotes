import { describe, expect, it, vi } from 'vitest';
import { serviceWorkerUrl, watchRegistration } from './register.js';
import { getUpdateReady, resetUpdateStore } from './update-store.js';

type Listener = () => void;
const target = () => {
  const listeners = new Map<string, Listener[]>();
  return { addEventListener: (type: string, listener: Listener) => listeners.set(type, [...listeners.get(type) ?? [], listener]), emit: (type: string) => listeners.get(type)?.forEach(listener => listener()) };
};

describe('serviceWorkerUrl', () => {
  it('sits beside the app, under its base path', () => {
    expect(serviceWorkerUrl('/', 'https://notes.example').href).toBe('https://notes.example/sw.js');
    expect(serviceWorkerUrl('/app/', 'https://notes.example').href).toBe('https://notes.example/app/sw.js');
    expect(serviceWorkerUrl('/app', 'https://notes.example').href).toBe('https://notes.example/app/sw.js');
  });
});

describe('watchRegistration', () => {
  it('announces a version that finishes installing while a worker controls the page', () => {
    resetUpdateStore();
    const registration = Object.assign(target(), { waiting: null, installing: null as null | (ReturnType<typeof target> & { state: string; postMessage: Listener; }) });
    watchRegistration(registration as unknown as ServiceWorkerRegistration, { controller: {} as ServiceWorker });
    const installing = Object.assign(target(), { state: 'installing', postMessage: vi.fn() });
    registration.installing = installing;
    registration.emit('updatefound');
    installing.emit('statechange');
    expect(getUpdateReady()).toBe(false);
    installing.state = 'installed';
    installing.emit('statechange');
    expect(getUpdateReady()).toBe(true);
    resetUpdateStore();
  });

  it('announces a version already waiting when the page opens', () => {
    resetUpdateStore();
    const registration = Object.assign(target(), { waiting: { postMessage: vi.fn() }, installing: null });
    watchRegistration(registration as unknown as ServiceWorkerRegistration, { controller: {} as ServiceWorker });
    expect(getUpdateReady()).toBe(true);
    resetUpdateStore();
  });

  it('stays quiet for the first install', () => {
    resetUpdateStore();
    const registration = Object.assign(target(), { waiting: null, installing: null as null | (ReturnType<typeof target> & { state: string; }) });
    watchRegistration(registration as unknown as ServiceWorkerRegistration, { controller: null });
    const installing = Object.assign(target(), { state: 'installed' });
    registration.installing = installing;
    registration.emit('updatefound');
    installing.emit('statechange');
    expect(getUpdateReady()).toBe(false);
  });
});
