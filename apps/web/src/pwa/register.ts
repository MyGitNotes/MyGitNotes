import { announceUpdate } from './update-store.js';

/** How often an open page asks the server whether a new version was deployed. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Where the worker file is served: beside the page's base, so its scope is the app's. */
export function serviceWorkerUrl(base: string, origin: string): URL {
  return new URL(`${base.endsWith('/') ? base : `${base}/`}sw.js`, origin);
}

/** Watches a registration, announcing a newer worker once it has installed behind the running one. */
export function watchRegistration(registration: ServiceWorkerRegistration, container: Pick<ServiceWorkerContainer, 'controller'>): void {
  const controlled = () => container.controller !== null;
  if (registration.waiting) announceUpdate(registration.waiting, controlled());
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed') announceUpdate(installing, controlled());
    });
  });
}

/**
 * Registers the app's service worker in a production build that ships one. The dev server and a build without the plugin
 * (`__SERVICE_WORKER__` unset) register nothing.
 */
export function registerServiceWorker(): void {
  if (typeof __SERVICE_WORKER__ === 'undefined' || !__SERVICE_WORKER__ || !import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const url = serviceWorkerUrl(import.meta.env.BASE_URL, window.location.origin);
  const register = () => {
    navigator.serviceWorker.register(url, { scope: new URL('./', url).pathname }).then(registration => {
      watchRegistration(registration, navigator.serviceWorker);
      const check = () => void registration.update().catch(() => {/* Offline or the server is down: the next check tries again. */});
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
      window.setInterval(check, UPDATE_CHECK_INTERVAL_MS);
    }, error => console.error('The service worker could not be registered:', error));
  };
  // After the page has loaded, so installing the shell's cache never competes with the first paint.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
