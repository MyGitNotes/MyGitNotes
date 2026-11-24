import { z } from 'zod';

/** Field shapes and limits shared by the compilation file and its board section. */
export const compilationId = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
/* eslint-disable no-control-regex -- Reject control characters in persisted paths, identifiers or filenames. */
export const compilationRepoPath = z.string().min(1).max(2048).refine(value => !/[\\\x00-\x1f\x7f]/.test(value) && value.split('/').every(part => part !== '' && part !== '.' && part !== '..'), 'Invalid workspace path');
/* eslint-enable no-control-regex */

export const COMPILATION_MAX_HEADINGS = 100;
/** A manual order names every member of a dynamic compilation, which can outgrow the pinned-item limit. */
export const COMPILATION_MAX_ORDER = 2000;
