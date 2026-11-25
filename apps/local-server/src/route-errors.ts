import type express from 'express';
import { checkedOutFields, CompilationError, NoteFrontmatterUnreadableError, SourceError, StaleRevisionError } from '@mygitnotes/core';

/**
 * Answers a failed API request: a `SourceError` with its status and message, a metadata write refused on an unreadable
 * frontmatter as a 409 with its code, a compilation write that would not open (`CompilationError`) as a 400, anything
 * else as a 500. A stale revision
 * names its repositories, a refusal of checked-out notes its code and paths, and `extra` adds a route's own fields.
 */
export function fail(res: express.Response, error: unknown, extra: Record<string, unknown> = {}) {
  const retryAfter = error instanceof SourceError ? error.retryAfter : undefined;
  if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
  // A metadata write refused on a note whose frontmatter cannot be read is a conflict with the note's text, not a fault.
  const unreadable = error instanceof NoteFrontmatterUnreadableError;
  res.status(error instanceof SourceError || unreadable ? error.status : error instanceof CompilationError ? 400 : 500).json({ error: error instanceof Error ? error.message : 'Request failed.', ...(retryAfter ? { retryAfter } : {}), ...(error instanceof StaleRevisionError ? { staleRepositories: error.repositories } : {}), ...checkedOutFields(error), ...(unreadable ? { code: error.code } : {}), ...extra });
}
