import type { IncomingHttpHeaders } from 'node:http';
import type { Request, RequestHandler, Response } from 'express';
import { DEMO_COOKIE, demoLanguage, demoPageRequest } from '@mygitnotes/core/demo';

/** The requests `demoPageCredentials` recognised as made by a demo page. */
const demoPages = new WeakSet<{ headers: IncomingHttpHeaders; }>();

/** Whether `demoPageCredentials` recognised the request as made by a demo page, so it carries no credential but the demo cookie. */
export const isDemoPage = (req: { headers: IncomingHttpHeaders; }): boolean => demoPages.has(req);

const isSetCookie = (name: unknown) => typeof name === 'string' && name.toLowerCase() === 'set-cookie';

/** The headers a `writeHead` call was given, less any `Set-Cookie`; Node takes an object, or a flat list of names and values. */
function withoutSetCookie<Headers extends object>(headers: Headers): Headers {
  if (!Array.isArray(headers)) return Object.fromEntries(Object.entries(headers).filter(([name]) => !isSetCookie(name))) as Headers;
  // A list of [name, value] pairs.
  if (headers.every(entry => Array.isArray(entry))) return headers.filter(([name]) => !isSetCookie(name)) as Headers;
  // An odd list is Node's to refuse.
  return headers.length % 2 ? headers : headers.filter((_value, index) => !isSetCookie(headers[index - index % 2])) as Headers;
}

/** Makes sure no answer to this request sets, renews or clears a cookie: the header goes just before the head is written, whichever way the route set it. */
function refuseSetCookie(res: Response): void {
  const writeHead = res.writeHead.bind(res) as (...args: unknown[]) => Response;
  res.writeHead = ((...args: unknown[]) => {
    res.removeHeader('Set-Cookie');
    return writeHead(...args.map(arg => (arg && typeof arg === 'object' ? withoutSetCookie(arg) : arg)));
  }) as typeof res.writeHead;
}

/** Removes the person's credentials from the request, where every later reader of its headers looks: only the demo cookie stays. */
function dropCredentials(req: Request): void {
  const language = demoLanguage(req);
  const demoCookie = language ? `${DEMO_COOKIE}=${language}` : undefined;
  if (demoCookie) req.headers.cookie = demoCookie;
  else delete req.headers.cookie;
  delete req.headers.authorization;
  // The raw list is rewritten too, so a reader that parses it afresh finds the same headers.
  const kept: string[] = [];
  for (let index = 0; index + 1 < req.rawHeaders.length; index += 2) {
    const name = req.rawHeaders[index]!.toLowerCase();
    if (name !== 'cookie' && name !== 'authorization') kept.push(req.rawHeaders[index]!, req.rawHeaders[index + 1]!);
  }
  if (demoCookie) kept.push('Cookie', demoCookie);
  req.rawHeaders = kept;
}

/**
 * Mounted first, for a deployment that offers a demo: a request made by a demo page (`demoPageRequest`: its `Referer`
 * is under `/demo`) loses every credential before anything reads one, so the demo never runs as the person who happens
 * to be signed in on this browser. It keeps the demo cookie, which carries only a language, and drops the rest of the
 * cookies and the `Authorization` header; no answer to it sets a cookie. What it then reaches is what a visitor who is
 * not signed in, with the demo cookie, reaches. It only ever removes authority, so a page that sends a wrong `Referer`
 * gets less, never more.
 */
export function demoPageCredentials(): RequestHandler {
  return (req, res, next) => {
    if (demoPages.has(req) || !demoPageRequest(req)) return next();
    demoPages.add(req);
    dropCredentials(req);
    refuseSetCookie(res);
    next();
  };
}

/**
 * Refuses a demo page's request for a sign-in route, other than the session probe: starting a sign-in would replace the
 * session, and signing out would clear it, even though the request carries no cookie. Mounted by `createApp` in front of
 * `/api/auth`, which is relative to that mount.
 */
export const refuseDemoPageSignIn: RequestHandler = (req, res, next) => {
  const probe = (req.method === 'GET' || req.method === 'HEAD') && req.path.toLowerCase().replace(/\/+$/, '') === '/session';
  if (!demoPages.has(req) || probe) return next();
  res.status(403).json({ error: 'Signing in and out are not available from the demo.', code: 'demo-page' });
};
