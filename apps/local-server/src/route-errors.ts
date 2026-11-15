import type express from 'express';
import { checkedOutFields, SourceError, StaleRevisionError } from '@mygitnotes/core';

/**
 * Answers a failed API request: a `SourceError` with its status and message, anything else as a 500. A stale revision
 * names its repositories, a refusal of checked-out notes its code and paths, and `extra` adds a route's own fields.
 */
export function fail(res: express.Response, error: unknown, extra: Record<string, unknown> = {}) {
  const retryAfter = error instanceof SourceError ? error.retryAfter : undefined;
  if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
  res.status(error instanceof SourceError ? error.status : 500).json({ error: error instanceof Error ? error.message : 'Request failed.', ...(retryAfter ? { retryAfter } : {}), ...(error instanceof StaleRevisionError ? { staleRepositories: error.repositories } : {}), ...checkedOutFields(error), ...extra });
}
