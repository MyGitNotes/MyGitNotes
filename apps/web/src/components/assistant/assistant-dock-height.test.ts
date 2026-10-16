import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

/**
 * The dock is a flex item of `.app-frame`, so the frame's height is the dock's. Without one, a long conversation grows the
 * dock past the window and pushes the message box off screen; jsdom has no layout, so the rule itself is checked.
 */
it("bounds the app frame to the window's height, so the dock's message box stays on screen", () => {
  const css = fs.readFileSync(path.resolve('apps/web/src/components/assistant/assistant-dock.css'), 'utf8');
  const frame = css.match(/\.app-frame\s*\{([^}]*)\}/)?.[1] ?? '';
  expect(frame).toMatch(/(?:^|;)\s*height:\s*100dvh\s*(?:;|$)/);
  expect(frame).toMatch(/(?:^|;)\s*overflow:\s*hidden\s*(?:;|$)/);
});
