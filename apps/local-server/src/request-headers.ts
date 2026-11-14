import type { Request } from 'express';

/**
 * Removes headers from a request where every later reader looks: the parsed `headers` and the raw list that
 * `headersDistinct` and a fresh parse read. Names are lower case; the raw list is matched in any case.
 */
export function dropHeaders(req: Request, names: readonly string[]): void {
  for (const name of names) delete req.headers[name];
  const kept: string[] = [];
  for (let index = 0; index + 1 < req.rawHeaders.length; index += 2) {
    if (!names.includes(req.rawHeaders[index]!.toLowerCase())) kept.push(req.rawHeaders[index]!, req.rawHeaders[index + 1]!);
  }
  req.rawHeaders = kept;
}
