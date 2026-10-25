import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

/**
 * The dock is a flex item of the row it shares with the page, so the row's height is the dock's. Without a bound on the
 * row, a long conversation grows the dock past the window and pushes the message box off screen; jsdom has no layout, so
 * the rules themselves are checked.
 */
it("bounds the dock's row to the workspace body, so the dock's message box stays on screen", () => {
  const css = fs.readFileSync(path.resolve('apps/web/src/workspace.css'), 'utf8');
  const row = css.match(/\.workspace-split-main-panel\s*\{([^}]*)\}/)?.[1] ?? '';
  expect(row).toMatch(/(?:^|;)\s*height:\s*100%\s*(?:;|$)/);
  expect(row).toMatch(/(?:^|;)\s*overflow:\s*hidden\s*(?:;|$)/);
  expect(row).toMatch(/(?:^|;)\s*min-height:\s*0\s*(?:;|$)/);
  expect(css).toMatch(/\.workspace-split-main-panel\.workspace-main-row\s*\{[^}]*flex-direction:\s*row/);
});
