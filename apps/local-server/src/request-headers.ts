import type { Request } from 'express';

/**
 * Removes headers from a request where every later reader looks: the parsed `headers`, `headersDistinct` and the raw
 * list a fresh parse reads. Names are lower case; the raw list is matched in any case.
 */
export function dropHeaders(req: Request, names: readonly string[]): void {
  // Node builds headersDistinct from the raw list once, counting the headers it was sent: it is built (or taken from its
  // cache) before the list shrinks, and loses the names there too.
  const distinct = (req as { headersDistinct?: Record<string, string[] | undefined>; }).headersDistinct;
  for (const name of names) {
    delete req.headers[name];
    if (distinct) delete distinct[name];
  }
  const kept: string[] = [];
  for (let index = 0; index + 1 < req.rawHeaders.length; index += 2) {
    if (!names.includes(req.rawHeaders[index]!.toLowerCase())) kept.push(req.rawHeaders[index]!, req.rawHeaders[index + 1]!);
  }
  req.rawHeaders = kept;
}
