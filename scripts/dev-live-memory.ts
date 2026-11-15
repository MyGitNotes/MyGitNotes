/*
 * Starts the live notes dev composition (not shipped): the app over an in-memory edition source with the memory live
 * adapter, and a stub live editor on a second loopback port. See apps/local-server/dev/live-memory.ts.
 *
 *   pnpm --filter "./packages/*" run build && pnpm --filter @mygitnotes/web run build
 *   pnpm exec tsx scripts/dev-live-memory.ts
 */
import '../apps/local-server/dev/live-memory.js';
